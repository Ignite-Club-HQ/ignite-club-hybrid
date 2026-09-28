//! Synthetic identity and authorization control plane for new ICP workloads.
//! Existing Supabase identities and data are never imported or modified.

use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableCell,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;
type Outcome<T> = Result<T, String>;
const SCHEMA: u32 = 1;
const MAX_ACCOUNTS: usize = 10_000;
const MAX_PRINCIPALS: usize = 8;
const MAX_ROLES: usize = 100_000;
const MAX_FAMILIES: usize = 100_000;
const MAX_EXCLUSIONS: usize = 100_000;
const MAX_CHALLENGES: usize = 10_000;
const CHALLENGE_TTL_NS: u64 = 600_000_000_000;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub principals: Vec<Principal>,
    pub version: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoleGrant {
    pub account_id: String,
    pub role: String,
    pub site_id: Option<String>,
    pub club: Option<String>,
    pub team: Option<String>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct FamilyLink {
    pub account_id: String,
    pub child_id: String,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Exclusion {
    pub account_id: String,
    pub site_id: Option<String>,
    pub club: String,
    pub team: Option<String>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct LinkChallenge {
    pub id: u64,
    pub account_id: String,
    pub issuer: Principal,
    pub target: Principal,
    pub expected_version: u64,
    pub expires_at_ns: u64,
    pub accepted: bool,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ExternalSiteBinding {
    pub account_id: String,
    pub site_id: String,
    pub external_user_id: String,
    pub linked_at_ns: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct PrivacyConsent {
    pub account_id: String,
    pub purpose: String,
    pub granted: bool,
    pub updated_at_ns: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct State {
    pub schema: u32,
    pub governor: Principal,
    pub accounts: Vec<Account>,
    pub roles: Vec<RoleGrant>,
    pub families: Vec<FamilyLink>,
    pub exclusions: Vec<Exclusion>,
    pub challenges: Vec<LinkChallenge>,
    pub external_bindings: Vec<ExternalSiteBinding>,
    pub privacy_consents: Vec<PrivacyConsent>,
    pub next_challenge: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Init {
    pub governor: Principal,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Access {
    pub account_id: String,
    pub app_admin: bool,
    pub club_admin: bool,
    pub team_member: bool,
    pub guardian: bool,
}

thread_local! {
    static MANAGER: RefCell<MemoryManager<DefaultMemoryImpl>> = RefCell::new(MemoryManager::init(DefaultMemoryImpl::default()));
    static STATE: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(0), Vec::new()));
}
fn memory(id: u8) -> Memory {
    MANAGER.with(|m| m.borrow().get(MemoryId::new(id)))
}
fn encode<T: Serialize>(value: &T) -> Vec<u8> {
    let mut bytes = Vec::new();
    ciborium::into_writer(value, &mut bytes).expect("stable encode");
    bytes
}
fn decode<T: for<'a> Deserialize<'a>>(bytes: &[u8]) -> T {
    ciborium::from_reader(bytes).expect("stable decode")
}
fn state() -> State {
    STATE.with(|s| decode(s.borrow().get()))
}
fn store(value: &State) {
    STATE.with(|s| s.borrow_mut().set(encode(value)));
}
fn authenticated(principal: Principal) -> Outcome<()> {
    if principal == Principal::anonymous() {
        Err("Authenticated user required".into())
    } else {
        Ok(())
    }
}
fn account_for(state: &State, principal: Principal) -> Outcome<Account> {
    authenticated(principal)?;
    state
        .accounts
        .iter()
        .find(|a| a.principals.contains(&principal))
        .cloned()
        .ok_or("Unlinked identity".into())
}
fn valid_id(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 128
}
fn account_id(principal: Principal) -> String {
    let digest = Sha256::digest(principal.as_slice());
    let hex: String = digest[..16]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}
fn ensure_account(state: &mut State, principal: Principal) -> Outcome<String> {
    authenticated(principal)?;
    if let Some(account) = state
        .accounts
        .iter()
        .find(|a| a.principals.contains(&principal))
    {
        return Ok(account.id.clone());
    }
    if state.accounts.len() >= MAX_ACCOUNTS {
        return Err("Account quota reached".into());
    }
    let id = account_id(principal);
    if state.accounts.iter().any(|a| a.id == id) {
        return Err("Account ID collision".into());
    }
    state.accounts.push(Account {
        id: id.clone(),
        principals: vec![principal],
        version: 0,
    });
    Ok(id)
}
fn require_governor(state: &State, caller: Principal) -> Outcome<()> {
    if state.governor == caller {
        Ok(())
    } else {
        Err("Forbidden".into())
    }
}
fn account_exists(state: &State, account_id: &str) -> bool {
    state
        .accounts
        .iter()
        .any(|account| account.id == account_id)
}
fn account_has_role(
    state: &State,
    id: &str,
    role: &str,
    site_id: Option<&str>,
    club: Option<&str>,
    team: Option<&str>,
) -> bool {
    state.roles.iter().any(|grant| {
        let site_matches = match (grant.site_id.as_deref(), site_id) {
            (None, _) => true, // Global grant applies to any site
            (Some(grant_site), Some(requested_site)) => grant_site == requested_site,
            (Some(_), None) => false, // Scoped grant does not match unspecified site
        };
        let club_matches = match (grant.club.as_deref(), club) {
            (None, _) => true,
            (Some(grant_club), Some(requested_club)) => grant_club == requested_club,
            (Some(_), None) => false,
        };
        let team_matches = match (grant.team.as_deref(), team) {
            (None, _) => true,
            (Some(grant_team), Some(requested_team)) => grant_team == requested_team,
            (Some(_), None) => false,
        };
        grant.account_id == id && grant.role == role && site_matches && club_matches && team_matches
    })
}
fn excluded(
    state: &State,
    id: &str,
    site_id: Option<&str>,
    club: Option<&str>,
    team: Option<&str>,
) -> bool {
    state.exclusions.iter().any(|item| {
        let site_matches = match (item.site_id.as_deref(), site_id) {
            (None, _) => true,
            (Some(item_site), Some(requested_site)) => item_site == requested_site,
            (Some(_), None) => false,
        };
        let club_matches = club.is_some() && item.club == club.unwrap_or_default();
        let team_matches = team.is_some() && item.team.as_deref() == team;
        item.account_id == id
            && site_matches
            && ((team.is_some() && team_matches) || (club_matches && item.team.is_none()))
    })
}
fn has_direct_team_role(
    state: &State,
    account_id: &str,
    site_id: Option<&str>,
    team_id: &str,
) -> bool {
    state.roles.iter().any(|grant| {
        let site_matches = match (grant.site_id.as_deref(), site_id) {
            (None, _) => true,
            (Some(grant_site), Some(requested_site)) => grant_site == requested_site,
            (Some(_), None) => false,
        };
        grant.account_id == account_id && grant.team.as_deref() == Some(team_id) && site_matches
    })
}
fn team_member_access(
    state: &State,
    account_id: &str,
    site_id: Option<&str>,
    club_id: Option<&str>,
    team_id: &str,
    guardian: bool,
) -> bool {
    !excluded(state, account_id, site_id, club_id, Some(team_id))
        && (has_direct_team_role(state, account_id, site_id, team_id) || guardian)
}

#[ic_cdk::init]
fn init(init: Init) {
    assert!(init.governor != Principal::anonymous(), "invalid governor");
    let state = State {
        schema: SCHEMA,
        governor: init.governor,
        accounts: vec![Account {
            id: account_id(init.governor),
            principals: vec![init.governor],
            version: 0,
        }],
        roles: vec![],
        families: vec![],
        exclusions: vec![],
        challenges: vec![],
        external_bindings: vec![],
        privacy_consents: vec![],
        next_challenge: 0,
    };
    store(&state);
}
#[ic_cdk::post_upgrade]
fn post_upgrade() {
    assert_eq!(state().schema, SCHEMA, "unsupported identity schema");
}

#[ic_cdk::query]
fn whoami() -> Outcome<Account> {
    account_for(&state(), ic_cdk::api::msg_caller())
}

#[ic_cdk::update]
fn register_account() -> Outcome<Account> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let account_id = ensure_account(&mut state, caller)?;
    let account = state
        .accounts
        .iter()
        .find(|account| account.id == account_id)
        .cloned()
        .ok_or("Account unavailable")?;
    store(&state);
    Ok(account)
}

#[ic_cdk::query]
fn access(club: Option<String>, team: Option<String>, child: Option<String>) -> Outcome<Access> {
    access_scoped(None, club, team, child)
}

#[ic_cdk::query]
fn access_scoped(
    site_id: Option<String>,
    club: Option<String>,
    team: Option<String>,
    child: Option<String>,
) -> Outcome<Access> {
    let state = state();
    let account = account_for(&state, ic_cdk::api::msg_caller())?;
    let account_id = account.id;
    let site_ref = site_id.as_deref();
    let club_ref = club.as_deref();
    let team_ref = team.as_deref();
    let guardian = child.as_ref().is_some_and(|id| {
        state
            .families
            .iter()
            .any(|link| link.account_id == account_id && link.child_id == *id)
            && !excluded(&state, &account_id, site_ref, club_ref, team_ref)
    });
    let team_member = team_ref.is_some_and(|id| {
        team_member_access(&state, &account_id, site_ref, club_ref, id, guardian)
    });
    let club_admin = club_ref.is_some_and(|id| {
        !excluded(&state, &account_id, site_ref, club_ref, None)
            && (account_has_role(&state, &account_id, "app_admin", None, None, None)
                || account_has_role(&state, &account_id, "club_admin", site_ref, Some(id), None))
    });
    Ok(Access {
        account_id: account_id.clone(),
        app_admin: account_has_role(&state, &account_id, "app_admin", None, None, None),
        club_admin,
        team_member,
        guardian,
    })
}

#[ic_cdk::query]
fn export_state() -> Outcome<State> {
    let state = state();
    require_governor(&state, ic_cdk::api::msg_caller())?;
    Ok(state)
}

#[ic_cdk::query]
fn get_external_bindings(account_id: String) -> Outcome<Vec<ExternalSiteBinding>> {
    let caller = ic_cdk::api::msg_caller();
    let state = state();
    let account = account_for(&state, caller)?;
    if account.id != account_id && state.governor != caller {
        return Err("Forbidden".into());
    }
    Ok(state
        .external_bindings
        .into_iter()
        .filter(|binding| binding.account_id == account_id)
        .collect())
}

#[ic_cdk::query]
fn get_privacy_consent(account_id: String, purpose: String) -> Outcome<bool> {
    let caller = ic_cdk::api::msg_caller();
    let state = state();
    let account = account_for(&state, caller)?;
    if account.id != account_id && state.governor != caller {
        return Err("Forbidden".into());
    }
    let granted = state
        .privacy_consents
        .iter()
        .find(|c| c.account_id == account_id && c.purpose == purpose)
        .map(|c| c.granted)
        .unwrap_or(false);
    Ok(granted)
}

#[ic_cdk::update]
fn begin_link(target: Principal) -> Outcome<LinkChallenge> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let account = account_for(&state, caller)?;
    authenticated(target)?;
    if state
        .accounts
        .iter()
        .any(|a| a.principals.contains(&target))
    {
        return Err("Target identity already assigned".into());
    }
    if account.principals.len() >= MAX_PRINCIPALS {
        return Err("Identity quota reached".into());
    }
    let now = ic_cdk::api::time();
    state
        .challenges
        .retain(|challenge| challenge.expires_at_ns > now);
    if state.challenges.len() >= MAX_CHALLENGES {
        return Err("Challenge quota reached".into());
    }
    state.next_challenge = state
        .next_challenge
        .checked_add(1)
        .ok_or("Challenge ID exhausted")?;
    let challenge = LinkChallenge {
        id: state.next_challenge,
        account_id: account.id,
        issuer: caller,
        target,
        expected_version: account.version,
        expires_at_ns: now
            .checked_add(CHALLENGE_TTL_NS)
            .ok_or("Challenge expiry overflow")?,
        accepted: false,
    };
    state.challenges.push(challenge.clone());
    store(&state);
    Ok(challenge)
}
#[ic_cdk::update]
fn accept_link(id: u64) -> Outcome<Account> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let index = state
        .challenges
        .iter()
        .position(|challenge| challenge.id == id)
        .ok_or("Unknown challenge")?;
    let challenge = state.challenges[index].clone();
    if challenge.target != caller || ic_cdk::api::time() >= challenge.expires_at_ns {
        return Err("Invalid or expired challenge".into());
    }
    if state
        .accounts
        .iter()
        .any(|account| account.principals.contains(&caller))
    {
        return Err("Identity already assigned".into());
    }
    let account = state
        .accounts
        .iter_mut()
        .find(|account| account.id == challenge.account_id)
        .ok_or("Account unavailable")?;
    if challenge.accepted
        || account.version != challenge.expected_version
        || !account.principals.contains(&challenge.issuer)
    {
        return Err("Link authorization changed".into());
    }
    account.version = account
        .version
        .checked_add(1)
        .ok_or("Account version exhausted")?;
    if account.principals.len() >= MAX_PRINCIPALS {
        return Err("Identity quota reached".into());
    }
    account.principals.push(caller);
    state.challenges[index].accepted = true;
    let result = account.clone();
    store(&state);
    Ok(result)
}
#[ic_cdk::update]
fn revoke(principal: Principal, expected_version: u64) -> Outcome<Account> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let current = account_for(&state, caller)?;
    if !current.principals.contains(&principal) || current.principals.len() == 1 {
        return Err("Cannot revoke missing or last identity".into());
    }
    let account = state
        .accounts
        .iter_mut()
        .find(|account| account.id == current.id)
        .expect("account exists");
    if account.version != expected_version {
        return Err("Account version conflict".into());
    }
    account.version = account
        .version
        .checked_add(1)
        .ok_or("Account version exhausted")?;
    account.principals.retain(|item| *item != principal);
    let result = account.clone();
    store(&state);
    Ok(result)
}

#[ic_cdk::update]
fn bind_external_site(
    account_id: String,
    site_id: String,
    external_user_id: String,
) -> Outcome<ExternalSiteBinding> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    if !valid_id(&account_id) || !valid_id(&site_id) || !valid_id(&external_user_id) {
        return Err("Invalid external binding parameters".into());
    }
    if !state.accounts.iter().any(|a| a.id == account_id) {
        return Err("Unknown account".into());
    }
    if state.external_bindings.iter().any(|b| {
        b.site_id == site_id && b.external_user_id == external_user_id && b.account_id != account_id
    }) {
        return Err("External user already bound to another account".into());
    }
    let now = ic_cdk::api::time();
    if let Some(pos) = state
        .external_bindings
        .iter()
        .position(|b| b.account_id == account_id && b.site_id == site_id)
    {
        let mut binding = state.external_bindings[pos].clone();
        binding.external_user_id = external_user_id;
        binding.linked_at_ns = now;
        state.external_bindings[pos] = binding.clone();
        store(&state);
        return Ok(binding);
    }
    let binding = ExternalSiteBinding {
        account_id,
        site_id,
        external_user_id,
        linked_at_ns: now,
    };
    state.external_bindings.push(binding.clone());
    store(&state);
    Ok(binding)
}

#[ic_cdk::update]
fn set_privacy_consent(
    account_id: String,
    purpose: String,
    granted: bool,
) -> Outcome<PrivacyConsent> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let account = account_for(&state, caller)?;
    if account.id != account_id && state.governor != caller {
        return Err("Forbidden".into());
    }
    if !valid_id(&account_id) || !valid_id(&purpose) {
        return Err("Invalid consent parameters".into());
    }
    let now = ic_cdk::api::time();
    if let Some(pos) = state
        .privacy_consents
        .iter()
        .position(|c| c.account_id == account_id && c.purpose == purpose)
    {
        let mut consent = state.privacy_consents[pos].clone();
        consent.granted = granted;
        consent.updated_at_ns = now;
        state.privacy_consents[pos] = consent.clone();
        store(&state);
        return Ok(consent);
    }
    let consent = PrivacyConsent {
        account_id,
        purpose,
        granted,
        updated_at_ns: now,
    };
    state.privacy_consents.push(consent.clone());
    store(&state);
    Ok(consent)
}

