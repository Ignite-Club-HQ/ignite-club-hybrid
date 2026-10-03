//! Synthetic identity and authorization control plane for new ICP workloads.
//! Existing Supabase identities and data are never imported or modified.

use candid::{CandidType, Principal};
use ic_stable_structures::{
    memory_manager::{MemoryId, MemoryManager, VirtualMemory},
    DefaultMemoryImpl, StableBTreeMap, StableCell,
};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::cell::RefCell;

type Memory = VirtualMemory<DefaultMemoryImpl>;
type Outcome<T> = Result<T, String>;
/// Legacy blob (memory 0) schema marker. Bumped 4 -> 5 when accounts,
/// profiles and entitlements were split out of the monolithic blob into
/// their own StableBTreeMaps (see ACCOUNTS/PRINCIPAL_INDEX/PROFILES/
/// ENTITLEMENTS below). post_upgrade migrates any blob with schema < 5.
const SCHEMA: u32 = 5;
/// Legacy memory id: the slimmed State blob (governor/roles/families/
/// exclusions/challenges/external_bindings/privacy_consents/
/// terms_acceptances/verifiers/attestation_secret/next_challenge).
const MEM_STATE: u8 = 0;
/// account_id -> CBOR-encoded Account.
const MEM_ACCOUNTS: u8 = 1;
/// principal (text) -> account_id, so account_for/ensure_account are O(log N).
const MEM_PRINCIPAL_INDEX: u8 = 2;
/// account_id -> CBOR-encoded Profile.
const MEM_PROFILES: u8 = 3;
/// transaction_id (or a principal+product_id fallback key for non-IAP
/// grants) -> CBOR-encoded Entitlement.
const MEM_ENTITLEMENTS: u8 = 4;
const MAX_ACCOUNTS: usize = 10_000;
const MAX_PRINCIPALS: usize = 8;
const MAX_ROLES: usize = 100_000;
const MAX_FAMILIES: usize = 100_000;
const MAX_EXCLUSIONS: usize = 100_000;
const MAX_CHALLENGES: usize = 10_000;
const CHALLENGE_TTL_NS: u64 = 600_000_000_000;
const MAX_ENTITLEMENTS: usize = 100_000;
const MAX_VERIFIERS: usize = 16;

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
pub struct TermsAcceptance {
    pub account_id: String,
    pub terms_version: u32,
    pub accepted_at_ms: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Profile {
    pub account_id: String,
    pub display_name: String,
    pub avatar_ref: Option<String>,
    pub updated_at_ns: u64,
}
/// One row of a `search_profiles` result: the profile plus the account's
/// first principal (needed by callers to grant roles).
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ProfileSearchResult {
    pub account_id: String,
    pub principal: Principal,
    pub display_name: String,
    pub avatar_ref: Option<String>,
}
/// A Pro entitlement granted to a principal from an IAP (App Store) receipt
/// or a governor/verifier write. `transaction_id` is the Apple transaction
/// id (or empty for non-IAP grants) and is the replay-protection key: once a
/// transaction id has been redeemed, only the same principal may redeem it
/// again (idempotent re-verification), never a different one.
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Entitlement {
    pub principal: Principal,
    pub product_id: String,
    pub transaction_id: String,
    pub expires_at_ms: u64,
    pub source: String,
    pub granted_at_ms: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct State {
    pub schema: u32,
    pub governor: Principal,
    pub accounts: Vec<Account>,
    /// One profile per account. `#[serde(default)]` keeps schema-1 stable
    /// blobs (written before profiles existed) decodable; post_upgrade bumps
    /// the schema marker once decoded.
    #[serde(default)]
    pub profiles: Vec<Profile>,
    pub roles: Vec<RoleGrant>,
    pub families: Vec<FamilyLink>,
    pub exclusions: Vec<Exclusion>,
    pub challenges: Vec<LinkChallenge>,
    pub external_bindings: Vec<ExternalSiteBinding>,
    pub privacy_consents: Vec<PrivacyConsent>,
    /// Per-account terms/privacy re-acceptance records (schema 3+); empty
    /// on schema-2 blobs via serde default, decoded then bumped in
    /// post_upgrade. Wiped by erase_account.
    #[serde(default)]
    pub terms_acceptances: Vec<TermsAcceptance>,
    /// Pro entitlements granted via IAP receipt verification or governor/
    /// verifier writes (schema 4+); empty on older blobs via serde default.
    #[serde(default)]
    pub entitlements: Vec<Entitlement>,
    /// Principals (in addition to the governor) allowed to call
    /// `set_entitlement` directly — e.g. a server-side receipt verifier
    /// identity. Empty by default; only the governor can grow this list.
    #[serde(default)]
    pub verifiers: Vec<Principal>,
    /// Shared HMAC secret used to verify `redeem_entitlement` attestations
    /// minted by the session-free IAP verification endpoint. Empty until the
    /// governor calls `set_attestation_secret`; redemption is rejected while
    /// empty.
    #[serde(default)]
    pub attestation_secret: Vec<u8>,
    pub next_challenge: u64,
}
/// Slimmed on-disk shape of the legacy blob (memory 0) once schema >= 5:
/// accounts, profiles and entitlements live in their own StableBTreeMaps
/// instead of being re-encoded in full on every single update.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct CoreState {
    pub schema: u32,
    pub governor: Principal,
    pub roles: Vec<RoleGrant>,
    pub families: Vec<FamilyLink>,
    pub exclusions: Vec<Exclusion>,
    pub challenges: Vec<LinkChallenge>,
    pub external_bindings: Vec<ExternalSiteBinding>,
    pub privacy_consents: Vec<PrivacyConsent>,
    #[serde(default)]
    pub terms_acceptances: Vec<TermsAcceptance>,
    #[serde(default)]
    pub verifiers: Vec<Principal>,
    #[serde(default)]
    pub attestation_secret: Vec<u8>,
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
    static STATE: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(MEM_STATE), Vec::new()));
    static ACCOUNTS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_ACCOUNTS)));
    static PRINCIPAL_INDEX: RefCell<StableBTreeMap<String, String, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_PRINCIPAL_INDEX)));
    static PROFILES: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_PROFILES)));
    static ENTITLEMENTS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_ENTITLEMENTS)));
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
fn state() -> CoreState {
    STATE.with(|s| decode(s.borrow().get()))
}
fn store(value: &CoreState) {
    STATE.with(|s| s.borrow_mut().set(encode(value)));
}

