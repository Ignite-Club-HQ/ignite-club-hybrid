use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};

// Memory 6 is a stable B-tree, not a serialized heap snapshot. At <8 KiB
// per validated group, 4096 rows reserve <32 MiB plus B-tree overhead.
pub const MAX_GROUPS: usize = 4096;
pub const MAX_CLUBS: u32 = 100_000;
// Health readings stay valid for two hours: scheduled reporting runs well
// inside this window even when GitHub Actions cron runs late.
pub const MAX_READING_AGE_NS: u64 = 2 * 60 * 60 * 1_000_000_000;
pub const PREPARE_PERCENT: u128 = 70;
pub const ROLLOVER_PERCENT: u128 = 80;
pub const DOMAINS: [&str; 13] = [
    "club_domain", "events_domain", "messaging_domain", "vault_domain",
    "competition_domain", "club_points_domain", "mini_league_domain",
    "media_metadata", "insights_domain", "notification_queue",
    "pii_access_control", "timer_jobs", "secret_workload_identity",
];

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainCanister {
    pub domain: String,
    pub canister: Principal,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ShardGroup {
    pub id: String,
    // Target alias prevents a country's assignment leaking across deployments.
    pub target_alias: String,
    pub domains: Vec<DomainCanister>,
    pub accepting: bool,
    pub max_clubs: u32,
    pub assigned_clubs: u32,
    pub heap_budget_bytes: u64,
    pub heap_bytes: u64,
    pub min_cycles: u64,
    pub cycles: u64,
    pub observed_at_ns: u64,
    /// The group's own photo store. Uploads for its clubs go only here, never
    /// to a shared store (whose single club authority belongs to another group).
    #[serde(default)]
    pub photo_store: Option<Principal>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct GroupAssignment {
    pub club_id: String,
    pub group_id: String,
    pub revision: u64,
}

pub fn validate(group: &ShardGroup) -> Result<(), String> {
    for id in [&group.id, &group.target_alias] {
        if id.is_empty() || id.len() > 64 || !id.bytes().all(|c| c.is_ascii_alphanumeric() || b"-_.:".contains(&c)) {
            return Err("Invalid group or target ID".into());
        }
    }
    if group.max_clubs == 0 || group.max_clubs > MAX_CLUBS || group.assigned_clubs > group.max_clubs {
        return Err("Invalid club capacity".into());
    }
    if group.heap_budget_bytes == 0 || group.heap_budget_bytes > 3 * 1024 * 1024 * 1024 || group.min_cycles == 0 {
        return Err("Invalid memory or cycle budget".into());
    }
    let mut names = std::collections::HashSet::new();
    let mut principals = std::collections::HashSet::new();
    for domain in &group.domains {
        if !DOMAINS.contains(&domain.domain.as_str()) || !names.insert(domain.domain.clone()) ||
            !principals.insert(domain.canister) || domain.canister == Principal::anonymous() ||
            domain.canister == Principal::management_canister() {
            return Err("Invalid or duplicate domain canister".into());
        }
    }
    if names.len() != DOMAINS.len() { return Err("Incomplete shard group".into()); }
    if let Some(store) = group.photo_store {
        if store == Principal::anonymous() || store == Principal::management_canister() || principals.contains(&store) {
            return Err("Invalid group photo store".into());
        }
    }
    Ok(())
}

pub fn has_headroom(group: &ShardGroup, target: &str, now: u64) -> bool {
    group.target_alias == target && group.accepting && group.assigned_clubs < group.max_clubs &&
        group.heap_bytes < group.heap_budget_bytes && group.cycles >= group.min_cycles &&
        group.observed_at_ns <= now && now - group.observed_at_ns <= MAX_READING_AGE_NS
}

/// Governor budgets must be conservative tested limits, not ICP headline limits.
/// Extra resources (blob admission/processing) still require closed operator
/// preparation and validation; these existing fields do not attest them.
pub fn needs_preparation(group: &ShardGroup) -> bool {
    u128::from(group.assigned_clubs) * 100 >= u128::from(group.max_clubs) * PREPARE_PERCENT ||
        u128::from(group.heap_bytes) * 100 >= u128::from(group.heap_budget_bytes) * PREPARE_PERCENT
}

pub fn below_rollover(group: &ShardGroup) -> bool {
    u128::from(group.assigned_clubs) * 100 < u128::from(group.max_clubs) * ROLLOVER_PERCENT &&
        u128::from(group.heap_bytes) * 100 < u128::from(group.heap_budget_bytes) * ROLLOVER_PERCENT
}

pub fn select<'a>(groups: &'a [ShardGroup], target: &str, now: u64) -> Option<&'a ShardGroup> {
    groups.iter().filter(|g| has_headroom(g, target, now) && below_rollover(g)).max_by(|a, b| {
        // Fill-first: keep using the most occupied eligible group. A closed
        // sibling cannot receive clubs; switching never moves existing clubs.
        (u64::from(a.assigned_clubs) * u64::from(b.max_clubs))
            .cmp(&(u64::from(b.assigned_clubs) * u64::from(a.max_clubs)))
            .then_with(|| b.id.cmp(&a.id))
    })
}

