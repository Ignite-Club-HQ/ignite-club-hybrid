//! Synthetic shard registry for the local ICP scaling POC.
//! No production identities, routes, controllers, or external calls are used.

use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, StableCell,
};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
const PRIVATE_NAME_WRITER_MEMORY: u8 = 26;
#[path = "../../shared/private_name_writer_window.rs"]
mod private_name_writer_window;
use private_name_writer_window::{WriterRequest, WriterReceipt};
#[ic_cdk::update]
fn freeze_private_name_preparation(request: WriterRequest) -> Result<(), String> { private_name_writer_window::freeze(request) }
#[ic_cdk::update]
fn read_private_name_preparation(request: WriterRequest) -> Result<WriterReceipt, String> { private_name_writer_window::preparation_receipt(request) }
#[ic_cdk::update]
fn activate_private_name_preparation(request: WriterRequest) -> Result<(), String> { private_name_writer_window::activate_preparation(request) }
#[ic_cdk::update]
fn finish_private_name_preparation(request: WriterRequest) -> Result<(), String> { private_name_writer_window::finish_preparation(request) }
#[ic_cdk::update]
fn open_private_name_writer_window(_request: WriterRequest) -> Result<(), String> { Err("Topology writes remain closed during private-name rehearsal".into()) }
#[ic_cdk::update]
fn seal_private_name_writer_window(request: WriterRequest) -> Result<(), String> { private_name_writer_window::seal(request) }
#[ic_cdk::update]
fn read_private_name_writer_window(request: WriterRequest) -> Result<WriterReceipt, String> { private_name_writer_window::receipt(request) }

mod groups;
mod self_health;
mod group_index;
#[cfg(feature = "scale-probe")]
mod scale_probe;
mod website;
#[cfg(feature = "scale-probe")]
use scale_probe::Probe;
mod discovery;
mod media_growth;
mod owner_opening;
mod routing_approval;
use routing_approval::RoutingApproval;
#[cfg(test)]
mod owner_opening_tests;
use owner_opening::{OwnerOpening, OwnerOpeningApproval};
use discovery::GroupPlacement;
use groups::{GroupAssignment, ShardGroup};

type Memory = VirtualMemory<DefaultMemoryImpl>;
type Outcome<T> = Result<T, String>;
const MAX_CLUB_ID_BYTES: usize = 64;
const MAX_PAGE: u16 = 100;
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct DeletionLock { pub account_id: String, pub revision: u64 }
fn registry_writable() -> Outcome<()> {
    private_name_writer_window::require_window();
    if DELETION_LOCKS.with(|m| m.borrow().len()) > 0 { return Err("Deletion registry locked".into()); }
    Ok(())
}
fn deletion_authority() -> Option<Principal> {
    DELETION_AUTHORITY.with(|m| { let b=m.borrow().get().clone(); if b.is_empty() {None} else {Some(Principal::from_slice(&b))} })
}
#[ic_cdk::update]
fn set_deletion_authority(authority: Principal) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?; validate_shard(authority)?;
    if deletion_authority().is_some_and(|p| p != authority) { return Err("Deletion authority immutable".into()); }
    if deletion_authority() == Some(authority) { return Ok(()); }
    DELETION_AUTHORITY.with(|m| m.borrow_mut().set(authority.as_slice().to_vec()));
    bump_configuration_revision(); Ok(())
}
#[ic_cdk::update]
fn acquire_deletion_lock(account_id: String, expected_revision: u64) -> Outcome<DeletionLock> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    if deletion_authority() != Some(caller()) { return Err("Deletion authority required".into()); }
    if account_id.is_empty() || account_id.len()>128 { return Err("Invalid account id".into()); }
    if current_revision()!=expected_revision { return Err("Deletion registry revision changed".into()); }
    let lock=DeletionLock { account_id:account_id.clone(), revision:expected_revision };
    if let Some(bytes)=DELETION_LOCKS.with(|m| m.borrow().get(&account_id)) {
        if decode::<DeletionLock>(&bytes)!=lock { return Err("Deletion lock conflict".into()); }
        return Ok(lock);
    }
    if DELETION_LOCKS.with(|m| m.borrow().len())>=10000 { return Err("Deletion lock capacity".into()); }
    DELETION_LOCKS.with(|m| m.borrow_mut().insert(account_id,encode(&lock))); Ok(lock)
}
#[ic_cdk::update]
fn release_deletion_lock(account_id: String, expected_revision: u64) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    if deletion_authority()!=Some(caller()) { return Err("Deletion authority required".into()); }
    if let Some(bytes)=DELETION_LOCKS.with(|m| m.borrow().get(&account_id)) {
        if decode::<DeletionLock>(&bytes).revision!=expected_revision { return Err("Deletion lock conflict".into()); }
        DELETION_LOCKS.with(|m| m.borrow_mut().remove(&account_id));
    }
    Ok(())
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Route {
    pub club_id: String,
    pub shard: Principal,
    pub revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page {
    pub revision: u64,
    pub routes: Vec<Route>,
    pub next: Option<String>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssignRequest {
    pub club_id: String,
    pub shard: Principal,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssignResult {
    pub route: Route,
    pub revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Migration {
    pub club_id: String,
    pub source: Principal,
    pub destination: Principal,
    pub route_revision: u64,
    pub migration_revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainRoute {
    pub club_id: String,
    pub domain: String,
    pub shard: Principal,
    pub revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssignDomainRequest {
    pub club_id: String,
    pub domain: String,
    pub shard: Principal,
    pub expected_revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AssignDomainResult {
    pub route: DomainRoute,
    pub revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct DomainMigration {
    pub club_id: String,
    pub domain: String,
    pub source: Principal,
    pub destination: Principal,
    pub route_revision: u64,
    pub migration_revision: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Init {
    pub governor: Principal,
}

thread_local! {
    static MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> =
        RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    // Memory IDs are permanent schema assignments.
    static GOVERNOR: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(
        StableCell::init(memory(0), Vec::new())
    );
    static ROUTES: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(
        StableBTreeMap::init(memory(1))
    );
    static REVISION: RefCell<StableCell<u64, Memory>> = RefCell::new(
        StableCell::init(memory(2), 0)
    );
    static MIGRATIONS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(
        StableBTreeMap::init(memory(3))
    );
    static DOMAIN_ROUTES: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(
        StableBTreeMap::init(memory(4))
    );
    static DOMAIN_MIGRATIONS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(
        StableBTreeMap::init(memory(5))
    );
    static GROUPS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(6)));
    static GROUP_ASSIGNMENTS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(7)));
    // Additive partition; never reuse IDs belonging to existing deployments.
    static GROUP_PLACEMENTS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(8)));
    // Additive permanent partitions: no expiry or governor unlock bypass.
    static DELETION_AUTHORITY: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(10), Vec::new()));
    static DELETION_LOCKS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(11)));
    // Per-principal count of self-service new-club placements (abuse cap).
    static PLACERS: RefCell<StableBTreeMap<Vec<u8>, u64, Memory>> = RefCell::new(StableBTreeMap::init(memory(9)));
    static MEDIA_GROWTH: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(12)));
    // Additive store-principal partition; never reinterpret legacy group bytes.
    static GROUP_INDEX: RefCell<Option<group_index::GroupIndex>> = const { RefCell::new(None) };
    static STORE_GROWTH: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(13)));
    // Additive creator binding; old assignments never imply creator ownership.
    static PLACEMENT_OWNERS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(14)));
    // Permanent additive partition. Stop preserves the owner's route discovery.
    // Configuration approval is independent of assignment/deletion fencing (memory 2).
    static CONFIG_REVISION: RefCell<StableCell<u64, Memory>> = RefCell::new(StableCell::init(memory(16), 0));
    static OWNER_OPENINGS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(15)));
    // Governor-recorded routing approvals keyed by target alias (memory 17).
    static ROUTING_APPROVALS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(17)));
    // Website fallback club_domain for clubs predating group assignment (memory 25;
    // 18-24 stay reserved).
    static WEBSITE_DEFAULT: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(25), Vec::new()));
}

/// Owning club_domain for a club: explicit domain route, then group
/// assignment, then the governor-set legacy default.
fn website_club_domain(club_id: &str) -> Option<Principal> {
    if let Some(r) = domain_route_for(club_id, "club_domain") { return Some(r.shard); }
    if let Some(a) = group_assignment_for(club_id) {
        return group_for(&a.group_id).and_then(|g| g.domains.iter().find(|d| d.domain == "club_domain").map(|d| d.canister));
    }
    let raw = WEBSITE_DEFAULT.with(|c| c.borrow().get().clone());
    (!raw.is_empty()).then(|| Principal::from_slice(&raw))
}

/// Governor-only: club_domain serving clubs that have no group assignment.
#[ic_cdk::update]
fn set_website_default_club_domain(canister: Principal) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; validate_shard(canister)?;
    WEBSITE_DEFAULT.with(|c| c.borrow_mut().set(canister.as_slice().to_vec()));
    Ok(())
}

/// Public club-website resolver: redirects /club?id=..&scope=.. to the owning group.
#[ic_cdk::query]
fn http_request(req: website::HttpRequest) -> website::HttpResponse {
    match website::parse(&req) {
        Err(resp) => resp,
        Ok((id, scope)) => website::redirect(website_club_domain(&id), &id, &scope),
    }
}