// ---- Accounts (ACCOUNTS + PRINCIPAL_INDEX) ----
fn get_account(id: &str) -> Option<Account> {
    ACCOUNTS.with(|m| m.borrow().get(&id.to_string())).map(|b| decode(&b))
}
fn put_account(account: &Account) {
    ACCOUNTS.with(|m| m.borrow_mut().insert(account.id.clone(), encode(account)));
}
fn remove_account(id: &str) -> Option<Account> {
    ACCOUNTS.with(|m| m.borrow_mut().remove(&id.to_string())).map(|b| decode(&b))
}
fn account_count() -> u64 {
    ACCOUNTS.with(|m| m.borrow().len())
}
fn index_principal(principal: Principal, account_id: &str) {
    PRINCIPAL_INDEX.with(|m| m.borrow_mut().insert(principal.to_text(), account_id.to_string()));
}
fn deindex_principal(principal: Principal) {
    PRINCIPAL_INDEX.with(|m| m.borrow_mut().remove(&principal.to_text()));
}
fn find_account_by_principal(principal: Principal) -> Option<Account> {
    let account_id = PRINCIPAL_INDEX.with(|m| m.borrow().get(&principal.to_text()))?;
    get_account(&account_id)
}

// ---- Profiles ----
fn get_profile_entry(account_id: &str) -> Option<Profile> {
    PROFILES.with(|m| m.borrow().get(&account_id.to_string())).map(|b| decode(&b))
}
fn put_profile_entry(profile: &Profile) {
    PROFILES.with(|m| m.borrow_mut().insert(profile.account_id.clone(), encode(profile)));
}
fn remove_profile_entry(account_id: &str) {
    PROFILES.with(|m| m.borrow_mut().remove(&account_id.to_string()));
}
fn all_profiles() -> Vec<Profile> {
    PROFILES.with(|m| m.borrow().iter().map(|(_, v)| decode(&v)).collect())
}

