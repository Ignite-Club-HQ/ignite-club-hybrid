//! Synthetic permanent backend-placement registry for the hybrid architecture POC.
//! It contains no production URLs, credentials, Supabase calls, or real identities.

use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, StableCell,
};
use serde::{Deserialize, Serialize};
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;
type Outcome<T> = Result<T, String>;
const MAX_ID: usize = 64;
const MAX_PAGE: u16 = 100;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum Backend {
    Supabase { environment: String },
    Icp { canister: Principal },
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Placement {
    pub club_id: String,
    pub country: String,
    pub backend: Backend,
    pub state: PlacementState,
    pub version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum PlacementState {
    Active,
    ReadOnly,
    MigrationRequired,
    Blocked,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Policy {
    pub country: String,
    pub supabase_enabled: bool,
    pub icp_enabled: bool,
    pub version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Decision {
    pub placement: Placement,
    pub backend_enabled: bool,
    pub country_allowed: bool,
    pub writable: bool,
    pub reason: String,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Page {
    pub registry_version: u64,
    pub placements: Vec<Placement>,
    pub next: Option<String>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Init {
    pub governor: Principal,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Availability {
    pub supabase_enabled: bool,
    pub icp_enabled: bool,
    pub version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditEvent {
    pub id: u64,
    pub at_ns: u64,
    pub caller: Principal,
    pub action: String,
    pub club_id: Option<String>,
    pub detail: String,
    pub registry_version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AuditPage {
    pub events: Vec<AuditEvent>,
    pub next: Option<u64>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Target {
    pub alias: String,
    pub site_id: Option<String>,
    pub profile: String,
    pub backend: Backend,
    pub deployment_class: String,
    pub enabled: bool,
    pub healthy: bool,
    pub version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct SiteAvailability {
    pub site_id: String,
    pub enabled: bool,
    pub version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResidencyAssignment {
    pub club_id: String,
    pub profile: String,
    pub target_alias: String,
    pub version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ResidencyPolicy {
    pub country: String,
    pub allowed_profiles: Vec<String>,
    pub version: u64,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum OperatorRole {
    PlacementAdmin,
    MigrationOperator,
    SecurityAdmin,
    InfrastructureAdmin,
    Auditor,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Operator {
    pub user: Principal,
    pub roles: Vec<OperatorRole>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum BackendKind {
    Supabase,
    Icp,
}

thread_local! {
    static MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static GOVERNOR: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(0), Vec::new()));
    static PLACEMENTS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(1)));
    static VERSION: RefCell<StableCell<u64, Memory>> = RefCell::new(StableCell::init(memory(2), 0));
    static AVAILABILITY: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(3), Vec::new()));
    static POLICIES: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(4)));
    static AUDIT: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(5)));
    static AUDIT_SEQUENCE: RefCell<StableCell<u64, Memory>> = RefCell::new(StableCell::init(memory(6), 0));
    static TARGETS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(7)));
    static RESIDENCY: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(8)));
    static RESIDENCY_POLICIES: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(9)));
    static OPERATORS: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(10)));
    static SITE_AVAILABILITY: RefCell<StableBTreeMap<Vec<u8>, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(11)));
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
fn current_version() -> u64 {
    VERSION.with(|version| *version.borrow().get())
}
fn bump_version(current: u64) -> Outcome<u64> {
    current
        .checked_add(1)
        .ok_or_else(|| "Registry version exhausted".into())
}
fn availability() -> Availability {
    AVAILABILITY.with(|cell| {
        let bytes = cell.borrow().get().clone();
        if bytes.is_empty() {
            Availability {
                supabase_enabled: true,
                icp_enabled: true,
                version: 0,
            }
        } else {
            decode(&bytes)
        }
    })
}
fn governor() -> Option<Principal> {
    GOVERNOR.with(|cell| {
        let bytes = cell.borrow().get().clone();
        (!bytes.is_empty()).then(|| Principal::from_slice(&bytes))
    })
}
fn require_governor() -> Outcome<()> {
    if governor() == Some(ic_cdk::api::msg_caller()) {
        Ok(())
    } else {
        Err("Forbidden".into())
    }
}
fn require_operator(role: OperatorRole) -> Outcome<()> {
    if governor() == Some(ic_cdk::api::msg_caller()) {
        return Ok(());
    }
    let caller = ic_cdk::api::msg_caller();
    let allowed = OPERATORS.with(|items| {
        items
            .borrow()
            .get(&caller.as_slice().to_vec())
            .map(|bytes| decode::<Operator>(&bytes))
            .map(|operator| operator.roles.contains(&role))
            .unwrap_or(false)
    });
    if allowed {
        Ok(())
    } else {
        Err("Forbidden".into())
    }
}
fn validate_id(id: &str) -> Outcome<()> {
    if id.trim().is_empty() || id.len() > MAX_ID {
        Err("Invalid club ID".into())
    } else {
        Ok(())
    }
}
fn validate_country(country: &str) -> Outcome<()> {
    if country.len() != 2 || !country.bytes().all(|b| b.is_ascii_uppercase()) {
        Err("Country must be ISO 3166-1 alpha-2 uppercase".into())
    } else {
        Ok(())
    }
}
fn validate_operator_roles(roles: &[OperatorRole]) -> Outcome<()> {
    if roles.is_empty() {
        return Err("Operator must have at least one role".into());
    }
    let mut seen = std::collections::HashSet::new();
    for role in roles {
        if !seen.insert(role.clone()) {
            return Err("Duplicate operator roles are not allowed".into());
        }
    }
    Ok(())
}
fn validate_residency_profiles(profiles: &[String]) -> Outcome<()> {
    if profiles.is_empty() || profiles.iter().any(|profile| validate_id(profile).is_err()) {
        return Err("Invalid residency profiles".into());
    }
    let mut seen = std::collections::HashSet::new();
    for profile in profiles {
        if !seen.insert(profile.clone()) {
            return Err("Duplicate residency profiles are not allowed".into());
        }
    }
    Ok(())
}
fn validate_backend(backend: &Backend) -> Outcome<()> {
    match backend {
        Backend::Supabase { environment }
            if !environment.is_empty() && environment.len() <= MAX_ID =>
        {
            Ok(())
        }
        Backend::Icp { canister }
            if *canister != Principal::anonymous()
                && *canister != Principal::management_canister() =>
        {
            Ok(())
        }
        _ => Err("Invalid backend reference".into()),
    }
}
fn placement_for(id: &str) -> Option<Placement> {
    PLACEMENTS.with(|placements| {
        placements
            .borrow()
            .get(&id.as_bytes().to_vec())
            .map(|bytes| decode(&bytes))
    })
}
fn policy_for(country: &str) -> Policy {
    POLICIES
        .with(|policies| {
            policies
                .borrow()
                .get(&country.as_bytes().to_vec())
                .map(|bytes| decode(&bytes))
        })
        .unwrap_or(Policy {
            country: country.into(),
            supabase_enabled: true,
            icp_enabled: true,
            version: 0,
        })
}
fn backend_enabled(backend: &Backend, status: &Availability) -> bool {
    match backend {
        Backend::Supabase { .. } => status.supabase_enabled,
        Backend::Icp { .. } => status.icp_enabled,
    }
}
fn country_allows(backend: &Backend, policy: &Policy) -> bool {
    match backend {
        Backend::Supabase { .. } => policy.supabase_enabled,
        Backend::Icp { .. } => policy.icp_enabled,
    }
}
fn target_for(alias: &str) -> Option<Target> {
    TARGETS.with(|targets| {
        targets
            .borrow()
            .get(&alias.as_bytes().to_vec())
            .map(|bytes| decode(&bytes))
    })
}