#[ic_cdk::update]
fn erase_account(account_id: String) -> Outcome<()> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let caller_account = account_for(&state, caller)?;
    if caller_account.id != account_id && state.governor != caller {
        return Err("Forbidden".into());
    }
    if state
        .accounts
        .iter()
        .any(|account| account.id == account_id && account.principals.contains(&state.governor))
    {
        return Err("Governor account cannot be erased".into());
    }
    if !state
        .accounts
        .iter()
        .any(|account| account.id == account_id)
    {
        return Err("Unknown account".into());
    }
    let erased_principals = state
        .accounts
        .iter()
        .find(|account| account.id == account_id)
        .map(|account| account.principals.clone())
        .unwrap_or_default();
    state.accounts.retain(|account| account.id != account_id);
    state.roles.retain(|grant| grant.account_id != account_id);
    state.families.retain(|link| link.account_id != account_id);
    state
        .exclusions
        .retain(|item| item.account_id != account_id);
    state
        .external_bindings
        .retain(|binding| binding.account_id != account_id);
    state
        .privacy_consents
        .retain(|consent| consent.account_id != account_id);
    state.challenges.retain(|challenge| {
        challenge.account_id != account_id && !erased_principals.contains(&challenge.target)
    });
    store(&state);
    Ok(())
}