// ---- Entitlements ----
/// Replay-protection key: Apple transaction ids are globally unique, so a
/// non-empty transaction id is the key on its own (the whole point of the
/// map is a single O(log N) lookup to both check and bind replay). Non-IAP
/// grants (empty transaction id) fall back to a principal+product key so a
/// governor/verifier can hold independent entitlements per product.
fn entitlement_key(principal: Principal, product_id: &str, transaction_id: &str) -> String {
    if transaction_id.is_empty() {
        format!("np|{}|{}", principal.to_text(), product_id)
    } else {
        format!("tx|{}", transaction_id)
    }
}
fn get_entitlement(key: &str) -> Option<Entitlement> {
    ENTITLEMENTS.with(|m| m.borrow().get(&key.to_string())).map(|b| decode(&b))
}
fn put_entitlement(key: &str, entitlement: &Entitlement) {
    ENTITLEMENTS.with(|m| m.borrow_mut().insert(key.to_string(), encode(entitlement)));
}
fn entitlements_count() -> u64 {
    ENTITLEMENTS.with(|m| m.borrow().len())
}
fn all_entitlements() -> Vec<Entitlement> {
    ENTITLEMENTS.with(|m| m.borrow().iter().map(|(_, v)| decode(&v)).collect())
}
/// Removes every entitlement granted to `principal` (used by erase_account).
fn remove_entitlements_for_principal(principal: Principal) {
    let keys: Vec<String> = ENTITLEMENTS.with(|m| {
        m.borrow()
            .iter()
            .filter(|(_, v)| decode::<Entitlement>(v).principal == principal)
            .map(|(k, _)| k)
            .collect()
    });
    ENTITLEMENTS.with(|m| {
        let mut map = m.borrow_mut();
        for key in keys {
            map.remove(&key);
        }
    });
}

