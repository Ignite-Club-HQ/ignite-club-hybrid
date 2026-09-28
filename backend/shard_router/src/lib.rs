//! Synthetic shard registry for the local ICP scaling POC.
//! No production identities, routes, controllers, or external calls are used.

use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, StableCell,
};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

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
    if club_id.trim().is_empty() || club_id.len() > MAX_CLUB_ID_BYTES {
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
    validate_shard(request.shard)?;
    if migration_for(&request.club_id).is_some() {
        return Err("Club migration in progress".into());
    }
    let previous = route_for(&request.club_id);
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
    validate_club_id(&request.domain)?;
    validate_shard(request.shard)?;
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
}

ic_cdk::export_candid!();
