//! Narrow production eligibility readers; no account linking or membership grants.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use crate::group_inventory::{Binding, Domain, Placement};

const READERS: [&str; 11] = ["club_domain", "events_domain", "messaging_domain", "vault_domain", "competition_domain",
    "club_points_domain", "mini_league_domain", "media_metadata", "insights_domain", "notification_queue", "pii_access_control"];
#[derive(Clone, Debug, CandidType, Deserialize, PartialEq)]
pub struct Group { pub id: String, pub target_alias: String, pub domains: Vec<Domain>, pub photo_store: Option<Principal> }
#[derive(Clone, Debug, CandidType, Deserialize, PartialEq)]
pub struct Page { pub revision: u64, pub groups: Vec<Group>, pub placements: Vec<Placement>, pub next_cursor: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize, Default)]
pub struct Config { pub enabled: bool, pub readers: Vec<Principal> }

pub fn readers(groups: &[Group], placements: &[Placement], binding: &Binding) -> Result<Vec<Principal>, String> {
    if binding.target_alias != "mainnet" || binding.deployment_id != "mainnet" || binding.host != "https://icp-api.io" ||
        binding.network_kind != "public_mainnet" { return Err("Exact mainnet admission binding required".into()); }
    let snapshot = crate::group_inventory::Snapshot { revision: binding.registry_revision,
        groups: groups.iter().map(|g| crate::group_inventory::Group { id:g.id.clone(),target_alias:g.target_alias.clone(),domains:g.domains.clone() }).collect(),
        placements: placements.to_vec() };
    let clubs: Vec<_> = groups.iter().flat_map(|g| g.domains.iter().filter(|d| d.domain == "club_domain").map(|d| d.canister)).collect();
    crate::group_inventory::validate(&snapshot, binding, &clubs, &[])?;
    let group = groups.iter().find(|g| g.id == "g2").ok_or("Registered Group 2 required")?;
    let mut readers = Vec::new();
    for name in READERS { readers.push(group.domains.iter().find(|d| d.domain == name).ok_or("Incomplete Group 2 readers")?.canister); }
    let store = group.photo_store.ok_or("Dedicated Group 2 photo store required")?;
    if store == Principal::anonymous() || store == Principal::management_canister() ||
        groups.iter().any(|g| g.domains.iter().any(|d| d.canister == store) || (g.id != "g2" && g.photo_store == Some(store))) {
        return Err("Dedicated Group 2 photo store required".into());
    }
    readers.push(store); readers.sort(); readers.dedup();
    if readers.len() != 12 { return Err("Exact 12 Group 2 admission readers required".into()); }
    Ok(readers)
}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn exact_group2_only_readers_and_dedicated_store() {
        let (s, mut b, _) = crate::group_inventory::tests::fixture();
        b.target_alias="mainnet".into(); b.deployment_id="mainnet".into(); b.host="https://icp-api.io".into();
        let mut groups: Vec<_> = s.groups.into_iter().enumerate().map(|(i,g)| Group { id:format!("g{}",i+1),
            target_alias:b.target_alias.clone(),domains:g.domains,photo_store:Some(Principal::from_slice(&[91+i as u8,1])) }).collect();
        let mut placements=s.placements;
        for (i,p) in placements.iter_mut().enumerate() { p.group_id=groups[i].id.clone(); p.deployment_id=b.deployment_id.clone();p.host=b.host.clone(); }
        let authorized=readers(&groups,&placements,&b).unwrap();
        assert_eq!(authorized.len(),12);
        assert!(authorized.contains(&groups[1].photo_store.unwrap()));
        assert!(!authorized.contains(&groups[0].domains[0].canister));
        assert!(!authorized.contains(&groups[1].domains.iter().find(|d|d.domain=="timer_jobs").unwrap().canister));
        groups[1].photo_store=groups[0].photo_store;
        assert!(readers(&groups,&placements,&b).is_err());
    }
}