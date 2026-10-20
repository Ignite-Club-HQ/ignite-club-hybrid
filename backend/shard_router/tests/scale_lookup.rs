//! Offline native kernel benchmark; not an IC instruction measurement.
#[path = "../src/groups.rs"]
mod groups;
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
    }
}
