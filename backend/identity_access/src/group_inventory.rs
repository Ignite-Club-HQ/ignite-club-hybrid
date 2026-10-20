//! Local-only group registry evidence; never admission or drain authority.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const DOMAINS: [&str; 13] = ["club_domain", "events_domain", "messaging_domain", "vault_domain",
    "competition_domain", "club_points_domain", "mini_league_domain", "media_metadata", "insights_domain",
    "notification_queue", "pii_access_control", "timer_jobs", "secret_workload_identity"];

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Binding {
    pub registry: Principal,
    pub registry_revision: u64,
    pub target_alias: String,
    pub deployment_id: String,
    pub deployment_revision: u64,
    pub host: String,
    pub network_kind: String,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Domain { pub domain: String, pub canister: Principal }
// Candid record subtyping lets us ignore registry capacity/health fields.
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Group { pub id: String, pub target_alias: String, pub domains: Vec<Domain> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainPlacement { pub domain: String, pub canister: Principal, pub subnet: Principal }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Placement {
    pub group_id: String, pub deployment_id: String, pub deployment_revision: u64,
    pub host: String, pub network_kind: String, pub primary_subnet: Principal,
    pub approved_subnets: Vec<Principal>, pub additional_subnets_enabled: bool,
    pub domains: Vec<DomainPlacement>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snapshot { pub revision: u64, pub groups: Vec<Group>, pub placements: Vec<Placement> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Evidence { pub binding: Binding, pub history_revision: u64, pub snapshot: Snapshot }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Supplemental { pub group_id: String, pub domain: String, pub canister: Principal, pub subnet: Principal }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaRegistry { pub active: bool, pub stores: Vec<Principal> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct MediaEvidence { pub club_authority: Principal, pub registry: MediaRegistry }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct RemovalInventory { pub groups: Evidence, pub supplemental: Vec<Supplemental>, pub media: Vec<MediaEvidence> }

pub fn validate_complete(s: &Snapshot, b: &Binding, clubs: &[Principal], readers: &[Principal], extra: &[Supplemental], media: &[MediaEvidence]) -> Result<(), String> {
    validate(s, b, clubs, &[])?;
    if extra.is_empty() || extra.len() > 256 || media.len() != s.groups.len() { return Err("Complete bounded media inventory required".into()); }
    let mut all: BTreeSet<_> = s.groups.iter().flat_map(|g| g.domains.iter().map(|d| d.canister)).collect();
    let mut stores = BTreeSet::new();
    for e in extra {
        let p = s.placements.iter().find(|p| p.group_id == e.group_id).ok_or("Foreign supplemental group")?;
        if !(DOMAINS.contains(&e.domain.as_str()) || ["media_blob_store", "identity_access", "placement_registry", "shard_router"].contains(&e.domain.as_str())) ||
            !principal_ok(e.canister) || !all.insert(e.canister) || !p.approved_subnets.contains(&e.subnet) ||
            (!p.additional_subnets_enabled && e.subnet != p.primary_subnet) { return Err("Invalid supplemental authority placement".into()); }
        if e.domain == "media_blob_store" { stores.insert(e.canister); }
    }
    let mut observed = BTreeSet::new(); let mut authorities = BTreeSet::new();
    for g in &s.groups {
        let club = g.domains.iter().find(|d| d.domain == "club_domain").ok_or("Missing club")?.canister;
        let evidence = media.iter().find(|v| v.club_authority == club).ok_or("Missing club media registry")?;
        if !authorities.insert(club) || evidence.registry.stores.is_empty() || evidence.registry.stores.len() > 64 { return Err("Incomplete media registry".into()); }
        for store in &evidence.registry.stores {
            if !principal_ok(*store) || !observed.insert(*store) || !extra.iter().any(|e| e.domain == "media_blob_store" && e.group_id == g.id && e.canister == *store) {
                return Err("Omitted, duplicate or foreign media store".into());
            }
        }
    }
    if stores != observed || readers.iter().any(|r| !all.contains(r)) { return Err("Missing registered service or media authority".into()); }
    Ok(())
}

fn principal_ok(p: Principal) -> bool { p != Principal::anonymous() && p != Principal::management_canister() }
pub fn validate_binding(b: &Binding) -> Result<(), String> {
    let valid_id = |s: &str| !s.is_empty() && s.len() <= 64 && s.bytes().all(|v| v.is_ascii_alphanumeric() || b"-_.:".contains(&v));
    let authority = b.host.strip_prefix("https://").unwrap_or("");
    if !principal_ok(b.registry) || b.registry_revision == 0 || b.deployment_revision == 0 ||
        !valid_id(&b.target_alias) || !valid_id(&b.deployment_id) || b.host.len() > 512 || authority.is_empty() ||
        !authority.bytes().all(|v| v.is_ascii_alphanumeric() || b".-:".contains(&v)) ||
        !["public_mainnet", "cloud_engine"].contains(&b.network_kind.as_str()) {
        return Err("Invalid group inventory binding".into());
    }
    Ok(())
}
pub fn validate(snapshot: &Snapshot, b: &Binding, clubs: &[Principal], readers: &[Principal]) -> Result<(), String> {
    validate_binding(b)?;
    if snapshot.revision != b.registry_revision || snapshot.groups.is_empty() || snapshot.groups.len() > 4096 ||
        snapshot.groups.len() != snapshot.placements.len() || clubs.is_empty() {
        return Err("Incomplete or stale group inventory".into());
    }
    let mut group_ids = BTreeSet::new(); let mut placement_ids = BTreeSet::new();
    let mut all = BTreeSet::new(); let mut club_ids = BTreeSet::new(); let mut subnet_binding = None;
    let mut shared_workload = None;
    for p in &snapshot.placements { if !placement_ids.insert(&p.group_id) { return Err("Duplicate placement".into()); } }
    for g in &snapshot.groups {
        if g.id.is_empty() || g.id.len() > 64 || !group_ids.insert(&g.id) || g.target_alias != b.target_alias {
            return Err("Foreign or duplicate group".into());
        }
        let p = snapshot.placements.iter().find(|p| p.group_id == g.id).ok_or("Missing placement")?;
        if p.deployment_id != b.deployment_id || p.deployment_revision != b.deployment_revision || p.host != b.host || p.network_kind != b.network_kind {
            return Err("Foreign deployment placement".into());
        }
        let approved: BTreeSet<_> = p.approved_subnets.iter().copied().collect();
        if approved.is_empty() || approved.len() > 64 || approved.len() != p.approved_subnets.len() ||
            !approved.contains(&p.primary_subnet) || approved.iter().any(|s| !principal_ok(*s)) {
            return Err("Invalid subnet approvals".into());
        }
        let signature = (p.primary_subnet, approved.clone(), p.additional_subnets_enabled);
        if subnet_binding.as_ref().is_some_and(|prior| prior != &signature) { return Err("Mixed subnet approvals".into()); }
        subnet_binding = Some(signature);
        let mut names = BTreeSet::new(); let mut placed_names = BTreeSet::new();
        for d in &p.domains { if !placed_names.insert(&d.domain) { return Err("Duplicate placed domain".into()); } }
        if g.domains.len() != DOMAINS.len() || p.domains.len() != DOMAINS.len() { return Err("Incomplete domain inventory".into()); }
        for d in &g.domains {
            if !DOMAINS.contains(&d.domain.as_str()) || !names.insert(&d.domain) || !principal_ok(d.canister) {
                return Err("Invalid or shared group authority".into());
            }
            if d.domain == "secret_workload_identity" {
                if shared_workload.is_some_and(|prior| prior != d.canister) { return Err("Mixed shared workload authority".into()); }
                if shared_workload.is_none() && !all.insert(d.canister) { return Err("Shared workload collides with group authority".into()); }
                shared_workload = Some(d.canister);
            } else if !all.insert(d.canister) { return Err("Invalid or shared group authority".into()); }
            let placed = p.domains.iter().find(|v| v.domain == d.domain).ok_or("Missing placed domain")?;
            if placed.canister != d.canister || !approved.contains(&placed.subnet) ||
                (!p.additional_subnets_enabled && placed.subnet != p.primary_subnet) { return Err("Unapproved domain placement".into()); }
            if d.domain == "club_domain" { club_ids.insert(d.canister); }
        }
    }
    if clubs.iter().any(|p| !club_ids.contains(p)) || readers.iter().any(|p| !all.contains(p)) {
        return Err("Missing configured legacy authority or service reader".into());
    }
    Ok(())
}

#[cfg(test)] pub(crate) mod tests {
    use super::*;
    pub(crate) fn fixture() -> (Snapshot, Binding, Vec<Principal>) {
        let p = |i| Principal::from_slice(&[i, 1]);
        let b = Binding { registry: p(90), registry_revision: 4, target_alias: "local".into(), deployment_id: "replica".into(),
            deployment_revision: 1, host: "https://isolated.invalid".into(), network_kind: "public_mainnet".into() };
        let groups: Vec<_> = (0..2).map(|n| Group { id: format!("g{n}"), target_alias: b.target_alias.clone(),
            domains: DOMAINS.iter().enumerate().map(|(i, d)| Domain { domain: d.to_string(), canister: if *d == "secret_workload_identity" { p(70) } else { p(1 + i as u8 + n * 20) } }).collect() }).collect();
        let placements = groups.iter().map(|g| Placement { group_id: g.id.clone(), deployment_id: b.deployment_id.clone(),
            deployment_revision: 1, host: b.host.clone(), network_kind: b.network_kind.clone(), primary_subnet: p(80),
            approved_subnets: vec![p(80)], additional_subnets_enabled: false,
            domains: g.domains.iter().map(|d| DomainPlacement { domain: d.domain.clone(), canister: d.canister, subnet: p(80) }).collect() }).collect();
        (Snapshot { revision: 4, groups, placements }, b, vec![p(1), p(21)])
    }
    #[test] fn complete_two_group_inventory_and_legacy_coverage() {
        let (mut s, b, clubs) = fixture(); assert!(validate(&s, &b, &clubs, &[]).is_ok());
        s.groups.pop(); s.placements.pop(); assert!(validate(&s, &b, &clubs, &[]).is_err());
    }
    #[test] fn every_domain_and_placement_required() {
        let (s, b, clubs) = fixture();
        for i in 0..13 { let mut bad = s.clone(); bad.groups[0].domains.remove(i); assert!(validate(&bad, &b, &clubs, &[]).is_err()); }
        let mut bad = s; bad.placements[1].domains.pop(); assert!(validate(&bad, &b, &clubs, &[]).is_err());
    }
    #[test] fn shared_global_is_exact_and_cannot_alias_a_routed_domain() {
        let (s,b,clubs) = fixture(); assert!(validate(&s,&b,&clubs,&[]).is_ok());
        let mut mixed=s.clone(); mixed.groups[1].domains[12].canister=Principal::from_slice(&[71,1]);
        mixed.placements[1].domains[12].canister=mixed.groups[1].domains[12].canister;
        assert!(validate(&mixed,&b,&clubs,&[]).is_err());
        let mut alias=s; alias.groups[1].domains[1].canister=alias.groups[0].domains[12].canister;
        alias.placements[1].domains[1].canister=alias.groups[1].domains[1].canister;
        assert!(validate(&alias,&b,&clubs,&[]).is_err());
    }
    #[test] fn foreign_revision_deployment_and_shared_authorities_denied() {
        let (s, b, clubs) = fixture(); let mut bad = s.clone(); bad.revision = 3; assert!(validate(&bad, &b, &clubs, &[]).is_err());
        let mut bad = s.clone(); bad.placements[0].deployment_id = "foreign".into(); assert!(validate(&bad, &b, &clubs, &[]).is_err());
        let mut bad = s; bad.groups[1].domains[0].canister = clubs[0]; bad.placements[1].domains[0].canister = clubs[0];
        assert!(validate(&bad, &b, &clubs, &[]).is_err());
    }
    #[test] fn optional_subnet_requires_explicit_approval() {
        let (mut s, b, clubs) = fixture(); let extra = Principal::from_slice(&[81, 1]);
        for p in &mut s.placements { p.approved_subnets.push(extra); }
        s.placements[0].domains[0].subnet = extra; assert!(validate(&s, &b, &clubs, &[]).is_err());
        for p in &mut s.placements { p.additional_subnets_enabled = true; }
        assert!(validate(&s, &b, &clubs, &[]).is_ok());
    }
    #[test] fn unlisted_media_reader_and_untrusted_origins_fail_closed() {
        let (s, b, clubs) = fixture(); assert!(validate(&s, &b, &clubs, &[Principal::from_slice(&[99, 1])]).is_err());
        for host in ["http://isolated.invalid", "https://user@isolated.invalid", "https://isolated.invalid/path", "https://isolated.invalid?x"] {
            let mut bad = b.clone(); bad.host = host.into(); assert!(validate_binding(&bad).is_err());
        }
    }
    #[test] fn complete_media_and_delegated_service_inventory_rejects_every_omission() {
        let (s,b,clubs) = fixture(); let p = |n| Principal::from_slice(&[n,1]);
        let extra = vec![Supplemental { group_id:"g0".into(),domain:"media_blob_store".into(),canister:p(91),subnet:p(80) },
            Supplemental { group_id:"g1".into(),domain:"media_blob_store".into(),canister:p(92),subnet:p(80) },
            Supplemental { group_id:"g0".into(),domain:"vault_domain".into(),canister:p(93),subnet:p(80) }];
        let media = vec![MediaEvidence {club_authority:clubs[0],registry:MediaRegistry {active:false,stores:vec![p(91)]}},
            MediaEvidence {club_authority:clubs[1],registry:MediaRegistry {active:true,stores:vec![p(92)]}}];
        assert!(validate_complete(&s,&b,&clubs,&[p(93),p(91)],&extra,&media).is_ok());
        for n in 0..extra.len() { let mut bad=extra.clone(); bad.remove(n); assert!(validate_complete(&s,&b,&clubs,&[p(93)],&bad,&media).is_err()); }
        let mut bad=media.clone(); bad[0].registry.stores.push(p(94)); assert!(validate_complete(&s,&b,&clubs,&[],&extra,&bad).is_err());
        let mut bad=extra.clone(); bad[1].group_id="g0".into(); assert!(validate_complete(&s,&b,&clubs,&[],&bad,&media).is_err());
        let mut bad=extra.clone(); bad[0].subnet=p(81); assert!(validate_complete(&s,&b,&clubs,&[],&bad,&media).is_err());
        assert!(validate_complete(&s,&b,&clubs,&[p(95)],&extra,&media).is_err());
    }
}