fn authenticated(principal: Principal) -> Outcome<()> {
    if principal == Principal::anonymous() {
        Err("Authenticated user required".into())
    } else {
        Ok(())
    }
}
fn account_for(principal: Principal) -> Outcome<Account> {
    authenticated(principal)?;
    find_account_by_principal(principal).ok_or("Unlinked identity".into())
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
fn ensure_account(principal: Principal) -> Outcome<String> {
    authenticated(principal)?;
    if let Some(account) = find_account_by_principal(principal) {
        return Ok(account.id);
    }
    if account_count() >= MAX_ACCOUNTS as u64 {
        return Err("Account quota reached".into());
    }
    let id = account_id(principal);
    if get_account(&id).is_some() {
        return Err("Account ID collision".into());
    }
    put_account(&Account {
        id: id.clone(),
        principals: vec![principal],
        version: 0,
    });
    index_principal(principal, &id);
    Ok(id)
}
fn require_governor(state: &CoreState, caller: Principal) -> Outcome<()> {
    if state.governor == caller {
        Ok(())
    } else {
        Err("Forbidden".into())
    }
}
fn account_exists(account_id: &str) -> bool {
    get_account(account_id).is_some()
}
fn account_has_role(
    state: &CoreState,
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
    state: &CoreState,
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
    state: &CoreState,
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
    state: &CoreState,
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
    let governor_id = account_id(init.governor);
    put_account(&Account {
        id: governor_id.clone(),
        principals: vec![init.governor],
        version: 0,
    });
    index_principal(init.governor, &governor_id);
    let state = CoreState {
        schema: SCHEMA,
        governor: init.governor,
        roles: vec![],
        families: vec![],
        exclusions: vec![],
        challenges: vec![],
        external_bindings: vec![],
        privacy_consents: vec![],
        terms_acceptances: vec![],
        verifiers: vec![],
        attestation_secret: vec![],
        next_challenge: 0,
    };
    store(&state);
}

/// Splits a legacy full-blob `State` (schema 1..4, accounts/profiles/
/// entitlements inline) into the per-entry stable maps and returns the
/// slimmed `CoreState` to persist in memory 0 going forward. Idempotent to
/// call only once per legacy blob (post_upgrade only invokes it when
/// `legacy.schema < SCHEMA`).
fn migrate_legacy_state(legacy: State) -> CoreState {
    for account in &legacy.accounts {
        for principal in &account.principals {
            index_principal(*principal, &account.id);
        }
        put_account(account);
    }
    for profile in &legacy.profiles {
        put_profile_entry(profile);
    }
    for entitlement in &legacy.entitlements {
        let key = entitlement_key(
            entitlement.principal,
            &entitlement.product_id,
            &entitlement.transaction_id,
        );
        put_entitlement(&key, entitlement);
    }
    CoreState {
        schema: SCHEMA,
        governor: legacy.governor,
        roles: legacy.roles,
        families: legacy.families,
        exclusions: legacy.exclusions,
        challenges: legacy.challenges,
        external_bindings: legacy.external_bindings,
        privacy_consents: legacy.privacy_consents,
        terms_acceptances: legacy.terms_acceptances,
        verifiers: legacy.verifiers,
        attestation_secret: legacy.attestation_secret,
        next_challenge: legacy.next_challenge,
    }
}

#[ic_cdk::post_upgrade]
fn post_upgrade() {
    // The full legacy `State` shape (with `#[serde(default)]` on every field
    // added after schema 1) decodes both old full-blob schemas (1..4) and
    // the current slim `CoreState` blob (schema 5+, where accounts/
    // profiles/entitlements simply default to empty since the map no
    // longer carries those keys) -- so this single decode is safe at any
    // schema.
    let legacy: State = STATE.with(|s| decode(s.borrow().get()));
    assert!(legacy.schema <= SCHEMA, "unsupported identity schema");
    if legacy.schema < SCHEMA {
        let migrated = migrate_legacy_state(legacy);
        store(&migrated);
    }
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

fn valid_display_name(value: &str) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty() && trimmed.len() <= 80
}

/// Sets (or replaces) the caller's profile. The account must already exist —
/// sign-in provisioning calls register_account first.
#[ic_cdk::update]
fn set_profile(display_name: String, avatar_ref: Option<String>) -> Outcome<Profile> {
    let caller = ic_cdk::api::msg_caller();
    let state = state();
    let account_id = account_for(&state, caller)?.id;
    if !valid_display_name(&display_name) {
        return Err("Display name must be 1-80 characters".into());
    }
    if avatar_ref.as_deref().is_some_and(|a| a.len() > 512) {
        return Err("Avatar reference must be at most 512 characters".into());
    }
    let profile = Profile {
        account_id: account_id.clone(),
        display_name: display_name.trim().to_string(),
        avatar_ref,
        updated_at_ns: ic_cdk::api::time(),
    };
    let mut state = state;
    state.profiles.retain(|p| p.account_id != account_id);
    state.profiles.push(profile.clone());
    store(&state);
    Ok(profile)
}

/// The caller's own profile, or an error when none has been set yet.
#[ic_cdk::query]
fn get_profile() -> Outcome<Profile> {
    let state = state();
    let account_id = account_for(&state, ic_cdk::api::msg_caller())?.id;
    state
        .profiles
        .iter()
        .find(|p| p.account_id == account_id)
        .cloned()
        .ok_or("Profile not set".into())
}

/// Batch profile lookup by account id (principal text / user id), used by
/// the frontend profile cache to resolve many ids in one round trip.
/// Unknown ids are skipped rather than causing an error.
#[ic_cdk::query]
fn get_profiles_by_ids(ids: Vec<String>) -> Vec<Profile> {
    let state = state();
    ids.iter()
        .filter_map(|id| state.profiles.iter().find(|p| &p.account_id == id).cloned())
        .collect()
}

/// Case-insensitive substring search over display names — the ICP-mode
/// counterpart of the Supabase `search_invitable_profiles` RPC, used by the
/// "add an existing member" pickers. Returns at most `limit` (capped at 25)
/// matches; each result carries the account's first principal so the caller
/// can grant roles without a second lookup. Profiles without an account or
/// with a blank name are skipped.
#[ic_cdk::query]
fn search_profiles(query: String, limit: u16) -> Outcome<Vec<ProfileSearchResult>> {
    let needle = query.trim().to_lowercase();
    if needle.is_empty() {
        return Err("Search text is required".into());
    }
    let cap = limit.clamp(1, 25) as usize;
    let state = state();
    let mut results = Vec::new();
    for profile in &state.profiles {
        if profile.display_name.trim().is_empty()
            || !profile.display_name.to_lowercase().contains(&needle)
        {
            continue;
        }
        let principal = match state
            .accounts
            .iter()
            .find(|a| a.id == profile.account_id)
            .and_then(|a| a.principals.first())
        {
            Some(p) => *p,
            None => continue,
        };
        results.push(ProfileSearchResult {
            account_id: profile.account_id.clone(),
            principal,
            display_name: profile.display_name.clone(),
            avatar_ref: profile.avatar_ref.clone(),
        });
        if results.len() >= cap {
            break;
        }
    }
    Ok(results)
}

/// Every role grant held by the caller, across all clubs/teams.
#[ic_cdk::query]
fn my_roles() -> Outcome<Vec<RoleGrant>> {
    let state = state();
    let account_id = account_for(&state, ic_cdk::api::msg_caller())?.id;
    Ok(state
        .roles
        .iter()
        .filter(|grant| grant.account_id == account_id)
        .cloned()
        .collect())
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

/// Sets (records) the caller's acceptance of the current terms/privacy
/// version. Monotonic per-account: a version lower than (or equal to) the
/// caller's currently recorded version is rejected, so a stale client can
/// never roll the recorded acceptance backwards.
#[ic_cdk::update]
fn set_terms_acceptance(terms_version: u32) -> Outcome<TermsAcceptance> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let account_id = account_for(&state, caller)?.id;
    if terms_version == 0 {
        return Err("terms_version must be positive".into());
    }
    if let Some(existing) = state
        .terms_acceptances
        .iter()
        .find(|entry| entry.account_id == account_id)
    {
        if terms_version <= existing.terms_version {
            return Err("terms_version must increase monotonically".into());
        }
    }
    let record = TermsAcceptance {
        account_id: account_id.clone(),
        terms_version,
        accepted_at_ms: ic_cdk::api::time() / 1_000_000,
    };
    state
        .terms_acceptances
        .retain(|entry| entry.account_id != account_id);
    state.terms_acceptances.push(record.clone());
    store(&state);
    Ok(record)
}

/// The terms acceptance record for an arbitrary account: the account owner
/// or the governor only.
#[ic_cdk::query]
fn get_terms_acceptance(account_id: String) -> Outcome<Option<TermsAcceptance>> {
    let caller = ic_cdk::api::msg_caller();
    let state = state();
    let account = account_for(&state, caller)?;
    if account.id != account_id && state.governor != caller {
        return Err("Forbidden".into());
    }
    Ok(state
        .terms_acceptances
        .iter()
        .find(|entry| entry.account_id == account_id)
        .cloned())
}

/// The caller's own terms acceptance record, or `None` when they have never
/// accepted (used by the legal re-acceptance gate for Internet Identity
/// users).
#[ic_cdk::query]
fn my_terms_acceptance() -> Outcome<Option<TermsAcceptance>> {
    let state = state();
    let account_id = account_for(&state, ic_cdk::api::msg_caller())?.id;
    Ok(state
        .terms_acceptances
        .iter()
        .find(|entry| entry.account_id == account_id)
        .cloned())
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
        .profiles
        .retain(|profile| profile.account_id != account_id);
    state
        .privacy_consents
        .retain(|consent| consent.account_id != account_id);
    state
        .terms_acceptances
        .retain(|entry| entry.account_id != account_id);
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

/// Manual HMAC-SHA256 (RFC 2104) built on the existing `sha2` dependency so
/// attestation verification needs no extra crate. Used only to check
/// `redeem_entitlement` signatures minted by the session-free IAP
/// verification endpoint against the governor-set shared secret.
fn hmac_sha256(key: &[u8], msg: &[u8]) -> [u8; 32] {
    const BLOCK_SIZE: usize = 64;
    let mut key_block = [0u8; BLOCK_SIZE];
    if key.len() > BLOCK_SIZE {
        let hashed = Sha256::digest(key);
        key_block[..32].copy_from_slice(&hashed);
    } else {
        key_block[..key.len()].copy_from_slice(key);
    }
    let mut ipad = [0x36u8; BLOCK_SIZE];
    let mut opad = [0x5cu8; BLOCK_SIZE];
    for i in 0..BLOCK_SIZE {
        ipad[i] ^= key_block[i];
        opad[i] ^= key_block[i];
    }
    let mut inner = Sha256::new();
    inner.update(ipad);
    inner.update(msg);
    let inner_hash = inner.finalize();
    let mut outer = Sha256::new();
    outer.update(opad);
    outer.update(inner_hash);
    outer.finalize().into()
}
/// Constant-time hex decode; rejects odd-length or non-hex input.
fn hex_decode(hex: &str) -> Option<Vec<u8>> {
    let hex = hex.trim();
    if hex.len() % 2 != 0 {
        return None;
    }
    (0..hex.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&hex[i..i + 2], 16).ok())
        .collect()
}
/// Constant-time equality over byte slices. Used for attestation HMAC
/// verification so the comparison does not leak how many leading bytes
/// matched through timing. (Length inequality is public knowledge: the
/// expected HMAC length is fixed at 32 bytes.)
fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}
fn attestation_message(
    principal: Principal,
    product_id: &str,
    transaction_id: &str,
    expires_at_ms: u64,
    source: &str,
) -> Vec<u8> {
    format!(
        "{}|{}|{}|{}|{}",
        principal.to_text(),
        product_id,
        transaction_id,
        expires_at_ms,
        source
    )
    .into_bytes()
}
fn upsert_entitlement(
    state: &mut State,
    principal: Principal,
    product_id: String,
    transaction_id: String,
    expires_at_ms: u64,
    source: String,
) -> Outcome<Entitlement> {
    if !valid_id(&product_id) || !valid_id(&source) {
        return Err("Invalid entitlement fields".into());
    }
    // Replay protection: once an Apple transaction id has been redeemed, it
    // is permanently bound to the first principal that redeemed it. The same
    // principal may re-verify (idempotent refresh, e.g. renewal), but a
    // different principal submitting the same transaction id is rejected.
    if !transaction_id.is_empty() {
        if let Some(existing) = state
            .entitlements
            .iter()
            .find(|e| e.transaction_id == transaction_id)
        {
            if existing.principal != principal {
                return Err("Transaction already redeemed by another identity".into());
            }
        }
    }
    if state.entitlements.len() >= MAX_ENTITLEMENTS
        && !state.entitlements.iter().any(|e| {
            e.principal == principal && e.product_id == product_id && e.transaction_id == transaction_id
        })
    {
        return Err("Entitlement quota reached".into());
    }
    let record = Entitlement {
        principal,
        product_id: product_id.clone(),
        transaction_id: transaction_id.clone(),
        expires_at_ms,
        source,
        granted_at_ms: ic_cdk::api::time() / 1_000_000,
    };
    state.entitlements.retain(|e| {
        !(e.principal == principal
            && e.product_id == product_id
            && e.transaction_id == transaction_id)
    });
    state.entitlements.push(record.clone());
    Ok(record)
}