fn owner_opening(target: &str) -> Option<OwnerOpening> {
    OWNER_OPENINGS.with(|m| m.borrow().get(&target.to_string()).map(|b| decode(&b)))
}
fn open_owner_group_for(operator: Principal, approval: OwnerOpeningApproval, now: u64) -> Outcome<OwnerOpening> {
    if governor() != Some(operator) || operator == Principal::anonymous() { return Err("Governor required".into()); }
    registry_writable()?;
    let target = approval.group.target_alias.clone();
    if let Some(old) = owner_opening(&target) {
        // A lost opening response may be read back without another mutation.
        if old.approval == approval && old.accepting_new { return Ok(old); }
        return Err("Owner opening already bound; stop does not reset or reassign it".into());
    }
    if current_revision() != approval.expected_revision { return Err("Revision conflict".into()); }
    let group = group_for(&approval.group.id).ok_or("Unknown group")?;
    let placement: GroupPlacement = GROUP_PLACEMENTS.with(|m| m.borrow().get(&group.id.as_bytes().to_vec()).map(|b| decode(&b))).ok_or("Complete placement required")?;
    owner_opening::validate(&approval, &group, &placement, now)?;
    for club in &approval.club_ids {
        if group_assignment_for(club).is_some() || route_for(club).is_some() || migration_for(club).is_some() ||
            DOMAIN_ROUTES.with(|m| m.borrow().range(domain_key(club, "")..).next().is_some_and(|e| e.key().starts_with(&domain_key(club, "")))) {
            return Err("Owner test approval must contain only fresh clubs".into());
        }
    }
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    let receipt = OwnerOpening { approval, accepting_new: true, opened_revision: revision };
    OWNER_OPENINGS.with(|m| m.borrow_mut().insert(target, encode(&receipt)));
    REVISION.with(|m| m.borrow_mut().set(revision));
    bump_configuration_revision();
    Ok(receipt)
}
/// Explicit governor signature grants only bounded owner test placement, not
/// global admission, membership, recovery release or general accepting status.
#[ic_cdk::update]
fn open_owner_test_group(approval: OwnerOpeningApproval) -> Outcome<OwnerOpening> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    open_owner_group_for(caller(), approval, ic_cdk::api::time())
}
fn stop_owner_group_for(operator: Principal, target: String, expected_revision: u64) -> Outcome<OwnerOpening> {
    if governor() != Some(operator) || operator == Principal::anonymous() { return Err("Governor required".into()); }
    registry_writable()?;
    let mut receipt = owner_opening(&target).ok_or("No owner opening")?;
    if !receipt.accepting_new { return Ok(receipt); }
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    receipt.accepting_new = false;
    OWNER_OPENINGS.with(|m| m.borrow_mut().insert(target, encode(&receipt)));
    REVISION.with(|m| m.borrow_mut().set(revision));
    bump_configuration_revision();
    Ok(receipt)
}
#[ic_cdk::update]
fn stop_owner_test_group(target_alias: String, expected_revision: u64) -> Outcome<OwnerOpening> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    stop_owner_group_for(caller(), target_alias, expected_revision)
}
fn stop_group_placements_for(operator: Principal, group_id: String, target_alias: String, expected_revision: u64) -> Outcome<u64> {
    if operator == Principal::anonymous() || governor() != Some(operator) { return Err("Governor required".into()); }
    registry_writable()?;
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let mut group = group_for(&group_id).ok_or("Unknown group")?;
    if group.target_alias != target_alias { return Err("Group belongs to another deployment".into()); }
    let mut opening = owner_opening(&target_alias).filter(|r| r.approval.group.id == group_id);
    if !group.accepting && !opening.as_ref().is_some_and(|r| r.accepting_new) { return Ok(current_revision()); }
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    group.accepting = false;
    save_group(&group);
    if let Some(ref mut receipt) = opening {
        receipt.accepting_new = false;
        OWNER_OPENINGS.with(|m| m.borrow_mut().insert(target_alias, encode(receipt)));
    }
    REVISION.with(|m| m.borrow_mut().set(revision));
    bump_configuration_revision();
    Ok(revision)
}
/// Governor-only stop for general and trial admission. Never removes assignments
/// or changes membership, service endpoints, media, or opening authorization.
#[ic_cdk::update]
fn stop_group_new_placements(group_id: String, target_alias: String, expected_revision: u64) -> Outcome<u64> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    stop_group_placements_for(caller(), group_id, target_alias, expected_revision)
}
/// Caller-scoped consensus discovery, including after stopping new placements.
#[ic_cdk::update]
fn read_my_owner_test_opening(target_alias: String) -> Outcome<Option<OwnerOpening>> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let user = caller();
    if user == Principal::anonymous() { return Err("Authentication required".into()); }
    if target_alias.is_empty() || target_alias.len() > 64 { return Err("Invalid target alias".into()); }
    Ok(owner_opening(&target_alias).filter(|r| r.approval.owner == user || governor() == Some(user)))
}
/// No private approval data: admins deleting a different account still need
/// the complete group inventory, even when they have no test-club membership.
#[ic_cdk::update]
fn read_owner_test_deletion_required(target_alias: String) -> Outcome<bool> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    if caller() == Principal::anonymous() { return Err("Authentication required".into()); }
    if target_alias.is_empty() || target_alias.len() > 64 { return Err("Invalid target alias".into()); }
    Ok(owner_opening(&target_alias).is_some())
}

fn media_growth_local() -> bool {
    #[cfg(test)] { TEST_GROWTH.with(|v| *v.borrow()) }
    #[cfg(not(test))] { ic_cdk::api::env_var_name_exists("IGNITE_MEDIA_GROWTH_LOCAL_REHEARSAL") && ic_cdk::api::env_var_value("IGNITE_MEDIA_GROWTH_LOCAL_REHEARSAL") == "1" }
}
#[cfg(test)]
thread_local! { static TEST_GROWTH: RefCell<bool> = const { RefCell::new(false) }; }
fn growth_budget(group: &str) -> Option<media_growth::Budget> {
    MEDIA_GROWTH.with(|m| m.borrow().get(&group.as_bytes().to_vec()).map(|b| decode(&b)))
}
fn save_growth(b: &media_growth::Budget) {
    MEDIA_GROWTH.with(|m| m.borrow_mut().insert(b.group_id.as_bytes().to_vec(), encode(b)));
}
fn verified_store_growth(group: &str) -> Option<media_growth::StoreBudget> {
    let g = group_for(group)?;
    let store = g.photo_store?;
    if GROUPS.with(|m| m.borrow().iter().map(|e| decode::<ShardGroup>(&e.value())).any(|other| other.id != group && other.photo_store == Some(store))) {
        return None;
    }
    let authority = g.domains.iter().find(|d| d.domain == "club_domain")?.canister;
    let b: media_growth::StoreBudget = STORE_GROWTH.with(|m| m.borrow().get(&store.as_slice().to_vec()).map(|raw| decode(&raw)))?;
    b.matches(group, &g.target_alias, authority, store).then_some(b)
}
fn save_store_growth(b: &media_growth::StoreBudget) {
    STORE_GROWTH.with(|m| m.borrow_mut().insert(b.store.as_slice().to_vec(), encode(b)));
}
#[ic_cdk::update]
fn configure_store_media_growth(group_id: String, store: Principal, usable: u64, fixed: u64,
    baseline: Vec<(String, u64)>, expected_revision: u64, evidence_revision: u64) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    if !media_growth_local() { return Err("Local media growth only".into()); }
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let group = group_for(&group_id).ok_or("Unknown group")?;
    if group.photo_store != Some(store) || STORE_GROWTH.with(|m| m.borrow().contains_key(&store.as_slice().to_vec())) {
        return Err("Immutable unique store baseline required".into());
    }
    // A physical store cannot fund two independent group budgets.
    if GROUPS.with(|m| m.borrow().iter().map(|e| decode::<ShardGroup>(&e.value())).any(|g| g.id != group_id && g.photo_store == Some(store))) {
        return Err("Store belongs to another group".into());
    }
    let legacy = growth_budget(&group_id).ok_or("Missing exact club baseline")?;
    let authority = group.domains.iter().find(|d| d.domain == "club_domain").ok_or("Missing authority")?.canister;
    if legacy.authority != authority || legacy.target_alias != group.target_alias { return Err("Growth binding changed".into()); }
    let assigned: Vec<String> = GROUP_ASSIGNMENTS.with(|m| m.borrow().iter().map(|e| decode::<GroupAssignment>(&e.value()))
        .filter(|a| a.group_id == group_id).map(|a| a.club_id).collect());
    if assigned.len() != legacy.commitments.len() || assigned.iter().any(|id| !legacy.commitments.contains_key(id)) {
        return Err("Exact assigned-club baseline required".into());
    }
    let b = media_growth::StoreBudget::import(store, evidence_revision, &legacy, usable, fixed, baseline)?;
    save_store_growth(&b); bump_configuration_revision(); Ok(())
}
#[ic_cdk::update]
fn configure_group_media_growth(group_id: String, usable: u64, fixed: u64, free_club: u64, baseline: Vec<(String, u64)>, expected_revision: u64) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    if !media_growth_local() { return Err("Local media growth only".into()); }
    if current_revision() != expected_revision || growth_budget(&group_id).is_some() { return Err("Immutable growth baseline required".into()); }
    let group = group_for(&group_id).ok_or("Unknown group")?;
    let authority = group.domains.iter().find(|d| d.domain == "club_domain").ok_or("Missing club authority")?.canister;
    if usable == 0 || usable > 64 * 34_359_738_368 || fixed > usable || free_club == 0 || baseline.len() > 100_000 {
        return Err("Invalid physical baseline".into());
    }
    let assigned: Vec<GroupAssignment> = GROUP_ASSIGNMENTS.with(|m| m.borrow().iter().map(|e| decode::<GroupAssignment>(&e.value())).filter(|a| a.group_id == group_id).collect());
    if assigned.len() != baseline.len() { return Err("Exact assigned-club baseline required".into()); }
    let mut b = media_growth::Budget { group_id, target_alias: group.target_alias, authority, usable, fixed, free_club, commitments: Default::default() };
    for (club, bytes) in baseline {
        if b.commitments.contains_key(&club) || !assigned.iter().any(|a| a.club_id == club) { return Err("Baseline club mismatch".into()); }
        b.reserve(&club, bytes)?;
    }
    save_growth(&b); bump_configuration_revision(); Ok(())
}
fn reserve_growth_for(user: Principal, group_id: &str, target_alias: &str, club: &str, bytes: u64) -> Outcome<u64> {
    registry_writable()?;
    if !media_growth_local() { return Err("Local media growth only".into()); }
    let mut store = verified_store_growth(group_id).ok_or("Verified per-store growth baseline required")?;
    let b = &mut store.budget;
    if user != b.authority || b.target_alias != target_alias || group_assignment_for(club).is_none_or(|a| a.group_id != group_id) {
        return Err("Assigned club authority required".into());
    }
    let result = b.reserve(club, bytes)?; save_growth(b); save_store_growth(&store); Ok(result)
}
#[ic_cdk::update]
fn reserve_group_media_growth(group_id: String, target_alias: String, club: String, bytes: u64) -> Outcome<u64> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    reserve_growth_for(caller(), &group_id, &target_alias, &club, bytes)
}