pub fn immutable_route(existing: Option<Principal>, requested: Principal) -> Result<(), String> {
    if existing.is_some_and(|id| id != requested) {
        Err("Existing route is immutable; use verified migration".into())
    } else { Ok(()) }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    #[test]
    fn photo_store_must_be_distinct() {
        let mut g = group("a", 0);
        g.photo_store = Some(g.domains[0].canister);
        assert!(validate(&g).is_err());
        g.photo_store = Some(Principal::from_slice(&[99, 1]));
        assert!(validate(&g).is_ok());
        g.photo_store = Some(Principal::anonymous());
        assert!(validate(&g).is_err());
    }
    #[test]
    fn old_records_without_photo_store_still_decode() {
        #[derive(Serialize)] struct Old { id: String, target_alias: String, domains: Vec<DomainCanister>, accepting: bool, max_clubs: u32,
            assigned_clubs: u32, heap_budget_bytes: u64, heap_bytes: u64, min_cycles: u64, cycles: u64, observed_at_ns: u64 }
        let g = group("a", 0);
        let old = Old { id: g.id.clone(), target_alias: g.target_alias.clone(), domains: g.domains.clone(), accepting: g.accepting, max_clubs: g.max_clubs,
            assigned_clubs: 0, heap_budget_bytes: g.heap_budget_bytes, heap_bytes: g.heap_bytes, min_cycles: g.min_cycles, cycles: g.cycles, observed_at_ns: 1 };
        let mut bytes = Vec::new(); ciborium::into_writer(&old, &mut bytes).unwrap();
        let back: ShardGroup = ciborium::from_reader(&bytes[..]).unwrap();
        assert_eq!(back.photo_store, None);
    }
    pub fn group(id: &str, assigned: u32) -> ShardGroup {
        ShardGroup {
            id: id.into(), target_alias: "mainnet".into(),
            domains: DOMAINS.iter().enumerate().map(|(i, name)| DomainCanister {
                domain: (*name).into(), canister: Principal::from_slice(&[i as u8 + 1, 1]),
            }).collect(),
            accepting: true, max_clubs: 100, assigned_clubs: assigned,
            heap_budget_bytes: 3 * 1024 * 1024 * 1024, heap_bytes: 100,
            min_cycles: 1_000_000_000_000, cycles: 2_000_000_000_000, observed_at_ns: 1, photo_store: None,
        }
    }
    #[test] fn complete_distinct_domains_required() {
        let mut g = group("a", 0); assert!(validate(&g).is_ok());
        g.domains.pop(); assert!(validate(&g).is_err());
        let mut g = group("a", 0); g.domains[1].canister = g.domains[0].canister;
        assert!(validate(&g).is_err());
    }
    #[test] fn fill_first_assignment_is_deterministic() {
        let rows = vec![group("b", 50), group("a", 10), group("c", 10)];
        assert_eq!(select(&rows, "mainnet", 1).map(|g| g.id.as_str()), Some("b"));
        assert!(select(&rows, "eu-engine", 1).is_none());
    }
    #[test] fn prepare_at_exactly_70_percent() {
        assert!(!needs_preparation(&group("a", 69)));
        assert!(needs_preparation(&group("a", 70)));
        let mut g = group("a", 0); g.heap_budget_bytes = 1_000;
        g.heap_bytes = 699; assert!(!needs_preparation(&g));
        g.heap_bytes = 700; assert!(needs_preparation(&g));
    }
    #[test] fn rollover_at_exactly_80_percent() {
        assert!(below_rollover(&group("a", 79)));
        assert!(!below_rollover(&group("a", 80)));
        let rows = vec![group("a", 80), group("b", 0)];
        assert_eq!(select(&rows, "mainnet", 1).map(|g| g.id.as_str()), Some("b"));
        let mut g = group("a", 0); g.heap_budget_bytes = 1_000; g.heap_bytes = 800;
        assert!(select(&[g], "mainnet", 1).is_none());
    }
    #[test] fn closed_sibling_never_receives_clubs_and_no_safe_group_blocks() {
        let mut sibling = group("b", 0); sibling.accepting = false;
        assert!(select(&[group("a", 80), sibling], "mainnet", 1).is_none());
        assert_eq!(select(&[group("a", 1), group("b", 0)], "mainnet", 1).map(|g| g.id.as_str()), Some("a"));
    }
    #[test] fn full_groups_are_not_assigned() {
        assert!(!has_headroom(&group("a", 100), "mainnet", 1));
    }
    #[test] fn stale_or_future_readings_close_admission() {
        let g = group("a", 0);
        assert!(!has_headroom(&g, "mainnet", MAX_READING_AGE_NS + 2));
        assert!(!has_headroom(&g, "mainnet", 0));
    }
    #[test] fn memory_and_cycles_gate_admission() {
        let mut g = group("a", 0); g.heap_bytes = g.heap_budget_bytes;
        assert!(!has_headroom(&g, "mainnet", 1));
        g.heap_bytes = 0; g.cycles = g.min_cycles - 1;
        assert!(!has_headroom(&g, "mainnet", 1));
        g.cycles = g.min_cycles; assert!(has_headroom(&g, "mainnet", 1));
        g.accepting = false; assert!(!has_headroom(&g, "mainnet", 1));
    }
    #[test] fn ordinary_assignment_cannot_move_existing_clubs() {
        let a = Principal::from_slice(&[1]); let b = Principal::from_slice(&[2]);
        assert!(immutable_route(None, a).is_ok());
        assert!(immutable_route(Some(a), a).is_ok());
        assert!(immutable_route(Some(a), b).is_err());
    }
    #[test] fn configured_capacity_has_explicit_bounds() {
        let mut g = group("a", 0); g.max_clubs = 0; assert!(validate(&g).is_err());
        g.max_clubs = MAX_CLUBS + 1; assert!(validate(&g).is_err());
        g.max_clubs = 100; g.heap_budget_bytes += 1; assert!(validate(&g).is_err());
    }
}