#[ic_cdk::update]
fn grant_role(
    account_id: String,
    role: String,
    club: Option<String>,
    team: Option<String>,
) -> Outcome<()> {
    grant_role_scoped(account_id, role, None, club, team)
}

#[ic_cdk::update]
fn grant_role_scoped(
    account_id: String,
    role: String,
    site_id: Option<String>,
    club: Option<String>,
    team: Option<String>,
) -> Outcome<()> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    if !valid_id(&account_id)
        || !valid_id(&role)
        || site_id.as_ref().is_some_and(|v| !valid_id(v))
        || club.as_ref().is_some_and(|v| !valid_id(v))
        || team.as_ref().is_some_and(|v| !valid_id(v))
    {
        return Err("Invalid role fields".into());
    }
    if !account_exists(&state, &account_id) {
        return Err("Unknown account".into());
    }
    if state.roles.len() >= MAX_ROLES {
        return Err("Role quota reached".into());
    }
    if state.roles.iter().any(|item| {
        item.account_id == account_id
            && item.role == role
            && item.site_id == site_id
            && item.club == club
            && item.team == team
    }) {
        return Err("Duplicate role".into());
    }
    state.roles.push(RoleGrant {
        account_id,
        role,
        site_id,
        club,
        team,
    });
    store(&state);
    Ok(())
}

