//! Separate owner-test admission. General accepting flags and lifecycle releases
//! are not changed by this protocol; receipts never grant resource membership.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use crate::{groups::{self, ShardGroup}, discovery::GroupPlacement};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct OwnerOpeningApproval {
    pub owner: Principal,
    pub group: ShardGroup,
    pub placement: GroupPlacement,
    pub club_ids: Vec<String>,
    pub expected_revision: u64,
    pub evidence_sha256: String,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct OwnerOpening {
    pub approval: OwnerOpeningApproval,
    pub accepting_new: bool,
    pub opened_revision: u64,
}
pub fn same_inventory(a: &ShardGroup, b: &ShardGroup) -> bool {
    a.id == b.id && a.target_alias == b.target_alias && a.domains == b.domains &&
        a.photo_store == b.photo_store && a.max_clubs == b.max_clubs &&
        a.heap_budget_bytes == b.heap_budget_bytes && a.min_cycles == b.min_cycles && !a.accepting && !b.accepting
}
pub fn validate(a: &OwnerOpeningApproval, group: &ShardGroup, placement: &GroupPlacement, now: u64) -> Result<(), String> {
    if a.owner == Principal::anonymous() || a.owner == Principal::management_canister() { return Err("Authenticated test owner required".into()); }
    if group.id != "g2" || group.accepting || !same_inventory(&a.group, group) || &a.placement != placement {
        return Err("Exact closed Group 2 inventory required".into());
    }
    groups::validate(group)?;
    crate::discovery::validate(placement, group)?;
    if placement.network_kind != "public_mainnet" || group.photo_store.is_none() { return Err("Dedicated mainnet photo store required".into()); }
    let distinct: std::collections::HashSet<_> = a.club_ids.iter().collect();
    if a.club_ids.is_empty() || a.club_ids.len() > 10 || distinct.len() != a.club_ids.len() || a.club_ids.iter().any(|c| !crate::is_uuid(c)) {
        return Err("Require 1-10 distinct owner test club UUIDs".into());
    }
    if a.evidence_sha256.len() != 64 || !a.evidence_sha256.bytes().all(|c| c.is_ascii_hexdigit()) {
        return Err("Opening evidence SHA-256 required".into());
    }
    let mut eligible = group.clone(); eligible.accepting = true;
    if !groups::has_headroom(&eligible, &group.target_alias, now) || !groups::below_rollover(&eligible) ||
        group.max_clubs - group.assigned_clubs < a.club_ids.len() as u32 {
        return Err("Fresh healthy Group 2 capacity required".into());
    }
    Ok(())
}