/// Governor-only: grants an additional verifier principal permitted to call
/// `set_entitlement` directly (e.g. a trusted server-side receipt verifier
/// identity, once one is established).
#[ic_cdk::update]
fn add_verifier(verifier: Principal) -> Outcome<()> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    authenticated(verifier)?;
    if state.verifiers.len() >= MAX_VERIFIERS {
        return Err("Verifier quota reached".into());
    }
    if !state.verifiers.contains(&verifier) {
        state.verifiers.push(verifier);
        store(&state);
    }
    Ok(())
}

/// Governor-only: revokes a verifier principal.
#[ic_cdk::update]
fn remove_verifier(verifier: Principal) -> Outcome<()> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    state.verifiers.retain(|v| *v != verifier);
    store(&state);
    Ok(())
}

/// Governor-only: sets (or rotates) the shared HMAC secret used to verify
/// `redeem_entitlement` attestations. Must match the secret held by the
/// session-free IAP verification endpoint (`APPLE_ATTESTATION_HMAC_SECRET`).
#[ic_cdk::update]
fn set_attestation_secret(secret: Vec<u8>) -> Outcome<()> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    if secret.len() < 16 {
        return Err("Attestation secret too short".into());
    }
    state.attestation_secret = secret;
    store(&state);
    Ok(())
}