#[ic_cdk::update]
fn set_family(account_id: String, child_id: String) -> Outcome<()> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    if !valid_id(&account_id) || !valid_id(&child_id) {
        return Err("Invalid family fields".into());
    }
    if state.families.len() >= MAX_FAMILIES {
        return Err("Family quota reached".into());
    }
    if !state
        .accounts
        .iter()
        .any(|account| account.id == account_id)
    {
        return Err("Unknown account".into());
    }
    if state
        .families
        .iter()
        .any(|item| item.account_id == account_id && item.child_id == child_id)
    {
        return Err("Duplicate family link".into());
    }
    state.families.push(FamilyLink {
        account_id,
        child_id,
    });
    store(&state);
    Ok(())
}

#[ic_cdk::update]
fn set_exclusion(account_id: String, club: String, team: Option<String>) -> Outcome<()> {
    set_exclusion_scoped(account_id, None, club, team)
}

#[ic_cdk::update]
fn set_exclusion_scoped(
    account_id: String,
    site_id: Option<String>,
    club: String,
    team: Option<String>,
) -> Outcome<()> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    if !valid_id(&account_id)
        || site_id.as_ref().is_some_and(|v| !valid_id(v))
        || !valid_id(&club)
        || team.as_ref().is_some_and(|v| !valid_id(v))
    {
        return Err("Invalid exclusion fields".into());
    }
    if !account_exists(&state, &account_id) {
        return Err("Unknown account".into());
    }
    if state.exclusions.len() >= MAX_EXCLUSIONS {
        return Err("Exclusion quota reached".into());
    }
    if state.exclusions.iter().any(|item| {
        item.account_id == account_id
            && item.site_id == site_id
            && item.club == club
            && item.team == team
    }) {
        return Err("Duplicate exclusion".into());
    }
    state.exclusions.push(Exclusion {
        account_id,
        site_id,
        club,
        team,
    });
    store(&state);
    Ok(())
}