fn target_is_available(target: Option<&Target>) -> bool {
    target.is_some_and(|target| target.enabled && target.healthy)
}
fn residency_policy_for(country: &str) -> ResidencyPolicy {
    RESIDENCY_POLICIES
        .with(|items| {
            items
                .borrow()
                .get(&country.as_bytes().to_vec())
                .map(|bytes| decode(&bytes))
        })
        .unwrap_or(ResidencyPolicy {
            country: country.into(),
            allowed_profiles: vec!["GLOBAL_NON_RESTRICTED".into()],
            version: 0,
        })
}
fn audit(action: &str, club_id: Option<String>, detail: String) {
    let id = AUDIT_SEQUENCE.with(|sequence| {
        let next = sequence.borrow().get().saturating_add(1);
        sequence.borrow_mut().set(next);
        next
    });
    let event = AuditEvent {
        id,
        at_ns: ic_cdk::api::time(),
        caller: ic_cdk::api::msg_caller(),
        action: action.into(),
        club_id,
        detail,
        registry_version: current_version(),
    };
    AUDIT.with(|events| {
        events
            .borrow_mut()
            .insert(id.to_be_bytes().to_vec(), encode(&event));
    });
}

#[ic_cdk::init]
fn init(init: Init) {
    assert!(init.governor != Principal::anonymous(), "invalid governor");
    GOVERNOR.with(|cell| cell.borrow_mut().set(init.governor.as_slice().to_vec()));
    AVAILABILITY.with(|cell| {
        cell.borrow_mut().set(encode(&Availability {
            supabase_enabled: true,
            icp_enabled: true,
            version: 0,
        }))
    });
}
#[ic_cdk::post_upgrade]
fn post_upgrade() {
    assert!(governor().is_some(), "missing governor");
}