/// Self-service placements one principal may make; each consumes a group slot.
const MAX_SELF_PLACEMENTS: u64 = 10;

fn is_uuid(id: &str) -> bool {
    id.len() == 36 && id.char_indices().all(|(i, c)| if [8, 13, 18, 23].contains(&i) { c == '-' } else { c.is_ascii_hexdigit() })
}

fn place_new_club_for(user: Principal, club_id: String, target_alias: String, now: u64) -> Outcome<GroupAssignment> {
    if user == Principal::anonymous() { return Err("Authentication required".into()); }
    registry_writable()?;
    if !is_uuid(&club_id) { return Err("Club id must be a fresh UUID".into()); }
    // Idempotent retry requires the original authenticated creator. Location
    // metadata or an old governor assignment cannot authorize club creation.
    if group_assignment_for(&club_id).is_some() {
        if placement_owner(&club_id) != Some(user) { return Err("New club placement belongs to another creator or predates creator binding".into()); }
        return assign_group_record(club_id, target_alias, current_revision(), now);
    }
    let key = user.as_slice().to_vec();
    let used = PLACERS.with(|m| m.borrow().get(&key).unwrap_or(0));
    if used >= MAX_SELF_PLACEMENTS { return Err("New club placement limit reached".into()); }
    let assignment = if let Some(receipt) = owner_opening(&target_alias).filter(|r| r.approval.owner == user) {
        if media_growth_local() { return Err("Owner opening cannot bypass rehearsal growth accounting".into()); }
        if !receipt.accepting_new || !receipt.approval.club_ids.contains(&club_id) { return Err("Owner test placement stopped or UUID not approved".into()); }
        let mut group = group_for(&receipt.approval.group.id).ok_or("Missing owner group")?;
        if !owner_opening::same_inventory(&group, &receipt.approval.group) { return Err("Owner opening inventory changed".into()); }
        group.accepting = true;
        if !groups::has_headroom(&group, &target_alias, now) || !groups::below_rollover(&group) { return Err("Owner group lacks fresh healthy capacity".into()); }
        // The owner path is separate from the general fill-first selector.
        // Preserve every existing migration and deletion guard.
        if route_for(&club_id).is_some() || migration_for(&club_id).is_some() ||
            DOMAIN_ROUTES.with(|m| m.borrow().range(domain_key(&club_id, "")..).next().is_some_and(|e| e.key().starts_with(&domain_key(&club_id, "")))) {
            return Err("Existing club routes require a verified migration".into());
        }
        let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
        group.accepting = false; group.assigned_clubs += 1;
        let assignment = GroupAssignment { club_id: club_id.clone(), group_id: group.id.clone(), revision };
        save_group(&group);
        GROUP_ASSIGNMENTS.with(|m| m.borrow_mut().insert(club_id.as_bytes().to_vec(), encode(&assignment)));
        REVISION.with(|m| m.borrow_mut().set(revision));
        assignment
    } else { assign_group_record(club_id, target_alias, current_revision(), now)? };
    PLACEMENT_OWNERS.with(|m| m.borrow_mut().insert(assignment.club_id.as_bytes().to_vec(), user.as_slice().to_vec()));
    PLACERS.with(|m| m.borrow_mut().insert(key, used + 1));
    Ok(assignment)
}

fn placement_owner(club_id: &str) -> Option<Principal> {
    PLACEMENT_OWNERS.with(|m| m.borrow().get(&club_id.as_bytes().to_vec()).map(|bytes| Principal::from_slice(&bytes)))
}

fn creator_placement(user: Principal, club_id: &str, target_alias: &str, expected_revision: u64) -> Outcome<GroupAssignment> {
    if user == Principal::anonymous() { return Err("Authentication required".into()); }
    registry_writable()?;
    if placement_owner(club_id) != Some(user) { return Err("Original club creator required".into()); }
    hosted_assignment(club_id, target_alias, expected_revision, current_revision())
}

/// Consensus creator receipt only; never grants club membership or data access.
#[ic_cdk::update]
fn read_my_new_club_placement(club_id: String, target_alias: String, expected_revision: u64) -> Outcome<GroupAssignment> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    creator_placement(caller(), &club_id, &target_alias, expected_revision)
}

/// Only the registered destination club authority can check a creator receipt.
/// This does not authorize private reads or grant cross-club membership.
#[ic_cdk::update]
async fn read_new_club_creation_authorized(user: Principal, club_id: String, target_alias: String, group_id: String) -> Outcome<bool> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    registry_writable()?;
    let revision = current_revision();
    let requestor = caller();
    let initial = group_for(&group_id).ok_or("Unknown group")?;
    if initial.target_alias != target_alias || !initial.domains.iter().any(|d| d.domain == "club_domain" && d.canister == requestor) {
        return Err("Registered destination club authority required".into());
    }
    if owner_opening(&target_alias).is_some_and(|r| r.approval.group.id == group_id) {
        let receipt = owner_opening(&target_alias).ok_or("Owner opening missing")?;
        if receipt.approval.owner != user || !receipt.approval.club_ids.contains(&club_id) { return Ok(false); }
        if !owner_creation_eligible(user).await? { return Ok(false); }
        registry_writable()?;
        if current_revision() != revision || owner_opening(&target_alias).as_ref() != Some(&receipt) { return Err("Owner opening changed during eligibility check".into()); }
    }
    let group = group_for(&group_id).ok_or("Unknown group")?;
    if group.target_alias != target_alias || !group.domains.iter().any(|d| d.domain == "club_domain" && d.canister == requestor) {
        return Err("Registered destination club authority required".into());
    }
    if !GROUP_PLACEMENTS.with(|m| m.borrow().contains_key(&group_id.as_bytes().to_vec())) { return Err("Complete group placement required".into()); }
    Ok(user != Principal::anonymous() && placement_owner(&club_id) == Some(user) &&
        group_assignment_for(&club_id).is_some_and(|a| a.group_id == group_id))
}

fn memory(id: u8) -> Memory {
    MANAGER.with(|manager| manager.borrow().get(MemoryId::new(id)))
}

fn encode<T: Serialize>(value: &T) -> Vec<u8> {
    let mut bytes = Vec::new();
    ciborium::into_writer(value, &mut bytes).expect("stable encode");
    bytes
}

fn decode<T: for<'a> Deserialize<'a>>(bytes: &[u8]) -> T {
    ciborium::from_reader(bytes).expect("stable schema decode")
}

fn caller() -> Principal {
    ic_cdk::api::msg_caller()
}

fn governor() -> Option<Principal> {
    GOVERNOR.with(|cell| {
        let bytes = cell.borrow().get().clone();
        if bytes.is_empty() {
            None
        } else {
            Some(Principal::from_slice(&bytes))
        }
    })
}

fn require_governor() -> Outcome<()> {
    if governor() == Some(caller()) {
        Ok(())
    } else {
        Err("Forbidden".into())
    }
}
#[ic_cdk::update]
fn read_group_opening_configuration() -> Outcome<Vec<(String, String)>> {
    require_governor()?;
    Ok(vec![("deletion_authority".into(), deletion_authority().map(|p| p.to_text()).unwrap_or_default())])
}

fn validate_club_id(club_id: &str) -> Outcome<()> {
    if club_id.trim().is_empty() || club_id.len() > MAX_CLUB_ID_BYTES || club_id.contains(':') {
        return Err("Invalid club ID".into());
    }
    Ok(())
}

