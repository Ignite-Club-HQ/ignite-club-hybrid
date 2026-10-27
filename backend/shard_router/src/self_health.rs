//! Router-side health refresh at club placement time. Reads each group
//! canister's own public cycles_balance/memory_stats queries (same source as the
//! scheduled reporter) and records them only when EVERY read succeeds; a partial
//! or failed read leaves the old reading in place, so admission stays fail-closed.
//! Health is an observation: it never bumps the registry revision.
use candid::{CandidType, Deserialize, Nat, Principal};
use std::cell::Cell;
use crate::groups::{ShardGroup, MAX_READING_AGE_NS};

/// Readings younger than this are reused; bounds inter-canister calls per caller.
pub const REFRESH_AFTER_NS: u64 = 10 * 60 * 1_000_000_000;
thread_local! { static IN_FLIGHT: Cell<bool> = const { Cell::new(false) }; }

#[derive(CandidType, Deserialize)]
struct MemoryStats { heap_bytes: Nat, memory_bytes: Nat, stable_bytes: Nat }

pub fn needs_refresh(g: &ShardGroup, target: &str, now: u64) -> bool {
    g.target_alias == target && g.accepting && g.assigned_clubs < g.max_clubs &&
        (g.observed_at_ns > now || now - g.observed_at_ns >= REFRESH_AFTER_NS.min(MAX_READING_AGE_NS))
}

pub fn health_canisters(g: &ShardGroup) -> Vec<Principal> {
    // The shared workload identity is not the group's own capacity.
    g.domains.iter().filter(|d| d.domain != "secret_workload_identity").map(|d| d.canister)
        .chain(g.photo_store).collect()
}

fn to_u64(n: Nat) -> Option<u64> { u64::try_from(n.0).ok() }

async fn read(c: Principal) -> Option<(u64, u64)> {
    let cycles: Nat = ic_cdk::call::Call::bounded_wait(c, "cycles_balance").await.ok()?.candid().ok()?;
    let mem: MemoryStats = ic_cdk::call::Call::bounded_wait(c, "memory_stats").await.ok()?.candid().ok()?;
    Some((to_u64(cycles).unwrap_or(u64::MAX), to_u64(mem.heap_bytes)?))
}

pub async fn refresh_stale(target: &str) {
    if crate::private_name_writer_window::enabled() { return; }
    if IN_FLIGHT.with(|f| f.replace(true)) { return; }
    let now = ic_cdk::api::time();
    let stale: Vec<ShardGroup> = crate::GROUPS.with(|m| m.borrow().iter()
        .map(|e| crate::decode::<ShardGroup>(&e.value())).filter(|g| needs_refresh(g, target, now)).collect());
    for g in stale {
        let canisters = health_canisters(&g);
        if canisters.is_empty() { continue; }
        let (mut heap, mut cycles, mut ok) = (0u64, u64::MAX, true);
        for c in canisters {
            match read(c).await { Some((cy, h)) => { cycles = cycles.min(cy); heap = heap.max(h); } None => { ok = false; break; } }
        }
        if !ok { continue; }
        // Re-read after awaits: only overwrite the observation fields.
        if let Some(mut fresh) = crate::group_for(&g.id) {
            fresh.heap_bytes = heap; fresh.cycles = cycles; fresh.observed_at_ns = ic_cdk::api::time();
            crate::save_group(&fresh);
        }
    }
    IN_FLIGHT.with(|f| f.set(false));
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn refreshes_only_stale_open_groups_and_skips_shared_identity() {
        let mut g = crate::groups::tests::group("h", 0);
        let now = g.observed_at_ns + REFRESH_AFTER_NS;
        let t = g.target_alias.clone();
        assert!(needs_refresh(&g, &t, now));
        assert!(!needs_refresh(&g, &t, now - 1));
        assert!(!needs_refresh(&g, "other", now));
        g.accepting = false; assert!(!needs_refresh(&g, &t, now));
        g.accepting = true; g.assigned_clubs = g.max_clubs; assert!(!needs_refresh(&g, &t, now));
        assert!(health_canisters(&g).iter().all(|c| !g.domains.iter().any(|d| d.domain == "secret_workload_identity" && d.canister == *c)));
    }
}