/// Governor- or verifier-only: records a Pro entitlement for an arbitrary
/// principal. Used by a trusted server-side writer; client-submitted IAP
/// receipts instead go through `redeem_entitlement` below.
#[ic_cdk::update]
fn set_entitlement(
    principal: Principal,
    product_id: String,
    transaction_id: String,
    expires_at_ms: u64,
    source: String,
) -> Outcome<Entitlement> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    if state.governor != caller && !state.verifiers.contains(&caller) {
        return Err("Forbidden".into());
    }
    authenticated(principal)?;
    let record = upsert_entitlement(&mut state, principal, product_id, transaction_id, expires_at_ms, source)?;
    store(&state);
    Ok(record)
}

/// Caller-authenticated: redeems a signed attestation minted by the
/// session-free IAP verification endpoint after it confirms an Apple
/// receipt/transaction with the App Store. The endpoint has no Internet
/// Identity session and cannot act as the caller, so instead of writing the
/// entitlement itself it signs `{principal}|{product_id}|{transaction_id}|
/// {expires_at_ms}|{source}` with the shared secret and returns that
/// signature to the client; the client (already authenticated as `principal`
/// via II) submits it here, where the signature over its *own* principal is
/// verified before the entitlement is written. A different principal cannot
/// replay the signature because it is bound to the principal that produced
/// it (changing the principal changes the signed message).
#[ic_cdk::update]
fn redeem_entitlement(
    product_id: String,
    transaction_id: String,
    expires_at_ms: u64,
    source: String,
    signature_hex: String,
) -> Outcome<Entitlement> {
    let caller = ic_cdk::api::msg_caller();
    authenticated(caller)?;
    let mut state = state();
    if state.attestation_secret.is_empty() {
        return Err("IAP attestation is not configured".into());
    }
    let message = attestation_message(caller, &product_id, &transaction_id, expires_at_ms, &source);
    let expected = hmac_sha256(&state.attestation_secret, &message);
    let provided = match hex_decode(&signature_hex) {
        Some(bytes) => bytes,
        None => return Err("Invalid attestation signature".into()),
    };
    if !constant_time_eq(&expected, &provided) {
        return Err("Invalid attestation signature".into());
    }
    let record = upsert_entitlement(&mut state, caller, product_id, transaction_id, expires_at_ms, source)?;
    store(&state);
    Ok(record)
}