fn validate_shard(shard: Principal) -> Outcome<()> {
    if shard == Principal::anonymous() || shard == Principal::management_canister() {
        return Err("Invalid shard principal".into());
    }
    Ok(())
}

fn route_for(club_id: &str) -> Option<Route> {
    let key = club_id.as_bytes().to_vec();
    ROUTES.with(|routes| routes.borrow().get(&key).map(|bytes| decode(&bytes)))
}

fn migration_for(club_id: &str) -> Option<Migration> {
    let key = club_id.as_bytes().to_vec();
    MIGRATIONS.with(|migrations| migrations.borrow().get(&key).map(|bytes| decode(&bytes)))
}

fn domain_key(club_id: &str, domain: &str) -> Vec<u8> {
    format!("{club_id}:{domain}").into_bytes()
}

fn domain_route_for(club_id: &str, domain: &str) -> Option<DomainRoute> {
    let key = domain_key(club_id, domain);
    if let Some(bytes) = DOMAIN_ROUTES.with(|routes| routes.borrow().get(&key)) {
        return Some(decode(&bytes));
    }
    route_for(club_id).map(|club_route| DomainRoute {
        club_id: club_route.club_id,
        domain: domain.to_string(),
        shard: club_route.shard,
        revision: club_route.revision,
    })
}

fn domain_migration_for(club_id: &str, domain: &str) -> Option<DomainMigration> {
    let key = domain_key(club_id, domain);
    DOMAIN_MIGRATIONS.with(|migrations| migrations.borrow().get(&key).map(|bytes| decode(&bytes)))
}

fn configuration_revision() -> u64 {
    CONFIG_REVISION.with(|r| *r.borrow().get())
}
fn bump_configuration_revision() {
    let next = configuration_revision().checked_add(1).expect("Configuration revision exhausted");
    CONFIG_REVISION.with(|r| r.borrow_mut().set(next));
}

fn current_revision() -> u64 {
    REVISION.with(|revision| *revision.borrow().get())
}

#[ic_cdk::init]
fn init(init: Init) {
    assert!(init.governor != Principal::anonymous(), "invalid governor");
    GOVERNOR.with(|cell| cell.borrow_mut().set(init.governor.as_slice().to_vec()));
    REVISION.with(|revision| revision.borrow_mut().set(0));
    CONFIG_REVISION.with(|revision| revision.borrow_mut().set(0));
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    assert!(governor().is_some(), "missing governor state");
}

#[ic_cdk::query]
fn get_route(club_id: String) -> Outcome<Option<Route>> {
    validate_club_id(&club_id)?;
    Ok(route_for(&club_id))
}

#[ic_cdk::query]
fn get_domain_route(club_id: String, domain: String) -> Outcome<Option<DomainRoute>> {
    validate_club_id(&club_id)?;
    validate_club_id(&domain)?;
    Ok(domain_route_for(&club_id, &domain))
}

#[ic_cdk::query]
fn list_routes(start_after: Option<String>, limit: u16) -> Outcome<Page> {
    if limit == 0 || limit > MAX_PAGE {
        return Err("Invalid page size".into());
    }
    if let Some(start) = &start_after {
        validate_club_id(start)?;
    }
    let start = start_after.unwrap_or_default();
    let mut routes = Vec::new();
    ROUTES.with(|stored| {
        for entry in stored.borrow().iter() {
            let club_id = String::from_utf8(entry.key().to_vec()).expect("stable key");
            if !start.is_empty() && club_id <= start {
                continue;
            }
            routes.push(decode::<Route>(&entry.value()));
            if routes.len() >= limit as usize {
                break;
            }
        }
    });
    let next = routes.last().map(|route| route.club_id.clone());
    Ok(Page {
        revision: current_revision(),
        routes,
        next,
    })
}

#[ic_cdk::update]
fn assign(request: AssignRequest) -> Outcome<AssignResult> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&request.club_id)?;
    if group_assignment_for(&request.club_id).is_some() { return Err("Club has an immutable group assignment".into()); }
    validate_shard(request.shard)?;
    if migration_for(&request.club_id).is_some() {
        return Err("Club migration in progress".into());
    }
    let previous = route_for(&request.club_id);
    groups::immutable_route(previous.as_ref().map(|r| r.shard), request.shard)?;
    let revision = current_revision();
    if request.expected_revision != revision {
        return Err(format!("Conflict: expected revision {revision}"));
    }
    let next_revision = revision.checked_add(1).ok_or("Revision exhausted")?;
    let route = Route {
        club_id: request.club_id.clone(),
        shard: request.shard,
        revision: next_revision,
    };
    ROUTES.with(|routes| {
        routes
            .borrow_mut()
            .insert(request.club_id.into_bytes(), encode(&route))
    });
    REVISION.with(|stored| stored.borrow_mut().set(next_revision));
    let _ = previous;
    Ok(AssignResult {
        route,
        revision: next_revision,
    })
}

#[ic_cdk::update]
fn begin_migration(
    club_id: String,
    destination: Principal,
    expected_route_revision: u64,
) -> Outcome<Migration> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&club_id)?;
    if group_assignment_for(&club_id).is_some() { return Err("Group migration requires verified group-wide copy and cutover".into()); }
    validate_shard(destination)?;
    if migration_for(&club_id).is_some() {
        return Err("Club migration already in progress".into());
    }
    let source = route_for(&club_id).ok_or("Club has no shard route")?;
    if source.revision != expected_route_revision {
        return Err("Route revision conflict".into());
    }
    if source.shard == destination {
        return Err("Destination equals source".into());
    }
    let migration_revision = current_revision()
        .checked_add(1)
        .ok_or("Revision exhausted")?;
    let migration = Migration {
        club_id: club_id.clone(),
        source: source.shard,
        destination,
        route_revision: source.revision,
        migration_revision,
    };
    MIGRATIONS.with(|stored| {
        stored
            .borrow_mut()
            .insert(club_id.into_bytes(), encode(&migration))
    });
    REVISION.with(|stored| stored.borrow_mut().set(migration_revision));
    Ok(migration)
}

#[ic_cdk::update]
fn commit_migration(club_id: String, expected_migration_revision: u64) -> Outcome<AssignResult> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&club_id)?;
    let migration = migration_for(&club_id).ok_or("No migration in progress")?;
    if migration.migration_revision != expected_migration_revision {
        return Err("Migration revision conflict".into());
    }
    let next_revision = current_revision()
        .checked_add(1)
        .ok_or("Revision exhausted")?;
    let route = Route {
        club_id: club_id.clone(),
        shard: migration.destination,
        revision: next_revision,
    };
    ROUTES.with(|routes| {
        routes
            .borrow_mut()
            .insert(club_id.as_bytes().to_vec(), encode(&route))
    });
    MIGRATIONS.with(|stored| stored.borrow_mut().remove(&club_id.as_bytes().to_vec()));
    REVISION.with(|stored| stored.borrow_mut().set(next_revision));
    Ok(AssignResult {
        route,
        revision: next_revision,
    })
}

#[ic_cdk::update]
fn abort_migration(club_id: String, expected_migration_revision: u64) -> Outcome<u64> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&club_id)?;
    let migration = migration_for(&club_id).ok_or("No migration in progress")?;
    if migration.migration_revision != expected_migration_revision {
        return Err("Migration revision conflict".into());
    }
    MIGRATIONS.with(|stored| stored.borrow_mut().remove(&club_id.as_bytes().to_vec()));
    let next_revision = current_revision()
        .checked_add(1)
        .ok_or("Revision exhausted")?;
    REVISION.with(|stored| stored.borrow_mut().set(next_revision));
    Ok(next_revision)
}

#[ic_cdk::query]
fn get_migration(club_id: String) -> Outcome<Option<Migration>> {
    validate_club_id(&club_id)?;
    Ok(migration_for(&club_id))
}

#[ic_cdk::update]
fn assign_domain(request: AssignDomainRequest) -> Outcome<AssignDomainResult> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&request.club_id)?;
    if group_assignment_for(&request.club_id).is_some() { return Err("Club has an immutable group assignment".into()); }
    validate_club_id(&request.domain)?;
    validate_shard(request.shard)?;
    groups::immutable_route(domain_route_for(&request.club_id, &request.domain).map(|r| r.shard), request.shard)?;
    if domain_migration_for(&request.club_id, &request.domain).is_some()
        || migration_for(&request.club_id).is_some()
    {
        return Err("Domain migration in progress".into());
    }
    let revision = current_revision();
    if request.expected_revision != revision {
        return Err(format!("Conflict: expected revision {revision}"));
    }
    let next_revision = revision.checked_add(1).ok_or("Revision exhausted")?;
    let route = DomainRoute {
        club_id: request.club_id.clone(),
        domain: request.domain.clone(),
        shard: request.shard,
        revision: next_revision,
    };
    let key = domain_key(&request.club_id, &request.domain);
    DOMAIN_ROUTES.with(|routes| routes.borrow_mut().insert(key, encode(&route)));
    REVISION.with(|stored| stored.borrow_mut().set(next_revision));
    Ok(AssignDomainResult {
        route,
        revision: next_revision,
    })
}

