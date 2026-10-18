//! Synthetic shard registry for the local ICP scaling POC.
//! No production identities, routes, controllers, or external calls are used.

use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, StableCell,
};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;
mod groups;
use groups::{GroupAssignment, ShardGroup};

type Memory = VirtualMemory<DefaultMemoryImpl>;
type Outcome<T> = Result<T, String>;
const MAX_CLUB_ID_BYTES: usize = 64;
const MAX_PAGE: u16 = 100;

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

fn current_revision() -> u64 {
    REVISION.with(|revision| *revision.borrow().get())
}

#[ic_cdk::init]
fn init(init: Init) {
    assert!(init.governor != Principal::anonymous(), "invalid governor");
    GOVERNOR.with(|cell| cell.borrow_mut().set(init.governor.as_slice().to_vec()));
    REVISION.with(|revision| revision.borrow_mut().set(0));
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
    require_governor()?;
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
    require_governor()?;
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
    require_governor()?;
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
    require_governor()?;
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
    require_governor()?;
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
    require_governor()?;
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
    require_governor()?;
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
    require_governor()?;
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
fn group_for(id: &str) -> Option<ShardGroup> {
    GROUPS.with(|items| items.borrow().get(&id.as_bytes().to_vec()).map(|bytes| decode(&bytes)))
}
fn group_assignment_for(id: &str) -> Option<GroupAssignment> {
    GROUP_ASSIGNMENTS.with(|items| items.borrow().get(&id.as_bytes().to_vec()).map(|bytes| decode(&bytes)))
}

#[ic_cdk::update]
fn register_group(group: ShardGroup, expected_revision: u64) -> Outcome<u64> {
    require_governor()?;
    let mut group = group;
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let prior = group_for(&group.id);
    if let Some(ref old) = prior {
        if old.target_alias != group.target_alias || old.domains != group.domains {
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
    GROUPS.with(|items| items.borrow_mut().insert(group.id.as_bytes().to_vec(), encode(&group)));
    REVISION.with(|stored| stored.borrow_mut().set(revision));
    Ok(revision)
}

#[ic_cdk::update]
fn record_group_health(group_id: String, heap_bytes: u64, cycles: u64, expected_revision: u64) -> Outcome<u64> {
    require_governor()?;
    if current_revision() != expected_revision { return Err("Revision conflict".into()); }
    let mut group = group_for(&group_id).ok_or("Unknown group")?;
    // Report the largest heap and smallest cycle balance across ALL group
    // canisters. This is an operator observation, never browser authorization.
    group.heap_bytes = heap_bytes; group.cycles = cycles; group.observed_at_ns = ic_cdk::api::time();
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    GROUPS.with(|items| items.borrow_mut().insert(group_id.into_bytes(), encode(&group)));
    REVISION.with(|stored| stored.borrow_mut().set(revision));
    Ok(revision)
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
    require_governor()?;
    assign_group_record(club_id, target_alias, expected_revision, ic_cdk::api::time())
}

fn assign_group_record(club_id: String, target_alias: String, expected_revision: u64, now: u64) -> Outcome<GroupAssignment> {
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
    let rows: Vec<ShardGroup> = GROUPS.with(|items| items.borrow().iter().map(|entry| decode(&entry.value())).collect());
    let mut group = groups::select(&rows, &target_alias, now).cloned().ok_or("No healthy group with capacity")?;
    let revision = current_revision().checked_add(1).ok_or("Revision exhausted")?;
    group.assigned_clubs += 1;
    let assignment = GroupAssignment { club_id: club_id.clone(), group_id: group.id.clone(), revision };
    // Both maps update in one synchronous message; no await/reentrancy window.
    GROUPS.with(|items| items.borrow_mut().insert(group.id.as_bytes().to_vec(), encode(&group)));
    GROUP_ASSIGNMENTS.with(|items| items.borrow_mut().insert(club_id.into_bytes(), encode(&assignment)));
    REVISION.with(|stored| stored.borrow_mut().set(revision));
    Ok(assignment)
}

#[cfg(test)]
mod tests {
    use super::*;

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
            heap_budget_bytes: 1_000, heap_bytes: 1, min_cycles: 1, cycles: 2, observed_at_ns: 1,
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
