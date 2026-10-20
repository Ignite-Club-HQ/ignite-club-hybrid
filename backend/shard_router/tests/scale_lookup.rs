//! Offline native kernel benchmark; not an IC instruction measurement.
#[path = "../src/groups.rs"]
mod groups;
#[path = "../src/group_index.rs"]
mod group_index;
use std::{collections::BTreeMap, hint::black_box, time::Instant};

#[test]
fn scale_lookup() {
    for count in [groups::MAX_GROUPS, 500] {
        let mut rows: Vec<_> = (0..count).map(|i| {
            let mut g = groups::tests::group(&format!("g{i:03}"), 0);
            g.max_clubs = 100_000;
            g
        }).collect();
        let mut assignments = BTreeMap::new();
        let start = Instant::now();
        for i in 0..100_000 {
            let selected = groups::select(&rows, "mainnet", 1).unwrap().id.clone();
            rows.iter_mut().find(|g| g.id == selected).unwrap().assigned_clubs += 1;
            assignments.insert(format!("club-{i:06}"), selected);
        }
        let placement = start.elapsed().as_nanos();
        let start = Instant::now();
        for i in 0..100_000 { black_box(assignments.get(&format!("club-{i:06}")).unwrap()); }
        let lookup = start.elapsed().as_nanos();
        assert_eq!(assignments.len(), 100_000);
        println!("groups={count} assignments=100000 placement_total_ns={placement} placement_mean_ns={} lookup_total_ns={lookup} lookup_mean_ns={} candidate_visits={}", placement / 100_000, lookup / 100_000, count * 100_000);
        let mut indexed_rows: BTreeMap<_, _> = (0..count).map(|i| {
            let mut g = groups::tests::group(&format!("g{i:04}"), 0); g.max_clubs = 100_000;
            (g.id.clone(), g)
        }).collect();
        let mut index = group_index::GroupIndex::default();
        for g in indexed_rows.values() { index.upsert(g); }
        let mut visits = 0;
        let start = Instant::now();
        for _ in 0..100_000 {
            let id = index.pick("mainnet", |id| {
                visits += 1;
                indexed_rows.get(id).filter(|g| groups::has_headroom(g, "mainnet", 1)).map(|g| g.id.clone())
            }).unwrap();
            let g = indexed_rows.get_mut(&id).unwrap();
            g.assigned_clubs += 1; index.upsert(g);
        }
        assert_eq!(visits, 100_000);
        assert_eq!(indexed_rows.values().map(|g| u64::from(g.assigned_clubs)).sum::<u64>(), 100_000);
        println!("indexed groups={count} assignments=100000 total_ns={} candidate_visits={visits}", start.elapsed().as_nanos());
    }
}