#[ic_cdk::update]
fn begin_domain_migration(
    club_id: String,
    domain: String,
    destination: Principal,
    expected_route_revision: u64,
) -> Outcome<DomainMigration> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&club_id)?;
    if group_assignment_for(&club_id).is_some() { return Err("Group migration requires verified group-wide copy and cutover".into()); }
    validate_club_id(&domain)?;
    validate_shard(destination)?;
    if domain_migration_for(&club_id, &domain).is_some() || migration_for(&club_id).is_some() {
        return Err("Domain migration already in progress".into());
    }
    let source = domain_route_for(&club_id, &domain).ok_or("Club domain has no shard route")?;
    if source.revision != expected_route_revision {
        return Err("Domain route revision conflict".into());
    }
    if source.shard == destination {
        return Err("Destination equals source".into());
    }
    let migration_revision = current_revision()
        .checked_add(1)
        .ok_or("Revision exhausted")?;
    let migration = DomainMigration {
        club_id: club_id.clone(),
        domain: domain.clone(),
        source: source.shard,
        destination,
        route_revision: source.revision,
        migration_revision,
    };
    let key = domain_key(&club_id, &domain);
    DOMAIN_MIGRATIONS.with(|stored| stored.borrow_mut().insert(key, encode(&migration)));
    REVISION.with(|stored| stored.borrow_mut().set(migration_revision));
    Ok(migration)
}

#[ic_cdk::update]
fn commit_domain_migration(
    club_id: String,
    domain: String,
    expected_migration_revision: u64,
) -> Outcome<AssignDomainResult> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&club_id)?;
    validate_club_id(&domain)?;
    let migration =
        domain_migration_for(&club_id, &domain).ok_or("No domain migration in progress")?;
    if migration.migration_revision != expected_migration_revision {
        return Err("Migration revision conflict".into());
    }
    let next_revision = current_revision()
        .checked_add(1)
        .ok_or("Revision exhausted")?;
    let route = DomainRoute {
        club_id: club_id.clone(),
        domain: domain.clone(),
        shard: migration.destination,
        revision: next_revision,
    };
    let key = domain_key(&club_id, &domain);
    DOMAIN_ROUTES.with(|routes| routes.borrow_mut().insert(key.clone(), encode(&route)));
    DOMAIN_MIGRATIONS.with(|stored| stored.borrow_mut().remove(&key));
    REVISION.with(|stored| stored.borrow_mut().set(next_revision));
    Ok(AssignDomainResult {
        route,
        revision: next_revision,
    })
}

#[ic_cdk::update]
fn abort_domain_migration(
    club_id: String,
    domain: String,
    expected_migration_revision: u64,
) -> Outcome<u64> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    validate_club_id(&club_id)?;
    validate_club_id(&domain)?;
    let migration =
        domain_migration_for(&club_id, &domain).ok_or("No domain migration in progress")?;
    if migration.migration_revision != expected_migration_revision {
        return Err("Migration revision conflict".into());
    }
    let key = domain_key(&club_id, &domain);
    DOMAIN_MIGRATIONS.with(|stored| stored.borrow_mut().remove(&key));
    let next_revision = current_revision()
        .checked_add(1)
        .ok_or("Revision exhausted")?;
    REVISION.with(|stored| stored.borrow_mut().set(next_revision));
    Ok(next_revision)
}

#[ic_cdk::query]
fn get_domain_migration(club_id: String, domain: String) -> Outcome<Option<DomainMigration>> {
    validate_club_id(&club_id)?;
    validate_club_id(&domain)?;
    Ok(domain_migration_for(&club_id, &domain))
}

#[ic_cdk::query]
fn version() -> u64 {
    current_revision()
}

// Control-plane preparation only: these assignments do not activate live
// frontend routing. Activation requires tested discovery/ACL/migration wiring.
pub(crate) fn group_for(id: &str) -> Option<ShardGroup> {
    GROUPS.with(|items| items.borrow().get(&id.as_bytes().to_vec()).map(|bytes| decode(&bytes)))
}
pub(crate) fn save_group(group: &ShardGroup) {
    GROUPS.with(|items| items.borrow_mut().insert(group.id.as_bytes().to_vec(), encode(group)));
    GROUP_INDEX.with(|index| { if let Some(index) = index.borrow_mut().as_mut() { index.upsert(group); } });
}
fn indexed_group(target: &str, club: &str, now: u64) -> Option<ShardGroup> {
    GROUP_INDEX.with(|index| {
        let mut index = index.borrow_mut();
        if index.is_none() {
            let mut rebuilt = group_index::GroupIndex::default();
            GROUPS.with(|rows| { for row in rows.borrow().iter() { rebuilt.upsert(&decode::<ShardGroup>(&row.value())); } });
            *index = Some(rebuilt);
        }
        index.as_ref()?.pick(target, |id| {
            let group = group_for(id)?;
            if !groups::has_headroom(&group, target, now) || !groups::below_rollover(&group) { return None; }
            if media_growth_local() && !verified_store_growth(id).is_some_and(|s| s.budget.fits(club, s.budget.free_club)) { return None; }
            Some(group)
        })
    })
}
fn group_assignment_for(id: &str) -> Option<GroupAssignment> {
    GROUP_ASSIGNMENTS.with(|items| items.borrow().get(&id.as_bytes().to_vec()).map(|bytes| decode(&bytes)))
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
pub struct GroupRegistrySnapshot { pub revision: u64, pub groups: Vec<ShardGroup>, pub placements: Vec<GroupPlacement> }

#[ic_cdk::update]
fn register_group_placement(placement: GroupPlacement, expected_revision: u64) -> Outcome<u64> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let group = group_for(&placement.group_id).ok_or("Unknown group")?;
    discovery::validate(&placement, &group)?;
    let key = placement.group_id.as_bytes().to_vec();
    if let Some(bytes) = GROUP_PLACEMENTS.with(|m| m.borrow().get(&key)) {
        let prior: GroupPlacement = decode(&bytes);
        if prior != placement { return Err("Placement is immutable; register a new group for changes".into()); }
        return Ok(current_revision());
    }
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    GROUP_PLACEMENTS.with(|m| m.borrow_mut().insert(key, encode(&placement)));
    REVISION.with(|m| m.borrow_mut().set(revision));
    bump_configuration_revision();
    Ok(revision)
}

// Consensus-authenticated infrastructure metadata only: no assignment list,
// account IDs, memberships or health receipts. This does not activate routing.
#[ic_cdk::update]
fn read_group_registry(target_alias: String) -> Outcome<GroupRegistrySnapshot> {
    let page = read_group_registry_page(target_alias, None, None, 64)?;
    if page.next_cursor.is_some() { return Err("Registry exceeds legacy reply; use read_group_registry_page".into()); }
    Ok(GroupRegistrySnapshot { revision: page.revision, groups: page.groups, placements: page.placements })
}