#[ic_cdk::query]
fn get_placement(club_id: String) -> Outcome<Option<Placement>> {
    validate_id(&club_id)?;
    Ok(placement_for(&club_id))
}

#[ic_cdk::query]
fn get_policy(country: String) -> Outcome<Policy> {
    validate_country(&country)?;
    Ok(policy_for(&country))
}

#[ic_cdk::query]
fn get_decision(club_id: String) -> Outcome<Option<Decision>> {
    validate_id(&club_id)?;
    let Some(placement) = placement_for(&club_id) else {
        return Ok(None);
    };
    let enabled = backend_enabled(&placement.backend, &availability());
    let allowed = country_allows(&placement.backend, &policy_for(&placement.country));
    let residency = RESIDENCY.with(|items| {
        items
            .borrow()
            .get(&club_id.as_bytes().to_vec())
            .map(|bytes| decode::<ResidencyAssignment>(&bytes))
    });
    let target_available = residency
        .as_ref()
        .map(|r| target_for(&r.target_alias))
        .flatten()
        .as_ref()
        .map(|target| target_is_available(Some(target)))
        .unwrap_or(residency.is_none());
    let site_enabled = if let Some(ref r) = residency {
        let target = target_for(&r.target_alias);
        if let Some(ref target) = target {
            if let Some(ref s) = target.site_id {
                SITE_AVAILABILITY.with(|map| {
                    map.borrow()
                        .get(&s.as_bytes().to_vec())
                        .map(|bytes| decode::<SiteAvailability>(&bytes).enabled)
                        .unwrap_or(true)
                })
            } else {
                true
            }
        } else {
            false
        }
    } else {
        true
    };
    let writable = enabled
        && allowed
        && target_available
        && site_enabled
        && placement.state == PlacementState::Active;
    let reason = if placement.state != PlacementState::Active {
        format!("Placement state: {:?}", placement.state)
    } else if !enabled {
        "Backend disabled".into()
    } else if !allowed {
        "Backend disallowed in country".into()
    } else if !target_available {
        "Target unavailable".into()
    } else if !site_enabled {
        "Site disabled".into()
    } else {
        "Active".into()
    };
    Ok(Some(Decision {
        placement,
        backend_enabled: enabled,
        country_allowed: allowed,
        writable,
        reason,
    }))
}

#[ic_cdk::query]
fn get_site_availability(site_id: String) -> Outcome<bool> {
    validate_id(&site_id)?;
    let enabled = SITE_AVAILABILITY.with(|map| {
        map.borrow()
            .get(&site_id.as_bytes().to_vec())
            .map(|bytes| decode::<SiteAvailability>(&bytes).enabled)
            .unwrap_or(true)
    });
    Ok(enabled)
}

#[ic_cdk::query]
fn get_availability() -> Availability {
    availability()
}