#[ic_cdk::query]
fn check_field_access(account_id: String, section: String) -> Outcome<bool> {
    let state = state();
    let caller = ic_cdk::api::msg_caller();
    let caller_account = account_for(&state, caller)?;
    if state.governor == caller || caller_account.id == account_id {
        return Ok(true);
    }
    if state
        .families
        .iter()
        .any(|link| link.account_id == caller_account.id && link.child_id == account_id)
    {
        if section == "child_guardian_data" || section == "guardian_profile" {
            return Ok(true);
        }
    }
    let consent = state.privacy_consents.iter().any(|consent| {
        consent.account_id == account_id && consent.purpose == section && consent.granted
    });
    Ok(consent)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn principal(value: u8) -> Principal {
        Principal::self_authenticating([value; 32])
    }
    #[test]
    fn ids_and_role_scope_are_bounded() {
        assert!(valid_id("club-a"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"x".repeat(129)));
        let governor = principal(1);
        let mut state = State {
            schema: SCHEMA,
            governor,
            accounts: vec![Account {
                id: "account-1".into(),
                principals: vec![principal(2)],
                version: 0,
            }],
            roles: vec![],
            families: vec![],
            exclusions: vec![],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            next_challenge: 0,
        };
        state.roles.push(RoleGrant {
            account_id: "account-1".into(),
            role: "club_admin".into(),
            site_id: None,
            club: Some("club-a".into()),
            team: None,
        });
        assert!(account_has_role(
            &state,
            "account-1",
            "club_admin",
            None,
            Some("club-a"),
            None
        ));
        assert!(!account_has_role(
            &state,
            "account-1",
            "club_admin",
            None,
            Some("club-b"),
            None
        ));
        assert!(account_exists(&state, "account-1"));
        assert!(!account_exists(&state, "missing"));
    }
    #[test]
    fn exclusions_override_scoped_roles_but_not_global_role_detection() {
        let governor = principal(1);
        let state = State {
            schema: SCHEMA,
            governor,
            accounts: vec![],
            roles: vec![RoleGrant {
                account_id: "a".into(),
                role: "app_admin".into(),
                site_id: None,
                club: None,
                team: None,
            }],
            families: vec![],
            exclusions: vec![Exclusion {
                account_id: "a".into(),
                site_id: None,
                club: "club-a".into(),
                team: None,
            }],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            next_challenge: 0,
        };
        assert!(account_has_role(&state, "a", "app_admin", None, None, None));
        assert!(excluded(&state, "a", None, Some("club-a"), None));
    }
    #[test]
    fn multi_site_roles_and_exclusions_are_isolated() {
        let governor = principal(1);
        let state = State {
            schema: SCHEMA,
            governor,
            accounts: vec![Account {
                id: "acc-1".into(),
                principals: vec![principal(2)],
                version: 0,
            }],
            roles: vec![RoleGrant {
                account_id: "acc-1".into(),
                role: "club_admin".into(),
                site_id: Some("site-a".into()),
                club: Some("club-1".into()),
                team: None,
            }],
            families: vec![],
            exclusions: vec![Exclusion {
                account_id: "acc-1".into(),
                site_id: Some("site-b".into()),
                club: "club-1".into(),
                team: None,
            }],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            next_challenge: 0,
        };
        assert!(account_has_role(
            &state,
            "acc-1",
            "club_admin",
            Some("site-a"),
            Some("club-1"),
            None
        ));
        assert!(!account_has_role(
            &state,
            "acc-1",
            "club_admin",
            Some("site-b"),
            Some("club-1"),
            None
        ));
        assert!(!excluded(
            &state,
            "acc-1",
            Some("site-a"),
            Some("club-1"),
            None
        ));
        assert!(excluded(
            &state,
            "acc-1",
            Some("site-b"),
            Some("club-1"),
            None
        ));
    }

    #[test]
    fn guardian_access_respects_club_exclusion() {
        let governor = principal(1);
        let state = State {
            schema: SCHEMA,
            governor,
            accounts: vec![Account {
                id: "guardian-1".into(),
                principals: vec![principal(2)],
                version: 0,
            }],
            roles: vec![],
            families: vec![FamilyLink {
                account_id: "guardian-1".into(),
                child_id: "child-9".into(),
            }],
            exclusions: vec![Exclusion {
                account_id: "guardian-1".into(),
                site_id: Some("site-a".into()),
                club: "club-1".into(),
                team: None,
            }],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            next_challenge: 0,
        };

        let connected = state
            .families
            .iter()
            .any(|link| link.account_id == "guardian-1" && link.child_id == "child-9")
            && !excluded(&state, "guardian-1", Some("site-a"), Some("club-1"), None);
        assert!(
            !connected,
            "guardian access must fail when the relevant club scope is excluded"
        );
        assert!(excluded(
            &state,
            "guardian-1",
            Some("site-a"),
            Some("club-1"),
            None
        ));
    }

    #[test]
    fn direct_team_roles_are_exact_membership_without_admin_bypass() {
        let governor = principal(1);
        let state = State {
            schema: SCHEMA,
            governor,
            accounts: vec![],
            roles: vec![
                RoleGrant {
                    account_id: "player".into(),
                    role: "player".into(),
                    site_id: Some("site-a".into()),
                    club: Some("club-a".into()),
                    team: Some("team-a".into()),
                },
                RoleGrant {
                    account_id: "admin".into(),
                    role: "app_admin".into(),
                    site_id: None,
                    club: None,
                    team: None,
                },
            ],
            families: vec![],
            exclusions: vec![],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            next_challenge: 0,
        };

        assert!(team_member_access(
            &state,
            "player",
            Some("site-a"),
            Some("club-a"),
            "team-a",
            false,
        ));
        assert!(!team_member_access(
            &state,
            "player",
            Some("site-a"),
            Some("club-a"),
            "team-b",
            false,
        ));
        assert!(!team_member_access(
            &state,
            "player",
            Some("site-b"),
            Some("club-a"),
            "team-a",
            false,
        ));
        assert!(!team_member_access(
            &state,
            "admin",
            Some("site-a"),
            Some("club-a"),
            "team-a",
            false,
        ));
    }

    #[test]
    fn field_access_requires_explicit_consent_or_self_access() {
        let governor = principal(1);
        let account_self = Account {
            id: "user-1".into(),
            principals: vec![principal(2)],
            version: 0,
        };
        let state = State {
            schema: SCHEMA,
            governor,
            accounts: vec![account_self],
            roles: vec![],
            families: vec![],
            exclusions: vec![],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![PrivacyConsent {
                account_id: "user-1".into(),
                purpose: "child_photo_processing".into(),
                granted: true,
                updated_at_ns: 0,
            }],
            next_challenge: 0,
        };

        assert!(state
            .privacy_consents
            .iter()
            .any(|entry| entry.account_id == "user-1"
                && entry.purpose == "child_photo_processing"
                && entry.granted));
        assert!(state.accounts.iter().any(|entry| entry.id == "user-1"));
    }

    #[test]
    fn erasure_cleanup_contract_is_explicit() {
        let state = State {
            schema: SCHEMA,
            governor: principal(1),
            accounts: vec![Account {
                id: "user-1".into(),
                principals: vec![principal(2)],
                version: 0,
            }],
            roles: vec![RoleGrant {
                account_id: "user-1".into(),
                role: "club_admin".into(),
                site_id: Some("site-a".into()),
                club: Some("club-a".into()),
                team: None,
            }],
            families: vec![FamilyLink {
                account_id: "user-1".into(),
                child_id: "child-1".into(),
            }],
            exclusions: vec![Exclusion {
                account_id: "user-1".into(),
                site_id: Some("site-a".into()),
                club: "club-a".into(),
                team: None,
            }],
            challenges: vec![],
            external_bindings: vec![ExternalSiteBinding {
                account_id: "user-1".into(),
                site_id: "site-a".into(),
                external_user_id: "external-1".into(),
                linked_at_ns: 0,
            }],
            privacy_consents: vec![PrivacyConsent {
                account_id: "user-1".into(),
                purpose: "profile".into(),
                granted: true,
                updated_at_ns: 0,
            }],
            next_challenge: 0,
        };
        let mut erased = state;
        erased.accounts.retain(|account| account.id != "user-1");
        erased.roles.retain(|grant| grant.account_id != "user-1");
        erased.families.retain(|link| link.account_id != "user-1");
        erased.exclusions.retain(|item| item.account_id != "user-1");
        erased
            .external_bindings
            .retain(|binding| binding.account_id != "user-1");
        erased
            .privacy_consents
            .retain(|consent| consent.account_id != "user-1");
        assert!(erased.accounts.is_empty());
        assert!(erased.roles.is_empty());
        assert!(erased.families.is_empty());
        assert!(erased.exclusions.is_empty());
        assert!(erased.external_bindings.is_empty());
        assert!(erased.privacy_consents.is_empty());
    }
}

pub fn candid_interface() -> String {
    __export_service()
}
ic_cdk::export_candid!();