fn registered_group_ids(target_alias: &str) -> Vec<String> {
    GROUPS.with(|m| m.borrow().iter().map(|e| decode::<ShardGroup>(&e.value())).filter(|g| g.target_alias == target_alias).map(|g| g.id).collect())
}
fn record_routing_approval_for(operator: Principal, approval: RoutingApproval, expected_configuration_revision: u64) -> Outcome<RoutingApproval> {
    if governor() != Some(operator) || operator == Principal::anonymous() { return Err("Forbidden".into()); }
    registry_writable()?;
    if expected_configuration_revision != configuration_revision() { return Err("Configuration revision conflict".into()); }
    let registered = registered_group_ids(&approval.target_alias);
    for id in &registered {
        if !GROUP_PLACEMENTS.with(|m| m.borrow().contains_key(&id.as_bytes().to_vec())) { return Err("Complete group placement required".into()); }
    }
    routing_approval::validate(&approval, configuration_revision(), &registered)?;
    // Recording is not a configuration change: neither revision moves, so the
    // approval stays valid until the next real configuration mutation.
    ROUTING_APPROVALS.with(|m| m.borrow_mut().insert(approval.target_alias.clone(), encode(&approval)));
    Ok(approval)
}
/// Governor-only. Binds the exact configuration revision and approved digest;
/// any later group/placement/policy change makes clients fail closed again.
#[ic_cdk::update]
fn record_routing_approval(approval: RoutingApproval, expected_configuration_revision: u64) -> Outcome<RoutingApproval> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    record_routing_approval_for(caller(), approval, expected_configuration_revision)
}
/// Consensus read for signed-in clients; infrastructure metadata only.
#[ic_cdk::update]
fn read_routing_approval(target_alias: String) -> Outcome<Option<RoutingApproval>> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    if caller() == Principal::anonymous() { return Err("Authentication required".into()); }
    if target_alias.is_empty() || target_alias.len() > 64 { return Err("Invalid target alias".into()); }
    Ok(ROUTING_APPROVALS.with(|m| m.borrow().get(&target_alias).map(|b| decode(&b))))
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
pub struct GroupRegistryPage {
    pub revision: u64, pub groups: Vec<ShardGroup>, pub placements: Vec<GroupPlacement>,
    pub next_cursor: Option<String>,
    pub configuration_revision: Option<u64>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
pub struct PublicGroupTarget { pub id: String, pub domains: Vec<groups::DomainCanister> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
pub struct PublicGroupPage { pub configuration_revision: u64, pub groups: Vec<PublicGroupTarget>, pub next_cursor: Option<String> }
/// Anonymous infrastructure discovery only: never memberships, placements,
/// controller details or a grant to read/write any destination resource.
#[ic_cdk::update]
fn read_public_group_targets(target_alias: String, expected_revision: Option<u64>, cursor: Option<String>, limit: u32) -> Outcome<PublicGroupPage> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    if target_alias.is_empty() || target_alias.len()>64 || limit==0 || limit>64 || cursor.as_ref().is_some_and(|c| c.len()>64) { return Err("Invalid public registry page".into()); }
    let revision=configuration_revision();
    if expected_revision.is_some_and(|r|r!=revision) || (cursor.is_some() && expected_revision.is_none()) { return Err("Public registry revision conflict".into()); }
    let approval=ROUTING_APPROVALS.with(|m|m.borrow().get(&target_alias).map(|b|decode::<RoutingApproval>(&b))).ok_or("Public group configuration awaits approval")?;
    routing_approval::validate(&approval,revision,&registered_group_ids(&target_alias))?;
    use std::ops::Bound::{Excluded,Unbounded};
    let start=cursor.map(|c|Excluded(c.into_bytes())).unwrap_or(Unbounded);
    let rows=GROUPS.with(|m|m.borrow().range((start,Unbounded)).take(limit as usize+1).map(|e|(e.key().clone(),decode::<ShardGroup>(&e.value()))).collect::<Vec<_>>());
    let next_cursor=if rows.len()>limit as usize {Some(String::from_utf8(rows[limit as usize-1].0.clone()).map_err(|_|"Invalid group key")?)}else{None};
    let groups=rows.into_iter().take(limit as usize).filter(|(_,g)|g.target_alias==target_alias).map(|(_,g)|PublicGroupTarget{id:g.id,domains:g.domains}).collect();
    Ok(PublicGroupPage{configuration_revision:revision,groups,next_cursor})
}

// Cursor advances over at most 64 stable keys, including foreign targets: no
// message scans an unbounded registry. Empty nonterminal pages are valid.
#[ic_cdk::update]
fn read_group_registry_page(target_alias: String, expected_revision: Option<u64>, cursor: Option<String>, limit: u32) -> Outcome<GroupRegistryPage> {
    if caller() == Principal::anonymous() { return Err("Authentication required".into()); }
    if target_alias.is_empty() || target_alias.len() > 64 || limit == 0 || limit > 64 || cursor.as_ref().is_some_and(|c| c.len()>64) {
        return Err("Invalid registry page".into());
    }
    let revision = current_revision();
    if expected_revision.is_some_and(|r| r != revision) { return Err("Revision conflict".into()); }
    if cursor.is_some() && expected_revision.is_none() { return Err("Paged continuation requires revision".into()); }
    use std::ops::Bound::{Excluded, Unbounded};
    let rows = GROUPS.with(|m| {
        let m = m.borrow();
        let start = cursor.map(|c| Excluded(c.into_bytes())).unwrap_or(Unbounded);
        m.range((start, Unbounded)).take(limit as usize + 1).map(|e| (e.key().clone(), e.value())).collect::<Vec<_>>()
    });
    let next_cursor = if rows.len() > limit as usize {
        Some(String::from_utf8(rows[limit as usize - 1].0.clone()).map_err(|_| "Invalid group key")?)
    } else { None };
    let groups: Vec<ShardGroup> = rows.into_iter().take(limit as usize).map(|(_,v)| decode::<ShardGroup>(&v)).filter(|g| g.target_alias == target_alias).collect();
    let placements = groups.iter().map(|g| GROUP_PLACEMENTS.with(|m| m.borrow().get(&g.id.as_bytes().to_vec()).map(|b| decode(&b))).ok_or_else(|| "Incomplete group placement registry".to_string())).collect::<Outcome<Vec<_>>>()?;
    Ok(GroupRegistryPage { revision, groups, placements, next_cursor, configuration_revision: Some(configuration_revision()) })
}

#[ic_cdk::update]
async fn read_my_group_assignments(club_ids: Vec<String>, target_alias: String, expected_revision: u64) -> Outcome<Vec<GroupAssignment>> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let user = caller();
    if user == Principal::anonymous() { return Err("Authentication required".into()); }
    discovery::validate_clubs(&club_ids)?;
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let mut checked = Vec::new();
    // Resolve all destinations before any call; do not return partial results.
    for club in &club_ids {
        let assignment = group_assignment_for(club).ok_or("Missing club assignment")?;
        let group = group_for(&assignment.group_id).ok_or("Missing assigned group")?;
        if group.target_alias != target_alias { return Err("Assignment belongs to another deployment".into()); }
        let source = group.domains.iter().find(|d| d.domain == "club_domain").ok_or("Missing membership authority")?.canister;
        checked.push((assignment, source));
    }
    for (assignment, source) in &checked {
        let reply = ic_cdk::call::Call::bounded_wait(*source, "read_has_club_membership")
            .with_args(&(user, assignment.club_id.clone())).await.map_err(|_| "Membership authority unavailable")?;
        let member: bool = reply.candid().map_err(|_| "Invalid membership authority reply")?;
        if !member { return Err("Club membership required".into()); }
        if current_revision() != expected_revision { return Err("Registry changed during membership checks".into()); }
    }
    Ok(checked.into_iter().map(|(a, _)| a).collect())
}

// Where a club lives, for reading something that club hosts (for example a
// competition other clubs have entered). Any signed-in caller may ask; only
// the group id is returned and every destination canister keeps its own
// access rules, so this never grants access to the club's data.
#[ic_cdk::update]
fn read_hosted_club_assignment(club_id: String, target_alias: String, expected_revision: u64) -> Outcome<GroupAssignment> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    if caller() == Principal::anonymous() { return Err("Authentication required".into()); }
    hosted_assignment(&club_id, &target_alias, expected_revision, current_revision())
}

fn hosted_assignment(club_id: &str, target_alias: &str, expected_revision: u64, revision: u64) -> Outcome<GroupAssignment> {
    discovery::validate_clubs(&[club_id.to_string()])?;
    if target_alias.is_empty() || target_alias.len() > 64 { return Err("Invalid target alias".into()); }
    if revision != expected_revision { return Err("Revision conflict".into()); }
    let assignment = group_assignment_for(club_id).ok_or("Missing club assignment")?;
    let group = group_for(&assignment.group_id).ok_or("Missing assigned group")?;
    if group.target_alias != target_alias { return Err("Assignment belongs to another deployment".into()); }
    Ok(assignment)
}

#[ic_cdk::update]
fn register_group(group: ShardGroup, expected_revision: u64) -> Outcome<u64> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    let mut group = group;
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let prior = group_for(&group.id);
    if let Some(ref old) = prior {
        if let Some(opening) = owner_opening(&old.target_alias).filter(|r| r.approval.group.id == old.id) {
            if !owner_opening::same_inventory(&group, &opening.approval.group) { return Err("Owner test group inventory and general closed state are immutable".into()); }
        }
        if old.target_alias != group.target_alias || old.domains != group.domains || (growth_budget(&group.id).is_some() && old.photo_store != group.photo_store) {
            return Err("Group endpoints are immutable; register a new group".into());
        }
        group.assigned_clubs = old.assigned_clubs;
        group.heap_bytes = old.heap_bytes;
        group.cycles = old.cycles;
        group.observed_at_ns = old.observed_at_ns;
    } else {
        if GROUPS.with(|items| items.borrow().len()) >= groups::MAX_GROUPS as u64 {
            return Err("Group registry full".into());
        }
        group.assigned_clubs = 0;
        // Health is written through the separate governor-only reporting API.
        group.heap_bytes = 0; group.cycles = 0; group.observed_at_ns = 0;
    }
    groups::validate(&group)?;
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    save_group(&group);
    REVISION.with(|stored| stored.borrow_mut().set(revision));
    bump_configuration_revision();
    Ok(revision)
}

#[ic_cdk::update]
fn record_group_health(group_id: String, heap_bytes: u64, cycles: u64, expected_revision: u64) -> Outcome<u64> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let mut group = group_for(&group_id).ok_or("Unknown group")?;
    // Report the largest heap and smallest cycle balance across ALL group
    // canisters. This is an operator observation, never browser authorization.
    // Health is an observation, not inventory: it must not bump the registry
    // revision, or scheduled reporting would invalidate revision-bound
    // approvals such as the routing snapshot.
    group.heap_bytes = heap_bytes; group.cycles = cycles; group.observed_at_ns = ic_cdk::api::time();
    save_group(&group);
    Ok(current_revision())
}

#[ic_cdk::query]
fn list_groups() -> Outcome<Vec<ShardGroup>> {
    require_governor()?;
    Ok(GROUPS.with(|items| items.borrow().iter().map(|entry| decode(&entry.value())).collect()))
}

#[ic_cdk::query]
fn get_group_assignment(club_id: String) -> Outcome<Option<GroupAssignment>> {
    require_governor()?;
    validate_club_id(&club_id)?;
    Ok(group_assignment_for(&club_id))
}

#[ic_cdk::update]
fn assign_new_club_group(club_id: String, target_alias: String, expected_revision: u64) -> Outcome<GroupAssignment> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor()?; registry_writable()?;
    assign_group_record(club_id, target_alias, expected_revision, ic_cdk::api::time())
}