#[ic_cdk::query]
fn list_placements(start_after: Option<String>, limit: u16) -> Outcome<Page> {
    if limit == 0 || limit > MAX_PAGE {
        return Err("Invalid page size".into());
    }
    let start = start_after.unwrap_or_default();
    if !start.is_empty() {
        validate_id(&start)?;
    }
    let mut placements = Vec::new();
    PLACEMENTS.with(|stored| {
        for entry in stored.borrow().iter() {
            let id = String::from_utf8(entry.key().to_vec()).expect("stable key");
            if !start.is_empty() && id <= start {
                continue;
            }
            placements.push(decode::<Placement>(&entry.value()));
            if placements.len() >= limit as usize {
                break;
            }
        }
    });
    Ok(Page {
        registry_version: current_version(),
        next: placements.last().map(|p| p.club_id.clone()),
        placements,
    })
}

#[ic_cdk::query]
fn list_audit(start_after: Option<u64>, limit: u16) -> Outcome<AuditPage> {
    require_operator(OperatorRole::Auditor)?;
    if limit == 0 || limit > MAX_PAGE {
        return Err("Invalid page size".into());
    }
    let start = start_after.unwrap_or(0);
    let mut events = Vec::new();
    AUDIT.with(|stored| {
        for entry in stored.borrow().iter() {
            let id = u64::from_be_bytes(
                entry
                    .key()
                    .as_slice()
                    .try_into()
                    .map_err(|_| "Invalid audit key")
                    .unwrap(),
            );
            if id <= start {
                continue;
            }
            events.push(decode::<AuditEvent>(&entry.value()));
            if events.len() >= limit as usize {
                break;
            }
        }
    });
    Ok(AuditPage {
        next: events.last().map(|event| event.id),
        events,
    })
}

#[ic_cdk::query]
fn get_target(alias: String) -> Outcome<Option<Target>> {
    validate_id(&alias)?;
    Ok(target_for(&alias))
}

#[ic_cdk::query]
fn get_residency(club_id: String) -> Outcome<Option<ResidencyAssignment>> {
    validate_id(&club_id)?;
    Ok(RESIDENCY.with(|items| {
        items
            .borrow()
            .get(&club_id.as_bytes().to_vec())
            .map(|bytes| decode(&bytes))
    }))
}

#[ic_cdk::query]
fn get_residency_policy(country: String) -> Outcome<ResidencyPolicy> {
    validate_country(&country)?;
    Ok(residency_policy_for(&country))
}

#[ic_cdk::query]
fn get_operator(principal: Principal) -> Outcome<Option<Operator>> {
    require_operator(OperatorRole::Auditor)?;
    Ok(OPERATORS.with(|items| {
        items
            .borrow()
            .get(&principal.as_slice().to_vec())
            .map(|bytes| decode(&bytes))
    }))
}

#[ic_cdk::update]
fn grant_operator(principal: Principal, roles: Vec<OperatorRole>) -> Outcome<Operator> {
    require_governor()?;
    if principal == Principal::anonymous() {
        return Err("Invalid operator".into());
    }
    validate_operator_roles(&roles)?;
    let operator = Operator {
        user: principal,
        roles,
    };
    OPERATORS.with(|items| {
        items
            .borrow_mut()
            .insert(principal.as_slice().to_vec(), encode(&operator))
    });
    audit("grant_operator", None, format!("principal={principal}"));
    Ok(operator)
}

#[ic_cdk::update]
fn revoke_operator(principal: Principal) -> Outcome<()> {
    require_governor()?;
    OPERATORS.with(|items| items.borrow_mut().remove(&principal.as_slice().to_vec()));
    audit("revoke_operator", None, format!("principal={principal}"));
    Ok(())
}

#[ic_cdk::update]
fn set_site_availability(
    site_id: String,
    enabled: bool,
    expected_version: u64,
) -> Outcome<SiteAvailability> {
    require_operator(OperatorRole::InfrastructureAdmin)?;
    validate_id(&site_id)?;
    if current_version() != expected_version {
        return Err("Registry version conflict".into());
    }
    let next_version = bump_version(current_version())?;
    let site_availability = SiteAvailability {
        site_id: site_id.clone(),
        enabled,
        version: next_version,
    };
    SITE_AVAILABILITY.with(|map| {
        map.borrow_mut()
            .insert(site_id.clone().into_bytes(), encode(&site_availability))
    });
    VERSION.with(|stored| stored.borrow_mut().set(next_version));
    audit(
        "set_site_availability",
        None,
        format!("site_id={site_id};enabled={enabled}"),
    );
    Ok(site_availability)
}

