//! Disposable priority index. Stable group records remain authoritative; rebuild
//! once after upgrade, and synchronously refresh on every group write.
use crate::groups::ShardGroup;
use std::{cmp::Ordering, collections::{BTreeMap, BTreeSet}};

#[derive(Clone, Debug)]
struct Rank { assigned: u32, maximum: u32, id: String }
impl Ord for Rank {
    fn cmp(&self, other: &Self) -> Ordering {
        (u64::from(self.assigned) * u64::from(other.maximum))
            .cmp(&(u64::from(other.assigned) * u64::from(self.maximum)))
            .then_with(|| other.id.cmp(&self.id))
    }
}
impl PartialOrd for Rank { fn partial_cmp(&self, other: &Self) -> Option<Ordering> { Some(self.cmp(other)) } }
impl PartialEq for Rank { fn eq(&self, other: &Self) -> bool { self.cmp(other) == Ordering::Equal } }
impl Eq for Rank {}

#[derive(Default)]
pub(crate) struct GroupIndex {
    targets: BTreeMap<String, BTreeSet<Rank>>,
    ids: BTreeMap<String, (String, Rank)>,
}
impl GroupIndex {
    pub fn upsert(&mut self, group: &ShardGroup) {
        if let Some((target, old)) = self.ids.remove(&group.id) {
            if let Some(rows) = self.targets.get_mut(&target) { rows.remove(&old); }
        }
        // Exclude only time-independent failures. Current health and growth
        // evidence are rechecked against stable records by the caller.
        if !group.accepting || group.max_clubs == 0 || !crate::groups::below_rollover(group) ||
            group.cycles < group.min_cycles || group.heap_bytes >= group.heap_budget_bytes { return; }
        let rank = Rank { assigned: group.assigned_clubs, maximum: group.max_clubs, id: group.id.clone() };
        self.targets.entry(group.target_alias.clone()).or_default().insert(rank.clone());
        self.ids.insert(group.id.clone(), (group.target_alias.clone(), rank));
    }
    pub fn pick<T>(&self, target: &str, mut verify: impl FnMut(&str) -> Option<T>) -> Option<T> {
        self.targets.get(target)?.iter().rev().find_map(|rank| verify(&rank.id))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::groups::{self, tests::group};
    #[test]
    fn indexed_pick_matches_scan_for_4096_groups_and_changing_health() {
        let mut rows: Vec<_> = (0..4096).map(|i| {
            let mut g = group(&format!("g{i:04}"), (i % 79) as u32);
            g.max_clubs = 100 + (i % 19) as u32;
            if i % 7 == 0 { g.accepting = false; }
            if i % 11 == 0 { g.target_alias = "foreign".into(); }
            if i % 13 == 0 { g.observed_at_ns = 0; }
            g
        }).collect();
        let mut index = GroupIndex::default();
        for g in &rows { index.upsert(g); }
        for now in [1, groups::MAX_READING_AGE_NS, groups::MAX_READING_AGE_NS + 1, groups::MAX_READING_AGE_NS + 2] {
            for target in ["mainnet", "foreign", "absent"] {
                assert_eq!(index.pick(target, |id| rows.iter().find(|g| g.id == id)
                    .filter(|g| groups::has_headroom(g, target, now) && groups::below_rollover(g)).map(|g| g.id.clone())),
                    groups::select(&rows, target, now).map(|g| g.id.clone()));
            }
        }
        for g in rows.iter_mut().take(200) { g.accepting = true; g.assigned_clubs = 80; index.upsert(g); }
        assert_eq!(index.pick("mainnet", |id| rows.iter().find(|g| g.id == id).map(|g| g.id.clone())),
            groups::select(&rows, "mainnet", 1).map(|g| g.id.clone()));
    }
    #[test]
    fn exact_ratio_ties_preserve_smallest_id_and_updated_budgets() {
        let mut a = group("a", 1); a.max_clubs = 3;
        let b = group("b", 2); let mut b = b; b.max_clubs = 6;
        let mut index = GroupIndex::default(); index.upsert(&b); index.upsert(&a);
        assert_eq!(index.pick("mainnet", |id| Some(id.to_string())), Some("a".into()));
        a.accepting = false; index.upsert(&a);
        assert_eq!(index.pick("mainnet", |id| Some(id.to_string())), Some("b".into()));
        a.accepting = true; a.target_alias = "engine".into(); index.upsert(&a);
        assert_eq!(index.pick("engine", |id| Some(id.to_string())), Some("a".into()));
        a.cycles = 0; index.upsert(&a); assert!(index.pick("engine", |_| Some(())).is_none());
    }
    #[test]
    fn healthy_common_path_verifies_one_candidate_at_4096_groups() {
        let mut index = GroupIndex::default();
        for i in 0..4096 { index.upsert(&group(&format!("g{i:04}"), 0)); }
        let mut visits = 0;
        assert_eq!(index.pick("mainnet", |id| { visits += 1; Some(id.to_string()) }), Some("g0000".into()));
        assert_eq!(visits, 1);
    }
}