/// Any signed-in user creating a club asks for its group here; the router picks
/// the healthiest accepting group. Capped per principal; retries are free.
#[ic_cdk::update]
async fn place_my_new_club(club_id: String, target_alias: String) -> Outcome<GroupAssignment> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let user = caller();
    if let Some(receipt) = owner_opening(&target_alias).filter(|r| r.approval.owner == user) {
        registry_writable()?;
        let revision = current_revision();
        if !owner_creation_eligible(user).await? { return Err("Owner account cannot create a test club".into()); }
        registry_writable()?;
        if current_revision() != revision || owner_opening(&target_alias).as_ref() != Some(&receipt) { return Err("Owner opening changed during eligibility check".into()); }
    }
    // The router refreshes stale group health itself, so club creation never
    // depends on an external reporting job staying alive.
    if user != Principal::anonymous() && group_assignment_for(&club_id).is_none() {
        self_health::refresh_stale(&target_alias).await;
    }
    place_new_club_for(user, club_id, target_alias, ic_cdk::api::time())
}
async fn owner_creation_eligible(user: Principal) -> Outcome<bool> {
    let identity = deletion_authority().ok_or("Owner opening requires bound deletion authority")?;
    let reply = ic_cdk::call::Call::bounded_wait(identity, "read_owner_test_creation_eligible").with_arg(&user)
        .await.map_err(|_| "Owner identity verification unavailable")?;
    let result: Outcome<bool> = reply.candid().map_err(|_| "Invalid owner identity reply")?;
    result
}

fn assign_group_record(club_id: String, target_alias: String, expected_revision: u64, now: u64) -> Outcome<GroupAssignment> {
    registry_writable()?;
    validate_club_id(&club_id)?;
    // Retrying an acknowledged assignment never consumes a second slot.
    if let Some(assignment) = group_assignment_for(&club_id) {
        let group = group_for(&assignment.group_id).ok_or("Missing assigned group")?;
        if group.target_alias != target_alias { return Err("Existing assignment belongs to another target".into()); }
        return Ok(assignment);
    }
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    if route_for(&club_id).is_some() || migration_for(&club_id).is_some() ||
        DOMAIN_ROUTES.with(|items| items.borrow().range(domain_key(&club_id, "")..).next()
            .is_some_and(|entry| entry.key().starts_with(&domain_key(&club_id, "")))) {
        return Err("Existing club routes require a verified migration".into());
    }
    let mut group = indexed_group(&target_alias, &club_id, now).ok_or("No healthy group with capacity")?;
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    group.assigned_clubs += 1;
    let assignment = GroupAssignment { club_id: club_id.clone(), group_id: group.id.clone(), revision };
    // Reserve physical growth and assign in the same message. A lost reply
    // retains one immutable assignment and one monotonic commitment.
    if media_growth_local() {
        let mut store = verified_store_growth(&group.id).ok_or("Verified per-store growth baseline required")?;
        store.budget.reserve(&club_id, store.budget.free_club)?;
        save_growth(&store.budget); save_store_growth(&store);
    }
    // Both maps update in one synchronous message; no await/reentrancy window.
    save_group(&group);
    GROUP_ASSIGNMENTS.with(|items| items.borrow_mut().insert(club_id.into_bytes(), encode(&assignment)));
    REVISION.with(|stored| stored.borrow_mut().set(revision));
    Ok(assignment)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn routing_approval_is_governor_only_revision_bound_and_does_not_move_revisions() {
        let operator = Principal::from_slice(&[240, 1]);
        init(Init { governor: operator });
        let mut g = groups::tests::group("approval-g", 0);
        g.target_alias = "approval-test".into();
        save_group(&g);
        let subnet = Principal::from_slice(&[241, 1]);
        let placement = GroupPlacement { group_id: g.id.clone(), deployment_id: "mainnet".into(), deployment_revision: 1,
            host: "https://icp-api.io".into(), network_kind: "public_mainnet".into(), primary_subnet: subnet,
            approved_subnets: vec![subnet], additional_subnets_enabled: false,
            domains: g.domains.iter().map(|d| discovery::DomainPlacement { domain: d.domain.clone(), canister: d.canister, subnet }).collect() };
        GROUP_PLACEMENTS.with(|m| m.borrow_mut().insert(g.id.as_bytes().to_vec(), encode(&placement)));
        let rev = configuration_revision();
        let assignments = current_revision();
        let approval = RoutingApproval { target_alias: g.target_alias.clone(), configuration_revision: rev,
            approved_configuration_sha256: "c".repeat(64), removal_wiring_group_ids: vec![g.id.clone()],
            removal_checked_at_ms: 1, evidence_sha256: "d".repeat(64) };
        assert!(record_routing_approval_for(Principal::from_slice(&[242, 1]), approval.clone(), rev).is_err());
        assert!(record_routing_approval_for(operator, approval.clone(), rev + 1).is_err());
        assert_eq!(record_routing_approval_for(operator, approval.clone(), rev).unwrap(), approval);
        assert_eq!(configuration_revision(), rev);
        assert_eq!(current_revision(), assignments);
        let stored = ROUTING_APPROVALS.with(|m| m.borrow().get(&g.target_alias).map(|b| decode::<RoutingApproval>(&b)));
        assert_eq!(stored, Some(approval.clone()));
        // A later configuration change leaves the stale approval in place; clients compare revisions and fail closed.
        stop_group_placements_for(operator, g.id.clone(), g.target_alias.clone(), current_revision()).unwrap();
        assert_eq!(configuration_revision(), rev + 1);
        assert!(record_routing_approval_for(operator, approval, rev).is_err());
        post_upgrade();
        assert!(ROUTING_APPROVALS.with(|m| m.borrow().contains_key(&g.target_alias)));
    }
    #[test]
    fn consecutive_creator_reservations_preserve_configuration_and_upgrade() {
        let operator = Principal::from_slice(&[230, 1]);
        init(Init { governor: operator });
        let mut g = groups::tests::group("config-test", 0);
        g.target_alias = "configuration-test".into();
        save_group(&g);
        let approved = configuration_revision();
        let creator = Principal::from_slice(&[231, 1]);
        let id = "00000000-0000-4000-8000-000000000081".to_string();
        let first = place_new_club_for(creator, id.clone(), g.target_alias.clone(), 1).unwrap();
        let second = place_new_club_for(creator, "00000000-0000-4000-8000-000000000082".into(), g.target_alias.clone(), 1).unwrap();
        assert_eq!(first.revision, 1);
        assert_eq!(second.revision, 2);
        assert_eq!(configuration_revision(), approved);
        assert_eq!(place_new_club_for(creator, id.clone(), g.target_alias.clone(), 1).unwrap(), first);
        assert!(place_new_club_for(operator, id, g.target_alias.clone(), 1).is_err());
        assert_eq!(current_revision(), 2);
        let stopped = stop_group_placements_for(operator, g.id.clone(), g.target_alias.clone(), 2).unwrap();
        assert_eq!(configuration_revision(), approved + 1);
        assert_eq!(stop_group_placements_for(operator, g.id, g.target_alias, stopped).unwrap(), stopped);
        assert_eq!(configuration_revision(), approved + 1);
        post_upgrade();
        assert_eq!(current_revision(), stopped);
        assert_eq!(configuration_revision(), approved + 1);
    }
    #[test]
    fn priority_index_rebuild_rollover_health_and_immutable_retry() {
        let mut a = groups::tests::group("index-a", 79);
        let b = groups::tests::group("index-b", 0);
        save_group(&a); save_group(&b);
        let first = assign_group_record("index-club-a".into(), "mainnet".into(), current_revision(), 1).unwrap();
        assert_eq!(first.group_id, "index-a");
        assert_eq!(assign_group_record("index-club-b".into(), "mainnet".into(), current_revision(), 1).unwrap().group_id, "index-b");
        assert_eq!(assign_group_record("index-club-a".into(), "mainnet".into(), 0, u64::MAX).unwrap(), first);
        a.assigned_clubs = 10; a.observed_at_ns = 0; save_group(&a);
        assert_eq!(indexed_group("mainnet", "new", groups::MAX_READING_AGE_NS + 1).unwrap().id, "index-b");
        GROUP_INDEX.with(|m| *m.borrow_mut() = None);
        assert_eq!(indexed_group("mainnet", "new", 1).unwrap().id, "index-a");
        a.accepting = false; save_group(&a);
        assert_eq!(indexed_group("mainnet", "new", 1).unwrap().id, "index-b");
    }

    #[test]
    fn growth_is_group_bound_and_reserved_with_assignment() {
        TEST_GROWTH.with(|v| *v.borrow_mut() = true);
        let mut g = groups::tests::group("growth-g", 0);
        g.target_alias = "growth-local".into();
        g.photo_store = Some(Principal::from_slice(&[240]));
        GROUPS.with(|m| m.borrow_mut().insert(g.id.as_bytes().to_vec(), encode(&g)));
        let authority = g.domains[0].canister;
        save_growth(&media_growth::Budget { group_id:g.id.clone(),target_alias:g.target_alias.clone(),authority,usable:100,fixed:20,free_club:40,commitments:Default::default() });
        assert!(assign_group_record("growth-a".into(),g.target_alias.clone(),current_revision(),1).is_err());
        let store = g.photo_store.unwrap();
        save_store_growth(&media_growth::StoreBudget::import(store,1,&growth_budget(&g.id).unwrap(),100,20,vec![]).unwrap());
        let a = assign_group_record("growth-a".into(),g.target_alias.clone(),current_revision(),1).unwrap();
        assert_eq!(growth_budget(&g.id).unwrap().committed(),Ok(60));
        assert_eq!(assign_group_record("growth-a".into(),g.target_alias.clone(),0,1).unwrap(),a);
        assert!(reserve_growth_for(Principal::anonymous(),&g.id,&g.target_alias,"growth-a",50).is_err());
        assert!(reserve_growth_for(authority,&g.id,"foreign","growth-a",50).is_err());
        assert!(reserve_growth_for(authority,&g.id,&g.target_alias,"unassigned",50).is_err());
        assert_eq!(reserve_growth_for(authority,&g.id,&g.target_alias,"growth-a",80),Ok(80));
        assert!(assign_group_record("growth-b".into(),g.target_alias.clone(),current_revision(),1).is_err());
        assert!(group_assignment_for("growth-b").is_none());
        assert_eq!(growth_budget(&g.id).unwrap().committed(),Ok(100));
        let original = g.photo_store;
        g.photo_store = Some(Principal::from_slice(&[241]));
        GROUPS.with(|m| m.borrow_mut().insert(g.id.as_bytes().to_vec(),encode(&g)));
        assert!(reserve_growth_for(authority,&g.id,"growth-local","growth-a",80).is_err());
        assert!(verified_store_growth(&g.id).is_none());
        g.photo_store = original;
        GROUPS.with(|m| m.borrow_mut().insert(g.id.as_bytes().to_vec(),encode(&g)));
        assert_eq!(reserve_growth_for(authority,&g.id,"growth-local","growth-a",80),Ok(80));
        let mut duplicate = g.clone(); duplicate.id = "duplicate-store-group".into();
        GROUPS.with(|m| m.borrow_mut().insert(duplicate.id.as_bytes().to_vec(),encode(&duplicate)));
        assert!(verified_store_growth(&g.id).is_none());
        assert!(reserve_growth_for(authority,&g.id,"growth-local","growth-a",80).is_err());
        GROUPS.with(|m| m.borrow_mut().remove(&duplicate.id.as_bytes().to_vec()));
        assert!(verified_store_growth(&g.id).is_some());
        TEST_GROWTH.with(|v| *v.borrow_mut() = false);
    }
    #[test]
    fn reservation_blocks_registry_mutations_and_self_placement_until_settled() {
        let lock=DeletionLock {account_id:"account".into(),revision:4};
        DELETION_LOCKS.with(|m|m.borrow_mut().insert(lock.account_id.clone(),encode(&lock)));
        assert_eq!(registry_writable(),Err("Deletion registry locked".into()));
        assert!(assign_group_record("club".into(),"mainnet".into(),4,0).is_err());
        DELETION_LOCKS.with(|m|m.borrow_mut().remove(&lock.account_id));
        assert!(registry_writable().is_ok());
    }

    #[test]
    fn ids_and_pages_are_bounded() {
        assert!(validate_club_id("club-a").is_ok());
        assert!(validate_club_id("").is_err());
        assert!(validate_club_id(&"x".repeat(MAX_CLUB_ID_BYTES + 1)).is_err());
    }

    #[test]
    fn shard_principals_reject_system_callers() {
        assert!(validate_shard(Principal::anonymous()).is_err());
        assert!(validate_shard(Principal::management_canister()).is_err());
    }

    #[test]
    fn domain_key_formatting_is_deterministic() {
        assert_eq!(domain_key("club-1", "events"), b"club-1:events".to_vec());
        assert_eq!(
            domain_key("club-1", "messaging"),
            b"club-1:messaging".to_vec()
        );
    }

    #[test]
    fn assignment_retry_is_persistent_and_does_not_consume_capacity_twice() {
        let group = ShardGroup {
            id: "test-group".into(), target_alias: "mainnet".into(), domains: vec![],
            accepting: true, max_clubs: 1, assigned_clubs: 0,
            heap_budget_bytes: 1_000, heap_bytes: 1, min_cycles: 1, cycles: 2, observed_at_ns: 1, photo_store: None,
        };
        GROUPS.with(|items| items.borrow_mut().insert(group.id.as_bytes().to_vec(), encode(&group)));
        let revision = current_revision();
        let first = assign_group_record("club-one".into(), "mainnet".into(), revision, 1).unwrap();
        let retry = assign_group_record("club-one".into(), "mainnet".into(), revision, 1).unwrap();
        assert_eq!(first, retry);
        assert_eq!(group_for("test-group").unwrap().assigned_clubs, 1);
        assert_eq!(group_assignment_for("club-one"), Some(first));
        assert!(assign_group_record("club-two".into(), "mainnet".into(), current_revision(), 1).is_err());
        assert!(assign_group_record("club-one".into(), "other-engine".into(), current_revision(), 1).is_err());
    }

    #[test]
    fn self_service_placement_is_authenticated_capped_and_retry_free() {
        let group = ShardGroup {
            id: "self-group".into(), target_alias: "selftest".into(), domains: vec![],
            accepting: true, max_clubs: 100, assigned_clubs: 0,
            heap_budget_bytes: 1_000, heap_bytes: 1, min_cycles: 1, cycles: 2, observed_at_ns: 1, photo_store: None,
        };
        GROUPS.with(|items| items.borrow_mut().insert(group.id.as_bytes().to_vec(), encode(&group)));
        let user = Principal::from_slice(&[7; 29]);
        let id = |n: u64| format!("00000000-0000-4000-8000-{:012x}", n);
        assert!(place_new_club_for(Principal::anonymous(), id(0), "selftest".into(), 1).is_err());
        assert!(place_new_club_for(user, "not-a-uuid".into(), "selftest".into(), 1).is_err());
        let first = place_new_club_for(user, id(1), "selftest".into(), 1).unwrap();
        assert_eq!(creator_placement(user, &id(1), "selftest", current_revision()), Ok(first.clone()));
        assert!(place_new_club_for(Principal::from_slice(&[8; 29]), id(1), "selftest".into(), 1).is_err());
        assert!(creator_placement(Principal::anonymous(), &id(1), "selftest", current_revision()).is_err());
        assert!(creator_placement(user, &id(1), "foreign", current_revision()).is_err());
        assert!(creator_placement(user, &id(1), "selftest", current_revision() - 1).is_err());
        assert_eq!(place_new_club_for(user, id(1), "selftest".into(), 1).unwrap(), first);
        for n in 2..=MAX_SELF_PLACEMENTS { place_new_club_for(user, id(n), "selftest".into(), 1).unwrap(); }
        assert!(place_new_club_for(user, id(99), "selftest".into(), 1).is_err());
        assert_eq!(group_for("self-group").unwrap().assigned_clubs, MAX_SELF_PLACEMENTS as u32);
    }

    #[test]
    fn hosted_lookup_returns_only_assigned_group_for_matching_deployment() {
        let group = ShardGroup {
            id: "host-group".into(), target_alias: "mainnet".into(), domains: vec![],
            accepting: true, max_clubs: 5, assigned_clubs: 0,
            heap_budget_bytes: 1_000, heap_bytes: 1, min_cycles: 1, cycles: 2, observed_at_ns: 1, photo_store: None,
        };
        GROUPS.with(|items| items.borrow_mut().insert(group.id.as_bytes().to_vec(), encode(&group)));
        let assigned = assign_group_record("host-club".into(), "mainnet".into(), current_revision(), 1).unwrap();
        let rev = current_revision();
        assert_eq!(hosted_assignment("host-club", "mainnet", rev, rev).unwrap(), assigned);
        assert!(hosted_assignment("host-club", "other-engine", rev, rev).is_err());
        assert!(hosted_assignment("host-club", "mainnet", rev - 1, rev).is_err());
        assert!(hosted_assignment("unknown-club", "mainnet", rev, rev).is_err());
        assert!(hosted_assignment("", "mainnet", rev, rev).is_err());
    }

    #[test]
    fn conflicting_revision_does_not_reserve_a_slot() {
        let before = current_revision();
        assert!(assign_group_record("conflict-club".into(), "mainnet".into(), before + 1, 1).is_err());
        assert!(group_assignment_for("conflict-club").is_none());
        assert_eq!(current_revision(), before);
    }
}