#[ic_cdk::update]
fn set_target(
    alias: String,
    site_id: Option<String>,
    profile: String,
    backend: Backend,
    deployment_class: String,
    enabled: bool,
    expected_version: u64,
) -> Outcome<Target> {
    require_operator(OperatorRole::InfrastructureAdmin)?;
    validate_id(&alias)?;
    if let Some(ref s) = site_id {
        validate_id(s)?;
    }
    validate_id(&profile)?;
    validate_id(&deployment_class)?;
    validate_backend(&backend)?;
    if current_version() != expected_version {
        return Err("Registry version conflict".into());
    }
    let next_version = bump_version(current_version())?;
    let target = Target {
        alias: alias.clone(),
        site_id,
        profile,
        backend,
        deployment_class,
        enabled,
        healthy: true,
        version: next_version,
    };
    TARGETS.with(|items| {
        items
            .borrow_mut()
            .insert(alias.into_bytes(), encode(&target))
    });
    VERSION.with(|stored| stored.borrow_mut().set(target.version));
    audit(
        "set_target",
        None,
        format!("alias={};enabled={}", target.alias, target.enabled),
    );
    Ok(target)
}

#[ic_cdk::update]
fn set_target_health(alias: String, healthy: bool, expected_version: u64) -> Outcome<Target> {
    require_operator(OperatorRole::InfrastructureAdmin)?;
    let mut target = target_for(&alias).ok_or("Target not registered")?;
    if current_version() != expected_version {
        return Err("Registry version conflict".into());
    }
    target.healthy = healthy;
    target.version = bump_version(current_version())?;
    TARGETS.with(|items| {
        items
            .borrow_mut()
            .insert(alias.into_bytes(), encode(&target))
    });
    VERSION.with(|stored| stored.borrow_mut().set(target.version));
    audit(
        "set_target_health",
        None,
        format!("alias={};healthy={healthy}", target.alias),
    );
    Ok(target)
}

#[ic_cdk::update]
fn set_residency_policy(
    country: String,
    allowed_profiles: Vec<String>,
    expected_version: u64,
) -> Outcome<ResidencyPolicy> {
    require_operator(OperatorRole::SecurityAdmin)?;
    validate_country(&country)?;
    validate_residency_profiles(&allowed_profiles)?;
    let previous = residency_policy_for(&country);
    if previous.version != expected_version {
        return Err("Residency policy version conflict".into());
    }
    let next = bump_version(previous.version)?;
    let policy = ResidencyPolicy {
        country: country.clone(),
        allowed_profiles,
        version: next,
    };
    RESIDENCY_POLICIES.with(|items| {
        items
            .borrow_mut()
            .insert(country.clone().into_bytes(), encode(&policy))
    });
    VERSION.with(|stored| stored.borrow_mut().set(next));
    audit(
        "set_residency_policy",
        None,
        format!("country={country};profiles={:?}", policy.allowed_profiles),
    );
    Ok(policy)
}

#[ic_cdk::update]
fn set_residency(
    club_id: String,
    profile: String,
    target_alias: String,
    expected_version: u64,
) -> Outcome<ResidencyAssignment> {
    require_operator(OperatorRole::PlacementAdmin)?;
    validate_id(&club_id)?;
    validate_id(&profile)?;
    validate_id(&target_alias)?;
    let placement = placement_for(&club_id).ok_or("Club has no placement")?;
    let target = target_for(&target_alias).ok_or("Target not registered")?;
    if !target.enabled {
        return Err("Target disabled".into());
    }
    if !target.healthy {
        return Err("Target unhealthy".into());
    }
    if target.profile != profile {
        return Err("Residency profile does not match target".into());
    }
    if !residency_policy_for(&placement.country)
        .allowed_profiles
        .iter()
        .any(|allowed| allowed == &profile)
    {
        return Err("Residency profile disallowed in country".into());
    }
    if target.backend != placement.backend {
        return Err("Target backend does not match placement".into());
    }
    if current_version() != expected_version {
        return Err("Registry version conflict".into());
    }
    let version = bump_version(current_version())?;
    let assignment = ResidencyAssignment {
        club_id: club_id.clone(),
        profile,
        target_alias,
        version,
    };
    RESIDENCY.with(|items| {
        items
            .borrow_mut()
            .insert(club_id.into_bytes(), encode(&assignment))
    });
    VERSION.with(|stored| stored.borrow_mut().set(version));
    audit(
        "set_residency",
        Some(assignment.club_id.clone()),
        format!(
            "profile={};target={}",
            assignment.profile, assignment.target_alias
        ),
    );
    Ok(assignment)
}

