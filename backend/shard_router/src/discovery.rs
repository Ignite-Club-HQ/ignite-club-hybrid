use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use crate::groups::{ShardGroup, DOMAINS};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainPlacement { pub domain: String, pub canister: Principal, pub subnet: Principal }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct GroupPlacement {
    pub group_id: String,
    pub deployment_id: String,
    pub deployment_revision: u64,
    pub host: String,
    pub network_kind: String,
    pub primary_subnet: Principal,
    pub approved_subnets: Vec<Principal>,
    pub additional_subnets_enabled: bool,
    pub domains: Vec<DomainPlacement>,
}
pub fn validate(p: &GroupPlacement, group: &ShardGroup) -> Result<(), String> {
    if p.group_id != group.id || p.deployment_id.is_empty() || p.deployment_id.len() > 64 || p.deployment_revision == 0 ||
        !["public_mainnet", "cloud_engine"].contains(&p.network_kind.as_str()) ||
        !p.host.starts_with("https://") || p.host.len() > 512 || p.host[8..].is_empty() ||
        p.host[8..].chars().any(|c| !c.is_ascii_alphanumeric() && !".-:".contains(c)) {
        return Err("Invalid deployment placement".into());
    }
    let approved: std::collections::HashSet<_> = p.approved_subnets.iter().copied().collect();
    if approved.len() != p.approved_subnets.len() || approved.is_empty() || approved.len() > 64 ||
        !approved.contains(&p.primary_subnet) || approved.iter().any(|s| *s == Principal::anonymous() || *s == Principal::management_canister()) {
        return Err("Invalid subnet approvals".into());
    }
    let mut seen = std::collections::HashSet::new();
    for d in &p.domains {
        if !DOMAINS.contains(&d.domain.as_str()) || !seen.insert(&d.domain) ||
            !group.domains.iter().any(|g| g.domain == d.domain && g.canister == d.canister) ||
            !approved.contains(&d.subnet) || (!p.additional_subnets_enabled && d.subnet != p.primary_subnet) {
            return Err("Unapproved domain placement".into());
        }
    }
    if seen.len() != DOMAINS.len() { return Err("Incomplete domain placement".into()); }
    Ok(())
}
pub fn validate_clubs(clubs: &[String]) -> Result<(), String> {
    let distinct: std::collections::HashSet<_> = clubs.iter().collect();
    if clubs.is_empty() || clubs.len() > 20 || distinct.len() != clubs.len() ||
        clubs.iter().any(|c| c.is_empty() || c.len() > 64 || c.contains(':')) {
        return Err("Require 1-20 distinct club IDs".into());
    }
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    fn fixture() -> (ShardGroup, GroupPlacement) {
        let g = ShardGroup { id: "a".into(), target_alias: "mainnet".into(),
            domains: DOMAINS.iter().enumerate().map(|(i, d)| crate::groups::DomainCanister { domain: d.to_string(), canister: Principal::from_slice(&[i as u8 + 1, 1]) }).collect(),
            accepting: false, max_clubs: 100, assigned_clubs: 0, heap_budget_bytes: 1, heap_bytes: 0, min_cycles: 1, cycles: 1, observed_at_ns: 1, photo_store: None };
        let s = Principal::from_slice(&[50, 1]);
        let p = GroupPlacement { group_id: "a".into(), deployment_id: "ic".into(), deployment_revision: 1, host: "https://icp-api.io".into(), network_kind: "public_mainnet".into(),
            primary_subnet: s, approved_subnets: vec![s], additional_subnets_enabled: false,
            domains: g.domains.iter().map(|d| DomainPlacement { domain: d.domain.clone(), canister: d.canister, subnet: s }).collect() };
        (g, p)
    }
    #[test] fn complete_bound_placement_required() { let (g, mut p) = fixture(); assert!(validate(&p, &g).is_ok()); p.domains.pop(); assert!(validate(&p, &g).is_err()); }
    #[test] fn subnet_expansion_requires_explicit_gate() { let (g, mut p) = fixture(); let s = Principal::from_slice(&[51, 1]); p.approved_subnets.push(s); p.domains[0].subnet = s; assert!(validate(&p, &g).is_err()); p.additional_subnets_enabled = true; assert!(validate(&p, &g).is_ok()); }
    #[test] fn destination_and_origin_substitution_denied() { let (g, p) = fixture(); for host in ["http://icp-api.io", "https://user@icp-api.io", "https://icp-api.io/path", "https://icp-api.io?key=x"] { let mut bad = p.clone(); bad.host = host.into(); assert!(validate(&bad, &g).is_err()); } let mut p = p; p.domains[0].canister = Principal::anonymous(); assert!(validate(&p, &g).is_err()); }
    #[test] fn assignment_reads_bounded_and_distinct() { assert!(validate_clubs(&["a".into()]).is_ok()); assert!(validate_clubs(&[]).is_err()); assert!(validate_clubs(&vec!["a".into(); 21]).is_err()); assert!(validate_clubs(&["a".into(), "a".into()]).is_err()); }
}