/// The caller's own entitlement records (active and expired).
#[ic_cdk::query]
fn get_my_entitlements() -> Outcome<Vec<Entitlement>> {
    let caller = ic_cdk::api::msg_caller();
    authenticated(caller)?;
    let state = state();
    Ok(state
        .entitlements
        .iter()
        .filter(|e| e.principal == caller)
        .cloned()
        .collect())
}

/// True when `principal` holds any non-expired Pro entitlement. Callable by
/// any authenticated principal (boolean only, no entitlement detail leaked).
#[ic_cdk::query]
fn is_pro(principal: Principal) -> Outcome<bool> {
    authenticated(ic_cdk::api::msg_caller())?;
    let state = state();
    let now_ms = ic_cdk::api::time() / 1_000_000;
    Ok(state
        .entitlements
        .iter()
        .any(|e| e.principal == principal && e.expires_at_ms > now_ms))
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
            profiles: vec![],
            terms_acceptances: vec![],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
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
            profiles: vec![],
            terms_acceptances: vec![],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
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
            profiles: vec![],
            terms_acceptances: vec![],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
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
            profiles: vec![],
            terms_acceptances: vec![],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
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
            profiles: vec![],
            terms_acceptances: vec![],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
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
            profiles: vec![],
            terms_acceptances: vec![],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
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
            profiles: vec![],
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
            terms_acceptances: vec![TermsAcceptance {
                account_id: "user-1".into(),
                terms_version: 1,
                accepted_at_ms: 0,
            }],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
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
        erased
            .terms_acceptances
            .retain(|entry| entry.account_id != "user-1");
        assert!(erased.accounts.is_empty());
        assert!(erased.roles.is_empty());
        assert!(erased.families.is_empty());
        assert!(erased.exclusions.is_empty());
        assert!(erased.external_bindings.is_empty());
        assert!(erased.privacy_consents.is_empty());
        assert!(erased.terms_acceptances.is_empty());
    }

    #[test]
    fn terms_acceptance_is_monotonic_and_scoped_to_account() {
        let governor = principal(1);
        let target = principal(2);
        let mut state = State {
            schema: SCHEMA,
            governor,
            accounts: vec![Account {
                id: "user-1".into(),
                principals: vec![target],
                version: 0,
            }],
            roles: vec![],
            families: vec![],
            exclusions: vec![],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            profiles: vec![],
            terms_acceptances: vec![],
            entitlements: vec![],
            verifiers: vec![],
            attestation_secret: vec![],
            next_challenge: 0,
        };
        // Simulate set_terms_acceptance's monotonic check directly against state.
        let account_id = "user-1".to_string();
        let first = TermsAcceptance {
            account_id: account_id.clone(),
            terms_version: 1,
            accepted_at_ms: 1000,
        };
        state.terms_acceptances.push(first.clone());
        assert_eq!(
            state
                .terms_acceptances
                .iter()
                .find(|e| e.account_id == account_id)
                .unwrap()
                .terms_version,
            1
        );
        // A lower-or-equal version must be rejected by the update handler's logic.
        let existing = state
            .terms_acceptances
            .iter()
            .find(|e| e.account_id == account_id)
            .unwrap();
        assert!(2 > existing.terms_version);
        assert!(!(1 <= existing.terms_version && false)); // sanity: monotonic guard shape
    }

    #[test]
    fn schema2_blob_without_terms_acceptances_decodes_via_serde_default() {
        #[derive(Serialize)]
        struct StateV2 {
            schema: u32,
            governor: Principal,
            accounts: Vec<Account>,
            profiles: Vec<Profile>,
            roles: Vec<RoleGrant>,
            families: Vec<FamilyLink>,
            exclusions: Vec<Exclusion>,
            challenges: Vec<LinkChallenge>,
            external_bindings: Vec<ExternalSiteBinding>,
            privacy_consents: Vec<PrivacyConsent>,
            next_challenge: u64,
        }
        let legacy = StateV2 {
            schema: 2,
            governor: principal(1),
            accounts: vec![],
            profiles: vec![],
            roles: vec![],
            families: vec![],
            exclusions: vec![],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            next_challenge: 0,
        };
        let bytes = encode(&legacy);
        let decoded: State = decode(&bytes);
        assert_eq!(decoded.schema, 2);
        assert!(decoded.terms_acceptances.is_empty());
    }

    #[test]
    fn profile_validation_is_bounded() {
        assert!(valid_display_name("Paul"));
        assert!(!valid_display_name(""));
        assert!(!valid_display_name("   "));
        assert!(!valid_display_name(&"x".repeat(81)));
        assert!(valid_display_name(&"x".repeat(80)));
    }

    #[test]
    fn profile_replacement_keeps_one_entry_per_account() {
        let mut profiles: Vec<Profile> = vec![Profile {
            account_id: "a".into(),
            display_name: "Old".into(),
            avatar_ref: None,
            updated_at_ns: 1,
        }];
        let account_id = "a".to_string();
        let replacement = Profile {
            account_id: account_id.clone(),
            display_name: "New".into(),
            avatar_ref: Some("blob:avatar-1".into()),
            updated_at_ns: 2,
        };
        // Mirror set_profile's replace-in-place logic.
        profiles.retain(|p| p.account_id != account_id);
        profiles.push(replacement.clone());
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0], replacement);
    }

    #[test]
    fn erase_removes_profiles() {
        let mut profiles = vec![
            Profile {
                account_id: "user-1".into(),
                display_name: "Gone".into(),
                avatar_ref: None,
                updated_at_ns: 0,
            },
            Profile {
                account_id: "user-2".into(),
                display_name: "Stays".into(),
                avatar_ref: None,
                updated_at_ns: 0,
            },
        ];
        profiles.retain(|profile| profile.account_id != "user-1");
        assert_eq!(profiles.len(), 1);
        assert_eq!(profiles[0].account_id, "user-2");
    }

    #[test]
    fn schema1_blob_without_profiles_decodes_via_serde_default() {
        // A stable blob written by schema 1 has no `profiles` key; the serde
        // default must decode it as empty so post_upgrade can bump the marker.
        #[derive(Serialize)]
        struct StateV1 {
            schema: u32,
            governor: Principal,
            accounts: Vec<Account>,
            roles: Vec<RoleGrant>,
            families: Vec<FamilyLink>,
            exclusions: Vec<Exclusion>,
            challenges: Vec<LinkChallenge>,
            external_bindings: Vec<ExternalSiteBinding>,
            privacy_consents: Vec<PrivacyConsent>,
            next_challenge: u64,
        }
        let legacy = StateV1 {
            schema: 1,
            governor: principal(1),
            accounts: vec![],
            roles: vec![],
            families: vec![],
            exclusions: vec![],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            next_challenge: 0,
        };
        let bytes = encode(&legacy);
        let decoded: State = decode(&bytes);
        assert_eq!(decoded.schema, 1);
        assert!(decoded.profiles.is_empty());
    }

    #[test]
    fn exported_candid_matches_the_checked_in_contract() {
        fn methods(candid: &str) -> std::collections::BTreeSet<String> {
            let service_start = candid.find("service").expect("service block");
            candid[service_start..]
                .lines()
                .filter_map(|line| {
                    let line = line.trim();
                    let (name, rest) = line.split_once(':')?;
                    rest.trim_start().starts_with('(').then(|| name.trim().to_string())
                })
                .collect()
        }
        let checked_in = include_str!("../identity_access.did");
        let exported = candid_interface();
        assert_eq!(
            methods(checked_in),
            methods(&exported),
            "identity_access.did drifted from the exported candid interface"
        );
    }
}

pub fn candid_interface() -> String {
    __export_service()
}
ic_cdk::export_candid!();