#[ic_cdk::update]
fn set_placement(
    club_id: String,
    country: String,
    backend: Backend,
    expected_version: u64,
) -> Outcome<Placement> {
    require_operator(OperatorRole::PlacementAdmin)?;
    validate_id(&club_id)?;
    validate_country(&country)?;
    validate_backend(&backend)?;
    let policy = policy_for(&country);
    if matches!(backend, Backend::Supabase { .. }) && !policy.supabase_enabled {
        return Err("Supabase disallowed in country".into());
    }
    if matches!(backend, Backend::Icp { .. }) && !policy.icp_enabled {
        return Err("ICP disallowed in country".into());
    }
    let status = availability();
    if matches!(backend, Backend::Supabase { .. }) && !status.supabase_enabled {
        return Err("Supabase backend disabled".into());
    }
    if matches!(backend, Backend::Icp { .. }) && !status.icp_enabled {
        return Err("ICP backend disabled".into());
    }
    if current_version() != expected_version {
        return Err("Registry version conflict".into());
    }
    let version = bump_version(current_version())?;
    let placement = Placement {
        club_id: club_id.clone(),
        country,
        backend,
        state: PlacementState::Active,
        version,
    };
    PLACEMENTS.with(|stored| {
        stored
            .borrow_mut()
            .insert(club_id.into_bytes(), encode(&placement))
    });
    VERSION.with(|stored| stored.borrow_mut().set(version));
    audit(
        "set_placement",
        Some(placement.club_id.clone()),
        format!(
            "backend={:?};country={}",
            placement.backend, placement.country
        ),
    );
    Ok(placement)
}

#[ic_cdk::update]
fn set_state(club_id: String, state: PlacementState, expected_version: u64) -> Outcome<Placement> {
    require_operator(OperatorRole::MigrationOperator)?;
    let mut placement = placement_for(&club_id).ok_or("Club has no placement")?;
    if current_version() != expected_version {
        return Err("Registry version conflict".into());
    }
    let version = bump_version(current_version())?;
    placement.state = state;
    placement.version = version;
    PLACEMENTS.with(|stored| {
        stored
            .borrow_mut()
            .insert(club_id.into_bytes(), encode(&placement))
    });
    VERSION.with(|stored| stored.borrow_mut().set(version));
    audit(
        "set_state",
        Some(placement.club_id.clone()),
        format!("state={:?}", placement.state),
    );
    Ok(placement)
}

#[ic_cdk::update]
fn set_policy(
    country: String,
    supabase_enabled: bool,
    icp_enabled: bool,
    expected_version: u64,
) -> Outcome<Policy> {
    require_operator(OperatorRole::SecurityAdmin)?;
    validate_country(&country)?;
    let policy = policy_for(&country);
    if policy.version != expected_version {
        return Err("Country policy version conflict".into());
    }
    let next = bump_version(policy.version)?;
    let updated = Policy {
        country: country.clone(),
        supabase_enabled,
        icp_enabled,
        version: next,
    };
    POLICIES.with(|policies| {
        policies
            .borrow_mut()
            .insert(country.clone().into_bytes(), encode(&updated))
    });
    VERSION.with(|stored| stored.borrow_mut().set(next));
    audit(
        "set_policy",
        None,
        format!("country={country};supabase={supabase_enabled};icp={icp_enabled}"),
    );
    Ok(updated)
}