/// Public: remaining cycles (shown in admin settings).
#[ic_cdk::query]
fn cycles_balance() -> candid::Nat {
    candid::Nat::from(ic_cdk::api::canister_cycle_balance())
}

#[derive(candid::CandidType)]
struct MemoryStats { heap_bytes: candid::Nat, memory_bytes: candid::Nat, stable_bytes: candid::Nat }

/// Public: live memory reading for the admin health page.
#[ic_cdk::query]
fn memory_stats() -> MemoryStats {
    #[cfg(target_arch = "wasm32")]
    let heap = core::arch::wasm32::memory_size(0) as u64 * 65536;
    #[cfg(not(target_arch = "wasm32"))]
    let heap = 0u64;
    let stable = ic_cdk::stable::stable_size() * 65536;
    MemoryStats { heap_bytes: heap.into(), memory_bytes: (heap + stable).into(), stable_bytes: stable.into() }
}

ic_cdk::export_candid!();

pub fn candid_interface() -> String { __export_service() }

#[cfg(test)]
mod private_writer_contract_export {
    #[test]
    fn export_contract_when_requested() {
        if std::env::var_os("IGNITE_EXPORT_CANDID").is_some() {
            std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/shard_router.did"), super::__export_service()).expect("write candid");
        }
    }
}