#[ic_cdk::update]
fn set_availability(
    backend: BackendKind,
    enabled: bool,
    expected_version: u64,
) -> Outcome<Availability> {
    require_operator(OperatorRole::InfrastructureAdmin)?;
    let mut status = availability();
    if status.version != expected_version {
        return Err("Availability version conflict".into());
    }
    status.version = bump_version(status.version)?;
    match backend {
        BackendKind::Supabase => status.supabase_enabled = enabled,
        BackendKind::Icp => status.icp_enabled = enabled,
    }
    AVAILABILITY.with(|cell| cell.borrow_mut().set(encode(&status)));
    VERSION.with(|stored| stored.borrow_mut().set(status.version));
    audit(
        "set_availability",
        None,
        format!("backend={backend:?};enabled={enabled}"),
    );
    Ok(status)
}

#[ic_cdk::query]
fn version() -> u64 {
    current_version()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn backend_validation_is_fail_closed() {
        assert!(validate_backend(&Backend::Supabase {
            environment: "lab".into()
        })
        .is_ok());
        assert!(validate_backend(&Backend::Supabase {
            environment: "".into()
        })
        .is_err());
        assert!(validate_backend(&Backend::Icp {
            canister: Principal::anonymous()
        })
        .is_err());
    }
    #[test]
    fn identifiers_are_bounded() {
        assert!(validate_id("club-a").is_ok());
        assert!(validate_id("").is_err());
        assert!(validate_id(&"x".repeat(MAX_ID + 1)).is_err());
    }
    #[test]
    fn availability_policy_starts_enabled() {
        let status = Availability {
            supabase_enabled: true,
            icp_enabled: true,
            version: 0,
        };
        assert!(status.supabase_enabled && status.icp_enabled && status.version == 0);
    }
    #[test]
    fn country_policy_requires_uppercase_iso_code() {
        assert!(validate_country("AU").is_ok());
        assert!(validate_country("US").is_ok());
        assert!(validate_country("au").is_err());
        assert!(validate_country("AUS").is_err());
    }
    #[test]
    fn registry_version_bump_is_monotonic_and_fail_closed_on_overflow() {
        assert_eq!(bump_version(0).unwrap(), 1);
        assert_eq!(bump_version(9).unwrap(), 10);
        assert!(bump_version(u64::MAX).is_err());
    }
    #[test]
    fn operator_roles_and_residency_profiles_must_be_unique_and_valid() {
        assert!(validate_operator_roles(&[
            OperatorRole::PlacementAdmin,
            OperatorRole::PlacementAdmin
        ])
        .is_err());
        assert!(validate_operator_roles(&[
            OperatorRole::PlacementAdmin,
            OperatorRole::MigrationOperator
        ])
        .is_ok());
        assert!(validate_residency_profiles(&["AU_SYDNEY".into(), "AU_SYDNEY".into()]).is_err());
        assert!(validate_residency_profiles(&["US_EAST".into(), "US_WEST".into()]).is_ok());
        assert!(validate_residency_profiles(&["".into()]).is_err());
    }
    #[test]
    fn site_availability_starts_enabled_by_default() {
        let default_enabled = SITE_AVAILABILITY.with(|map| {
            map.borrow()
                .get(&"site-b".as_bytes().to_vec())
                .map(|bytes| decode::<SiteAvailability>(&bytes).enabled)
                .unwrap_or(true)
        });
        assert!(default_enabled);
    }

    #[test]
    fn target_must_be_enabled_and_healthy_for_writes() {
        let target = Target {
            alias: "target".into(),
            site_id: None,
            profile: "profile".into(),
            backend: Backend::Supabase {
                environment: "lab".into(),
            },
            deployment_class: "synthetic".into(),
            enabled: true,
            healthy: true,
            version: 1,
        };
        assert!(target_is_available(Some(&target)));
        assert!(!target_is_available(Some(&Target {
            enabled: false,
            ..target.clone()
        })));
        assert!(!target_is_available(Some(&Target {
            healthy: false,
            ..target
        })));
        assert!(!target_is_available(None));
    }
}

ic_cdk::export_candid!();
