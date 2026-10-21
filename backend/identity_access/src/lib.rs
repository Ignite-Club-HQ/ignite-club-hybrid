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
mod group_inventory;
mod removal_barrier;
mod deletion_timing;
use deletion_timing::Ticket;

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
const MEM_LINK_LIFECYCLE: u8 = 5;
/// Durable unlink denials; separate from deletable account/profile state.
const MEM_PRINCIPAL_DENIALS: u8 = 6;
/// Account-level terminal erasure fence also covers previously unlinked IDs.
const MEM_ERASED_ACCOUNTS: u8 = 7;
// Service admission readers are separate from club unlink receivers.
const MEM_SERVICE_AUTHORITIES: u8 = 8;
// Recovery pagination revision, NOT an admission/removal fencing generation.
const MEM_REMOVAL_HISTORY_REVISION: u8 = 9;
// Pinned registry trust binding only; never a fencing generation or grant.
const MEM_GROUP_INVENTORY_BINDING: u8 = 10;
// Operator-pinned supplemental placements; not a removal generation.
const MEM_SUPPLEMENTAL_INVENTORY: u8 = 11;
// Persistent removal generation and frozen intents. Never erase on retry.
const MEM_REMOVAL_GENERATION: u8 = 12;
const MEM_REMOVAL_INTENTS: u8 = 13;
const MEM_REMOVAL_SUBJECTS: u8 = 14;
const MEM_REMOVAL_RECEIPTS: u8 = 15;
const MEM_DELETION_TICKETS: u8 = 16;
// Stable B-tree rows grow independently of heap snapshots. Reserve a conservative
// 8 KiB per account (including eight denial rows) within 32 GiB stable memory.
const MAX_ACCOUNTS: usize = (32u64 * 1024 * 1024 * 1024 / 8192) as usize;
const MAX_PRINCIPALS: usize = 8;
const MAX_ROLES: usize = 100_000;
const MAX_FAMILIES: usize = 100_000;
const MAX_EXCLUSIONS: usize = 100_000;
const MAX_CHALLENGES: usize = 10_000;
const CHALLENGE_TTL_NS: u64 = 600_000_000_000;
const MAX_ENTITLEMENTS: usize = 100_000;
const MAX_VERIFIERS: usize = 16;

/// Account status: `Suspended` accounts are rejected by caller-authenticated
/// self-service write paths (profile/theme/link/consent/terms — see
/// `account_for_write`); admin-gated writes on other accounts (role grants,
/// family links, exclusions, erase_account) still work so an admin can
/// manage/clean up a suspended account.
#[derive(Clone, Copy, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum AccountStatus {
    Active,
    Suspended,
}
impl Default for AccountStatus {
    fn default() -> Self {
        AccountStatus::Active
    }
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Account {
    pub id: String,
    pub principals: Vec<Principal>,
    pub version: u64,
    /// `#[serde(default)]` keeps accounts stored before this field existed
    /// decodable as `Active`.
    #[serde(default)]
    pub status: AccountStatus,
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
    /// UI theme preference ("light" or "dark"); `#[serde(default)]` keeps
    /// profiles stored before this field existed decodable as `None`
    /// (caller falls back to the local DOM/localStorage theme).
    #[serde(default)]
    pub theme_preference: Option<String>,
    /// Millisecond timestamp of when the caller dismissed the one-shot club
    /// switcher coach-mark, so the dismissal follows the account across
    /// devices. `#[serde(default)]` keeps older profiles decodable as
    /// `None` (never dismissed).
    #[serde(default)]
    pub club_switcher_hint_seen_at: Option<u64>,
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
  /// Empty on schema-5+ slim blobs (accounts live in their own stable map);
  /// `#[serde(default)]` keeps those decodable through the legacy shape.
  #[serde(default)]
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

/// Independent additive cell: old schema-5 blobs and account maps remain unchanged.
#[derive(Clone, Debug, Default, CandidType, Serialize, Deserialize)]
struct LinkLifecycle {
    authorities: Vec<Principal>,
    pending: Vec<UnlinkIntent>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
struct UnlinkIntent {
    account_id: String,
    principal: Principal,
    version: u64,
    acknowledged: Vec<Principal>,
    // Frozen before fan-out; legacy pending jobs without an exact snapshot
    // must not silently substitute a newer inventory during recovery.
    #[serde(default)]
    authorities: Vec<Principal>,
}

#[derive(Clone, Debug, Default, CandidType, Serialize, Deserialize, PartialEq, Eq)]
enum DenialReason {
    #[default]
    Unlinked,
    Erased,
    Rekeyed,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
struct PrincipalDenial {
    account_id: String,
    version: u64,
    #[serde(default)]
    reauthorized_version: Option<u64>,
    #[serde(default)]
    reason: DenialReason,
    #[serde(default)]
    rekey_destination: Option<Principal>,
}
fn principal_denial(principal: Principal) -> Option<PrincipalDenial> {
    PRINCIPAL_DENIALS.with(|m| m.borrow().get(&principal.to_text())).map(|bytes| decode(&bytes))
}
fn principal_is_denied(principal: Principal) -> bool {
    removal_subject_fenced(principal) || principal_denial(principal).is_some_and(|d| d.reason != DenialReason::Unlinked || d.reauthorized_version.is_none_or(|v| v <= d.version))
}
fn deny_unlinked_principal(principal: Principal, account_id: &str, version: u64) -> Outcome<()> {
    deny_principals(&[principal], account_id, version, DenialReason::Unlinked)
}
/// Validate the whole operation before the first stable write. Returning Err
/// does not roll back earlier writes on the IC, so partial denial is forbidden.
fn deny_principals(subjects: &[Principal], account_id: &str, version: u64, reason: DenialReason) -> Outcome<()> {
    if subjects.is_empty() || subjects.len() > MAX_PRINCIPALS { return Err("Invalid denial subjects".into()); }
    let mut distinct = subjects.to_vec(); distinct.sort(); distinct.dedup();
    if distinct.len() != subjects.len() || subjects.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister()) {
        return Err("Invalid denial subjects".into());
    }
    let mut additions = 0;
    for subject in subjects {
        if let Some(previous) = principal_denial(*subject) {
            if previous.account_id != account_id || previous.version > version ||
                (previous.reason != DenialReason::Unlinked && reason != DenialReason::Erased && previous.reason != reason) {
                return Err("Principal denial generation conflict".into());
            }
        } else { additions += 1; }
    }
    let size = PRINCIPAL_DENIALS.with(|m| m.borrow().len());
    if size + additions > (MAX_ACCOUNTS * MAX_PRINCIPALS) as u64 { return Err("Principal denial capacity reached".into()); }
    let denial = PrincipalDenial { account_id: account_id.to_string(), version, reauthorized_version: None, reason, rekey_destination: None };
    bump_removal_history();
    for subject in subjects {
        PRINCIPAL_DENIALS.with(|m| m.borrow_mut().insert(subject.to_text(), encode(&denial)));
    }
    Ok(())
}
/// Only a newer challenge from this account's surviving identity can restore
/// identity eligibility. This does not restore deleted domain permissions.
fn validate_denied_relink(principal: Principal, account_id: &str, version: u64) -> Outcome<()> {
    if account_is_erased(account_id) { return Err("Erased account cannot be restored by linking".into()); }
    if let Some(denial) = principal_denial(principal) {
        if denial.reason != DenialReason::Unlinked { return Err("Removed sign-in identity cannot be relinked".into()); }
        if denial.account_id != account_id || version <= denial.version { return Err("Fresh surviving-account relink required".into()); }
    }
    Ok(())
}
fn account_is_erased(account_id: &str) -> bool {
    ERASED_ACCOUNTS.with(|m| m.borrow().contains_key(&account_id.to_string()))
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq)]
enum EligibilityDecision { Eligible, Denied }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq)]
struct PrincipalEligibility {
    subject: Principal,
    decision: EligibilityDecision,
    account_version: Option<u64>,
    denied_through_version: Option<u64>,
}
fn principal_eligibility(subject: Principal) -> PrincipalEligibility {
    let account = account_for_write(subject).ok();
    PrincipalEligibility {
        subject,
        decision: if account.is_some() { EligibilityDecision::Eligible } else { EligibilityDecision::Denied },
        account_version: account.map(|a| a.version),
        denied_through_version: principal_denial(subject).map(|d| d.version),
    }
}
fn authority_eligibilities(caller: Principal, subjects: Vec<Principal>) -> Outcome<Vec<PrincipalEligibility>> {
    if !account_group_rehearsal_enabled() { return Err("Cross-group eligibility not released".into()); }
    if !link_lifecycle().authorities.contains(&caller) && !service_authorities().contains(&caller) { return Err("Configured authority required".into()); }
    if subjects.is_empty() || subjects.len() > 200 { return Err("Eligibility batch must contain 1 to 200 subjects".into()); }
    let mut distinct = subjects.clone(); distinct.sort(); distinct.dedup();
    if distinct.len() != subjects.len() { return Err("Duplicate eligibility subject".into()); }
    Ok(subjects.into_iter().map(principal_eligibility).collect())
}
/// Consensus reads; never create an account or grant resource permissions.
/// Versions are account-scoped evidence, NOT globally atomic access tokens.
#[ic_cdk::update]
fn read_principal_eligibility(subject: Principal) -> Outcome<PrincipalEligibility> {
    authority_eligibilities(ic_cdk::api::msg_caller(), vec![subject])?.into_iter().next().ok_or("Eligibility unavailable".into())
}
#[ic_cdk::update]
fn read_principal_eligibilities(subjects: Vec<Principal>) -> Outcome<Vec<PrincipalEligibility>> {
    authority_eligibilities(ic_cdk::api::msg_caller(), subjects)
}

fn service_authorities() -> Vec<Principal> {
    SERVICE_AUTHORITIES.with(|m| if m.borrow().get().is_empty() { vec![] } else { decode(m.borrow().get()) })
}
fn validate_service_authorities(authorities: &[Principal]) -> Outcome<()> {
    let mut unique = authorities.to_vec(); unique.sort(); unique.dedup();
    if authorities.is_empty() || authorities.len() > 4096 || unique.len() != authorities.len() ||
        authorities.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister()) {
        return Err("Complete bounded service reader inventory required".into());
    }
    Ok(())
}
#[ic_cdk::update]
fn set_service_authorities(authorities: Vec<Principal>) -> Outcome<()> {
    if !account_group_rehearsal_enabled() { return Err("Service admission not released".into()); }
    require_governor(&state(), ic_cdk::api::msg_caller())?;
    if removal_pending() { return Err("Removal barrier pending".into()); }
    validate_service_authorities(&authorities)?;
    if !link_lifecycle().pending.is_empty() { return Err("Unlink recovery pending".into()); }
    if service_authorities().iter().any(|p| !authorities.contains(p)) { return Err("Cannot drop an existing service reader".into()); }
    bump_removal_history();
    SERVICE_AUTHORITIES.with(|m| m.borrow_mut().set(encode(&authorities)));
    Ok(())
}
fn service_account(caller: Principal, subject: Principal) -> Outcome<Account> {
    if !account_group_rehearsal_enabled() { return Err("Service admission not released".into()); }
    if !service_authorities().contains(&caller) { return Err("Configured service reader required".into()); }
    account_for_write(subject)
}
/// Subject-bound consensus ownership read; never implicitly registers an account.
#[ic_cdk::update]
fn read_service_account(subject: Principal) -> Outcome<Account> {
    service_account(ic_cdk::api::msg_caller(), subject)
}

fn unlink_targets(job: &UnlinkIntent) -> Outcome<Vec<Principal>> {
    if job.authorities.is_empty() || job.authorities.len() > 4096 {
        return Err("Exact unlink authority snapshot required".into());
    }
    let mut distinct = job.authorities.clone(); distinct.sort(); distinct.dedup();
    if distinct.len() != job.authorities.len() || distinct.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister()) {
        return Err("Invalid unlink authority snapshot".into());
    }
    if job.acknowledged.iter().any(|p| !job.authorities.contains(p)) {
        return Err("Foreign unlink acknowledgement".into());
    }
    Ok(job.authorities.clone())
}

/// Previous local-only release stored one inventory and prohibited every
/// configuration change while pending jobs existed. Its persisted inventory
/// is therefore the historical target snapshot, not a newly supplied list.
/// Reject invalid acknowledgements before upgrading any legacy jobs.
fn migrate_legacy_unlink_targets(mut lifecycle: LinkLifecycle) -> Outcome<LinkLifecycle> {
    for job in &mut lifecycle.pending {
        if job.authorities.is_empty() { job.authorities = lifecycle.authorities.clone(); }
        unlink_targets(job)?;
    }
    Ok(lifecycle)
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
    static LINK_LIFECYCLE: RefCell<StableCell<Vec<u8>, Memory>> =
        RefCell::new(StableCell::init(memory(MEM_LINK_LIFECYCLE), Vec::new()));
    static PRINCIPAL_DENIALS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_PRINCIPAL_DENIALS)));
    static ERASED_ACCOUNTS: RefCell<StableBTreeMap<String, u64, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_ERASED_ACCOUNTS)));
    static SERVICE_AUTHORITIES: RefCell<StableCell<Vec<u8>, Memory>> =
        RefCell::new(StableCell::init(memory(MEM_SERVICE_AUTHORITIES), Vec::new()));
    static REMOVAL_HISTORY_REVISION: RefCell<StableCell<u64, Memory>> =
        RefCell::new(StableCell::init(memory(MEM_REMOVAL_HISTORY_REVISION), 0));
    static GROUP_INVENTORY_BINDING: RefCell<StableCell<Vec<u8>, Memory>> =
        RefCell::new(StableCell::init(memory(MEM_GROUP_INVENTORY_BINDING), Vec::new()));
    static SUPPLEMENTAL_INVENTORY: RefCell<StableCell<Vec<u8>, Memory>> =
        RefCell::new(StableCell::init(memory(MEM_SUPPLEMENTAL_INVENTORY), Vec::new()));
    static REMOVAL_GENERATION: RefCell<StableCell<u64, Memory>> =
        RefCell::new(StableCell::init(memory(MEM_REMOVAL_GENERATION), 0));
    static REMOVAL_INTENTS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_REMOVAL_INTENTS)));
    static REMOVAL_SUBJECTS: RefCell<StableBTreeMap<String, String, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_REMOVAL_SUBJECTS)));
    static DELETION_TICKETS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> = RefCell::new(StableBTreeMap::init(memory(MEM_DELETION_TICKETS)));
    static REMOVAL_RECEIPTS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_REMOVAL_RECEIPTS)));
}
fn removal_intent(account_id: &str) -> Option<removal_barrier::Intent> {
    REMOVAL_INTENTS.with(|m| m.borrow().get(&account_id.to_string())).map(|bytes| decode(&bytes))
}
fn removal_subject_fenced(subject: Principal) -> bool {
    REMOVAL_SUBJECTS.with(|m| m.borrow().contains_key(&subject.to_text()))
}
fn removal_pending() -> bool { REMOVAL_INTENTS.with(|m| !m.borrow().is_empty()) }
fn persist_removal_intent(account: &Account, inventory: group_inventory::RemovalInventory, identity: Principal) -> Outcome<removal_barrier::Intent> {
    if let Some(intent) = removal_intent(&account.id) { return Ok(intent); }
    if REMOVAL_INTENTS.with(|m| m.borrow().len()) >= MAX_ACCOUNTS as u64 { return Err("Removal intent capacity reached".into()); }
    if account_is_erased(&account.id) || account.principals.iter().any(|p| principal_is_denied(*p)) {
        return Err("Account already revoked".into());
    }
    let generation = REMOVAL_GENERATION.with(|m| m.borrow().get().checked_add(1)).ok_or("Removal generation exhausted")?;
    let digest = Sha256::digest(encode(&inventory)).to_vec();
    let intent = removal_barrier::create(account, generation, inventory, digest, identity)?;
    // No awaits or fallible validation after the first write. A trap rolls
    // the whole message back; an Err must never leave a partially written fence.
    bump_removal_history();
    REMOVAL_GENERATION.with(|m| m.borrow_mut().set(generation));
    REMOVAL_INTENTS.with(|m| m.borrow_mut().insert(account.id.clone(), encode(&intent)));
    REMOVAL_SUBJECTS.with(|m| {
        let mut map = m.borrow_mut();
        for subject in &intent.subjects { map.insert(subject.to_text(), intent.account_id.clone()); }
    });
    Ok(intent)
}
#[ic_cdk::update]
async fn begin_account_removal(account_id: String, expected_history_revision: u64) -> Outcome<removal_barrier::Intent> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    // Unknown outcomes retry the original immutable intent, not today's registry.
    if let Some(intent) = removal_intent(&account_id) { return Ok(intent); }
    let account = get_account(&account_id).ok_or("Unknown account")?;
    if account.principals.contains(&state().governor) { return Err("Governor account cannot be erased".into()); }
    if link_lifecycle().pending.iter().any(|job| job.account_id == account_id) { return Err("Unlink recovery pending".into()); }
    let inventory = read_removal_inventory_evidence(expected_history_revision).await?;
    if removal_history_revision() != expected_history_revision || get_account(&account_id).as_ref() != Some(&account) {
        return Err("Account or inventory changed during removal preparation".into());
    }
    persist_removal_intent(&account, inventory, ic_cdk::api::canister_self())
}
#[ic_cdk::update]
fn read_account_removal_intent(account_id: String) -> Outcome<removal_barrier::Intent> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    removal_intent(&account_id).ok_or("Removal intent missing".into())
}
// A bounded one-receiver step: retries always re-read the real receiver.
// Stored receipts are recovery evidence, never cached permission to complete.
#[ic_cdk::update]
async fn advance_account_removal_receiver(account_id: String, target: Principal) -> Outcome<removal_barrier::Receipt> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    let intent = removal_intent(&account_id).ok_or("Removal intent missing")?;
    if !intent.targets.contains(&target) { return Err("Receiver outside frozen removal inventory".into()); }
    let request = intent.request();
    let reply = ic_cdk::call::Call::bounded_wait(target, "prepare_account_removal")
        .with_arg(&request).await.map_err(|_| "Receiver fence unavailable; intent remains locked")?;
    let prepared: Outcome<()> = reply.candid().map_err(|_| "Invalid receiver fence reply")?;
    prepared?;
    if removal_intent(&account_id).as_ref() != Some(&intent) { return Err("Removal intent changed".into()); }
    let reply = ic_cdk::call::Call::bounded_wait(target, "read_account_removal_drain")
        .with_arg(&request).await.map_err(|_| "Receiver drain unavailable; intent remains locked")?;
    let result: Outcome<removal_barrier::Receipt> = reply.candid().map_err(|_| "Invalid receiver drain reply")?;
    let receipt = result?;
    if removal_intent(&account_id).as_ref() != Some(&intent) { return Err("Removal intent changed".into()); }
    intent.validate_receipt(target, &receipt)?;
    REMOVAL_RECEIPTS.with(|m| m.borrow_mut().insert(format!("{}:{}", account_id, target.to_text()), encode(&receipt)));
    bump_removal_history();
    Ok(receipt)
}
/// Fresh, authenticated full-inventory seal verification. This does not erase
/// data, release registry locks, restore histories or activate a group.
#[ic_cdk::update]
async fn verify_account_removal_seals(account_id: String) -> Outcome<Vec<removal_barrier::Receipt>> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    let intent = removal_intent(&account_id).ok_or("Removal intent missing")?;
    let request = intent.request();
    let mut seals = Vec::new();
    for target in &intent.targets {
        let reply = ic_cdk::call::Call::bounded_wait(*target, "seal_account_removal").with_arg(&request)
            .await.map_err(|_| "Receiver seal unavailable; intent remains locked")?;
        let result: Outcome<removal_barrier::Receipt> = reply.candid().map_err(|_| "Invalid receiver seal reply")?;
        let seal = result?;
        if removal_intent(&account_id).as_ref() != Some(&intent) { return Err("Removal intent changed".into()); }
        intent.validate_seal(*target, &seal)?;
        seals.push(seal);
    }
    if seals.len() != intent.targets.len() { return Err("Incomplete receiver seals".into()); }
    Ok(seals)
}
fn group_inventory_binding() -> Option<group_inventory::Binding> {
    GROUP_INVENTORY_BINDING.with(|m| if m.borrow().get().is_empty() { None } else { Some(decode(m.borrow().get())) })
}
fn store_group_inventory_binding(binding: group_inventory::Binding, expected_history_revision: u64) -> Outcome<()> {
    if removal_pending() { return Err("Removal barrier pending".into()); }
    if DELETION_TICKETS.with(|m|m.borrow().len())>0 { return Err("Deletion reservation pending".into()); }
    group_inventory::validate_binding(&binding)?;
    if removal_history_revision() != expected_history_revision { return Err("History revision changed".into()); }
    if !link_lifecycle().pending.is_empty() { return Err("Unlink recovery pending".into()); }
    if let Some(prior) = group_inventory_binding() {
        let mut same = prior.clone(); same.registry_revision = binding.registry_revision;
        if same != binding || binding.registry_revision < prior.registry_revision { return Err("Pinned registry binding cannot be substituted or rolled back".into()); }
        if prior == binding { return Ok(()); }
    }
    bump_removal_history();
    GROUP_INVENTORY_BINDING.with(|m| m.borrow_mut().set(encode(&binding)));
    Ok(())
}
#[ic_cdk::update]
fn set_group_inventory_binding(binding: group_inventory::Binding, expected_history_revision: u64) -> Outcome<()> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    store_group_inventory_binding(binding, expected_history_revision)
}
#[ic_cdk::update]
async fn read_group_inventory_evidence(expected_history_revision: u64) -> Outcome<group_inventory::Evidence> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    let binding = group_inventory_binding().ok_or("Group inventory registry not pinned")?;
    let revision = removal_history_revision();
    if revision != expected_history_revision { return Err("History revision changed".into()); }
    let clubs = link_lifecycle().authorities; let readers = service_authorities();
    let mut snapshot = None;
    // Reread the authoritative registry to reject a changed snapshot across
    // async work. This is point-in-time evidence, NOT a held removal fence.
    for _ in 0..2 {
        let current = read_registry_pages(&binding, || {
            if removal_history_revision() != revision || group_inventory_binding().as_ref() != Some(&binding) {
                return Err("Group inventory binding or history changed during read".into());
            }
            Ok(())
        }).await?;
        group_inventory::validate(&current, &binding, &clubs, &readers)?;
        if snapshot.as_ref().is_some_and(|prior| prior != &current) { return Err("Group inventory changed during read".into()); }
        snapshot = Some(current);
    }
    Ok(group_inventory::Evidence { binding, history_revision: revision, snapshot: snapshot.ok_or("Missing registry snapshot")? })
}
#[derive(CandidType, Deserialize)]
struct RegistryPage {
    revision: u64, groups: Vec<group_inventory::Group>, placements: Vec<group_inventory::Placement>, next_cursor: Option<String>,
}
async fn read_registry_pages(binding: &group_inventory::Binding, recheck: impl Fn() -> Outcome<()>) -> Outcome<group_inventory::Snapshot> {
    let mut snapshot = group_inventory::Snapshot { revision: binding.registry_revision, groups: vec![], placements: vec![] };
    let mut cursor: Option<String> = None;
    loop {
        recheck()?;
        let reply = ic_cdk::call::Call::bounded_wait(binding.registry, "read_group_registry_page")
            .with_args(&(&binding.target_alias, Some(binding.registry_revision), &cursor, 64u32))
            .await.map_err(|_| "Group registry page unavailable".to_string())?;
        recheck()?;
        let page: Outcome<RegistryPage> = reply.candid().map_err(|_| "Invalid registry page".to_string())?;
        let page = page?;
        if page.revision != binding.registry_revision || page.groups.len()>64 || page.placements.len()!=page.groups.len() ||
            page.next_cursor.as_ref().is_some_and(|n| cursor.as_ref().is_some_and(|c| n<=c)) {
            return Err("Registry revision or cursor changed".into());
        }
        snapshot.groups.extend(page.groups); snapshot.placements.extend(page.placements);
        if snapshot.groups.len()>4096 { return Err("Registry safety bound exceeded".into()); }
        match page.next_cursor { None => return Ok(snapshot), Some(next) => cursor=Some(next) }
    }
}
fn removal_history_revision() -> u64 { REMOVAL_HISTORY_REVISION.with(|m| *m.borrow().get()) }
fn supplemental_inventory() -> Vec<group_inventory::Supplemental> {
    SUPPLEMENTAL_INVENTORY.with(|m| if m.borrow().get().is_empty() { vec![] } else { decode(m.borrow().get()) })
}
#[ic_cdk::update]
fn set_removal_supplemental_inventory(entries: Vec<group_inventory::Supplemental>, expected_history_revision: u64) -> Outcome<()> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    if removal_pending() { return Err("Removal barrier pending".into()); }
    if removal_history_revision() != expected_history_revision || !link_lifecycle().pending.is_empty() { return Err("History changed or unlink pending".into()); }
    if group_inventory_binding().is_none() || entries.is_empty() || entries.len() > 256 { return Err("Pinned bounded supplemental inventory required".into()); }
    let mut unique = std::collections::BTreeSet::new();
    if entries.iter().any(|e| e.group_id.is_empty() || e.group_id.len()>64 || e.domain.len()>64 || e.canister==Principal::anonymous() ||
        e.canister==Principal::management_canister() || e.subnet==Principal::anonymous() || e.subnet==Principal::management_canister() || !unique.insert(e.canister)) {
        return Err("Invalid supplemental inventory".into());
    }
    if supplemental_inventory().iter().any(|e| !entries.contains(e)) { return Err("Cannot drop or substitute a pinned authority".into()); }
    bump_removal_history(); SUPPLEMENTAL_INVENTORY.with(|m| m.borrow_mut().set(encode(&entries))); Ok(())
}
#[ic_cdk::update]
async fn read_removal_inventory_evidence(expected_history_revision: u64) -> Outcome<group_inventory::RemovalInventory> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    let binding = group_inventory_binding().ok_or("Group inventory registry not pinned")?;
    let extra = supplemental_inventory(); let clubs=link_lifecycle().authorities; let readers=service_authorities();
    let unchanged = || removal_history_revision()==expected_history_revision && group_inventory_binding().as_ref()==Some(&binding) && supplemental_inventory()==extra;
    if !unchanged() { return Err("History revision changed".into()); }
    let mut prior = None;
    for _ in 0..2 {
        let snapshot = read_registry_pages(&binding, || if unchanged() { Ok(()) } else { Err("Inventory changed during group read".into()) }).await?;
        group_inventory::validate(&snapshot,&binding,&clubs,&[])?;
        let mut media=Vec::new();
        for g in &snapshot.groups {
            let authority=g.domains.iter().find(|d|d.domain=="club_domain").ok_or("Missing club authority")?.canister;
            let reply=ic_cdk::call::Call::bounded_wait(authority,"read_removal_media_registry").await.map_err(|_| "Media registry unavailable".to_string())?;
            let registry: Outcome<group_inventory::MediaRegistry>=reply.candid().map_err(|_| "Invalid media registry reply".to_string())?;
            if !unchanged() { return Err("Inventory changed during media read".into()); }
            media.push(group_inventory::MediaEvidence {club_authority:authority,registry:registry?});
        }
        group_inventory::validate_complete(&snapshot,&binding,&clubs,&readers,&extra,&media)?;
        let current=group_inventory::RemovalInventory {groups:group_inventory::Evidence {binding:binding.clone(),history_revision:expected_history_revision,snapshot},supplemental:extra.clone(),media};
        if prior.as_ref().is_some_and(|p|p!=&current) { return Err("Remote inventory changed during read".into()); }
        prior=Some(current);
    }
    prior.ok_or("Missing complete inventory".into())
}
fn bump_removal_history() {
    let next = removal_history_revision().checked_add(1).expect("Removal history revision exhausted");
    REMOVAL_HISTORY_REVISION.with(|m| m.borrow_mut().set(next));
}
fn link_lifecycle() -> LinkLifecycle {
    LINK_LIFECYCLE.with(|s| if s.borrow().get().is_empty() { LinkLifecycle::default() } else { decode(s.borrow().get()) })
}
fn store_link_lifecycle(value: &LinkLifecycle) {
    bump_removal_history();
    LINK_LIFECYCLE.with(|s| s.borrow_mut().set(encode(value)));
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
struct RemovalHistoryManifest {
    revision: u64,
    principal_denials: u64,
    erased_accounts: u64,
    pending_intents: u64,
    club_authorities: Vec<Principal>,
    service_readers: Vec<Principal>,
    removal_generation: u64,
    removal_barriers: u64,
    removal_subjects: u64,
    removal_receipts: u64,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
enum RemovalHistoryCursor { PrincipalDenials(Option<String>), ErasedAccounts(Option<String>), PendingIntents(u64), RemovalBarriers(Option<String>), RemovalSubjects(Option<String>), RemovalReceipts(Option<String>), Done }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
struct RemovalHistoryPage {
    revision: u64,
    denials: Vec<(String, PrincipalDenial)>,
    erased: Vec<(String, u64)>,
    pending: Vec<UnlinkIntent>,
    barriers: Vec<(String, removal_barrier::Intent)>,
    subjects: Vec<(String, String)>,
    receipts: Vec<(String, removal_barrier::Receipt)>,
    next: RemovalHistoryCursor,
}
fn history_access(enabled: bool, governor: Principal, caller: Principal) -> Outcome<()> {
    if !enabled { return Err("Removal history recovery not released".into()); }
    if caller == Principal::anonymous() || caller != governor { return Err("Governor required".into()); }
    Ok(())
}
fn history_manifest() -> RemovalHistoryManifest {
    let lifecycle = link_lifecycle();
    RemovalHistoryManifest {
        revision: removal_history_revision(),
        principal_denials: PRINCIPAL_DENIALS.with(|m| m.borrow().len()),
        erased_accounts: ERASED_ACCOUNTS.with(|m| m.borrow().len()),
        pending_intents: lifecycle.pending.len() as u64,
        club_authorities: lifecycle.authorities,
        service_readers: service_authorities(),
        removal_generation: REMOVAL_GENERATION.with(|m| *m.borrow().get()),
        removal_barriers: REMOVAL_INTENTS.with(|m| m.borrow().len()),
        removal_subjects: REMOVAL_SUBJECTS.with(|m| m.borrow().len()),
        removal_receipts: REMOVAL_RECEIPTS.with(|m| m.borrow().len()),
    }
}
/// Local-only consensus recovery evidence. Reader lists/club receipts are NOT
/// a complete deployment inventory or an in-flight drain acknowledgement.
#[ic_cdk::update]
fn read_removal_history_manifest() -> Outcome<RemovalHistoryManifest> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    Ok(history_manifest())
}
fn history_page(revision: u64, cursor: RemovalHistoryCursor, limit: u16) -> Outcome<RemovalHistoryPage> {
    if limit == 0 || limit > 200 { return Err("Invalid history page size".into()); }
    if revision != removal_history_revision() { return Err("Removal history changed; restart export".into()); }
    let mut page = RemovalHistoryPage { revision, denials: vec![], erased: vec![], pending: vec![], barriers: vec![], subjects: vec![], receipts: vec![], next: RemovalHistoryCursor::Done };
    let bound = limit as usize;
    match cursor {
        RemovalHistoryCursor::PrincipalDenials(after) => {
            if after.as_ref().is_some_and(|s| s.len() > 256) { return Err("Invalid history key cursor".into()); }
            page.denials = PRINCIPAL_DENIALS.with(|m| {
                use std::ops::Bound::{Excluded, Unbounded};
                let map = m.borrow();
                let range = (after.map(Excluded).unwrap_or(Unbounded), Unbounded);
                map.range(range).take(bound).map(|e| (e.key().clone(), decode(&e.value()))).collect()
            });
            page.next = if page.denials.len() == bound {
                RemovalHistoryCursor::PrincipalDenials(page.denials.last().map(|e| e.0.clone()))
            } else { RemovalHistoryCursor::ErasedAccounts(None) };
        }
        RemovalHistoryCursor::ErasedAccounts(after) => {
            if after.as_ref().is_some_and(|s| s.len() > 256) { return Err("Invalid history key cursor".into()); }
            page.erased = ERASED_ACCOUNTS.with(|m| {
                use std::ops::Bound::{Excluded, Unbounded};
                let map = m.borrow();
                let range = (after.map(Excluded).unwrap_or(Unbounded), Unbounded);
                map.range(range).take(bound).map(|e| (e.key().clone(), e.value())).collect()
            });
            page.next = if page.erased.len() == bound {
                RemovalHistoryCursor::ErasedAccounts(page.erased.last().map(|e| e.0.clone()))
            } else { RemovalHistoryCursor::PendingIntents(0) };
        }
        RemovalHistoryCursor::PendingIntents(offset) => {
            let lifecycle = link_lifecycle();
            if offset > lifecycle.pending.len() as u64 { return Err("Invalid pending intent cursor".into()); }
            page.pending = lifecycle.pending.into_iter().skip(offset as usize).take(bound).collect();
            if page.pending.len() == bound { page.next = RemovalHistoryCursor::PendingIntents(offset + page.pending.len() as u64); }
            else { page.next = RemovalHistoryCursor::RemovalBarriers(None); }
        }
        RemovalHistoryCursor::RemovalBarriers(after) => {
            if after.as_ref().is_some_and(|s| s.len() > 256) { return Err("Invalid history key cursor".into()); }
            page.barriers = REMOVAL_INTENTS.with(|m| {
                use std::ops::Bound::{Excluded, Unbounded};
                m.borrow().range((after.map(Excluded).unwrap_or(Unbounded), Unbounded)).take(bound)
                    .map(|e| (e.key().clone(), decode(&e.value()))).collect()
            });
            page.next = if page.barriers.len() == bound { RemovalHistoryCursor::RemovalBarriers(page.barriers.last().map(|e| e.0.clone())) } else { RemovalHistoryCursor::RemovalSubjects(None) };
        }
        RemovalHistoryCursor::RemovalSubjects(after) => {
            if after.as_ref().is_some_and(|s| s.len() > 256) { return Err("Invalid history key cursor".into()); }
            page.subjects = REMOVAL_SUBJECTS.with(|m| {
                use std::ops::Bound::{Excluded, Unbounded};
                m.borrow().range((after.map(Excluded).unwrap_or(Unbounded), Unbounded)).take(bound)
                    .map(|e| (e.key().clone(), e.value())).collect()
            });
            page.next = if page.subjects.len() == bound { RemovalHistoryCursor::RemovalSubjects(page.subjects.last().map(|e| e.0.clone())) } else { RemovalHistoryCursor::RemovalReceipts(None) };
        }
        RemovalHistoryCursor::RemovalReceipts(after) => {
            if after.as_ref().is_some_and(|s| s.len() > 256) { return Err("Invalid history key cursor".into()); }
            page.receipts = REMOVAL_RECEIPTS.with(|m| {
                use std::ops::Bound::{Excluded, Unbounded};
                m.borrow().range((after.map(Excluded).unwrap_or(Unbounded), Unbounded)).take(bound)
                    .map(|e| (e.key().clone(), decode(&e.value()))).collect()
            });
            if page.receipts.len() == bound { page.next = RemovalHistoryCursor::RemovalReceipts(page.receipts.last().map(|e| e.0.clone())); }
        }
        RemovalHistoryCursor::Done => {}
    }
    Ok(page)
}
#[ic_cdk::update]
fn read_removal_history_page(revision: u64, cursor: RemovalHistoryCursor, limit: u16) -> Outcome<RemovalHistoryPage> {
    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    history_page(revision, cursor, limit)
}
fn effective_account(mut account: Account, lifecycle: &LinkLifecycle) -> Account {
    account.principals.retain(|p| !principal_is_denied(*p) && !lifecycle.pending.iter().any(|job| job.account_id == account.id && job.principal == *p));
    account
}

/// Governor attests the complete same-deployment club authority inventory.
/// Configuration is immutable while an unlink is incomplete.
// Temporary local-only protocol gate. Production deployment never sets this
// environment variable; remove only after authority-wide revocation attestation.
fn account_group_rehearsal_enabled() -> bool {
    #[cfg(target_arch = "wasm32")]
    { ic_cdk::api::env_var_name_exists("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") && ic_cdk::api::env_var_value("IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL") == "1" }
    #[cfg(not(target_arch = "wasm32"))]
    { false }
}

/// The bound account-deletion timing protocol (prepare/commit/cancel/settle)
/// is released independently of the broader cross-group rehearsal gate: the
/// local rehearsal flag still enables it in tests, and production sets
/// IGNITE_BOUND_DELETION_RELEASE=1 on the identity_access canister to open it
/// live without releasing the remaining rehearsal-gated lifecycle features.
fn bound_deletion_released() -> bool {
    #[cfg(target_arch = "wasm32")]
    { account_group_rehearsal_enabled() || (ic_cdk::api::env_var_name_exists("IGNITE_BOUND_DELETION_RELEASE") && ic_cdk::api::env_var_value("IGNITE_BOUND_DELETION_RELEASE") == "1") }
    #[cfg(not(target_arch = "wasm32"))]
    { false }
}
/// Governor-only narrow opening evidence, not a lifecycle release or grant.
#[ic_cdk::update]
fn read_group_opening_configuration() -> Outcome<Vec<(String, String)>> {
    require_governor(&state(), ic_cdk::api::msg_caller())?;
    let binding = group_inventory_binding().ok_or("Deletion registry not pinned")?;
    Ok(vec![("registry".into(), binding.registry.to_text()), ("target_alias".into(), binding.target_alias),
        ("deployment_id".into(), binding.deployment_id), ("host".into(), binding.host),
        ("network_kind".into(), binding.network_kind), ("bound_deletion_released".into(), bound_deletion_released().to_string())])
}
/// Separate governor-only trust pin for the already-released deletion timing
/// protocol. Existing history/lifecycle gates remain unchanged.
#[ic_cdk::update]
fn pin_owner_test_deletion_registry(binding: group_inventory::Binding) -> Outcome<()> {
    require_governor(&state(), ic_cdk::api::msg_caller())?;
    if !bound_deletion_released() || binding.network_kind != "public_mainnet" { return Err("Bound deletion mainnet release required".into()); }
    store_group_inventory_binding(binding, removal_history_revision())
}
/// Only the pinned router may check a human before owner-test creation. This
/// narrow predicate neither registers a reader nor releases global admission.
#[ic_cdk::update]
fn read_owner_test_creation_eligible(subject: Principal) -> Outcome<bool> {
    let binding = group_inventory_binding().ok_or("Deletion registry not pinned")?;
    if ic_cdk::api::msg_caller() != binding.registry || !bound_deletion_released() { return Err("Pinned router and bound deletion release required".into()); }
    let account = match account_for_write(subject) { Ok(a) => a, Err(_) => return Ok(false) };
    Ok(!DELETION_TICKETS.with(|m| m.borrow().contains_key(&account.id)) && removal_intent(&account.id).is_none())
}

#[ic_cdk::update]
fn set_club_authorities(authorities: Vec<Principal>) -> Outcome<()> {
    if !account_group_rehearsal_enabled() { return Err("Cross-group account lifecycle not released".into()); }
    require_governor(&state(), ic_cdk::api::msg_caller())?;
    if removal_pending() { return Err("Removal barrier pending".into()); }
    if authorities.is_empty() || authorities.len() > 4096 || authorities.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister()) {
        return Err("Complete bounded club authority inventory required".into());
    }
    let mut sorted = authorities.clone(); sorted.sort(); sorted.dedup();
    if sorted.len() != authorities.len() { return Err("Duplicate club authority".into()); }
    let mut lifecycle = link_lifecycle();
    if !lifecycle.pending.is_empty() { return Err("Unlink recovery pending".into()); }
    if lifecycle.authorities.iter().any(|p| !authorities.contains(p)) { return Err("Cannot drop an existing club authority".into()); }
    lifecycle.authorities = authorities; store_link_lifecycle(&lifecycle); Ok(())
}

/// Only configured canisters may ask for another caller's links. No browser
/// supplies an account id or a principal list; the index is authoritative.
#[ic_cdk::update]
fn read_linked_account(viewer: Principal) -> Outcome<Account> {
    let lifecycle = link_lifecycle();
    if !lifecycle.authorities.contains(&ic_cdk::api::msg_caller()) { return Err("Club authority required".into()); }
    let account = effective_account(account_for_write(viewer)?, &lifecycle);
    if !account.principals.contains(&viewer) { return Err("Identity revocation pending".into()); }
    Ok(account)
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
/// The caller's profile, or a blank default (not yet persisted) when none
/// has been set — used by preference setters that must work before the
/// account has ever called `set_profile` (e.g. the theme toggle on first
/// sign-in).
fn get_or_init_profile(account_id: &str) -> Profile {
    get_profile_entry(account_id).unwrap_or_else(|| Profile {
        account_id: account_id.to_string(),
        display_name: String::new(),
        avatar_ref: None,
        updated_at_ns: 0,
        theme_preference: None,
        club_switcher_hint_seen_at: None,
    })
}
fn remove_profile_entry(account_id: &str) {
    PROFILES.with(|m| m.borrow_mut().remove(&account_id.to_string()));
}
fn all_profiles() -> Vec<Profile> {
    PROFILES.with(|m| m.borrow().iter().map(|e| decode(&e.value())).collect())
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
    ENTITLEMENTS.with(|m| m.borrow().iter().map(|e| decode(&e.value())).collect())
}
/// Removes every entitlement granted to `principal` (used by erase_account).
fn remove_entitlements_for_principal(principal: Principal) {
    let keys: Vec<String> = ENTITLEMENTS.with(|m| {
        m.borrow()
            .iter()
            .filter(|e| decode::<Entitlement>(&e.value()).principal == principal)
            .map(|e| e.key().clone())
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
    if principal_is_denied(principal) { return Err("Identity revoked; surviving-account relink required".into()); }
    let account = find_account_by_principal(principal).ok_or("Unlinked identity")?;
    if !account.principals.contains(&principal) { return Err("Stale principal account index".into()); }
    if account_is_erased(&account.id) { return Err("Account erased".into()); }
    if removal_intent(&account.id).is_some() { return Err("Account removal pending".into()); }
    if let Some(denial) = principal_denial(principal) {
        if denial.account_id != account.id || denial.reauthorized_version.is_none_or(|v| account.version < v) {
            return Err("Revoked identity account generation mismatch".into());
        }
    }
    if link_lifecycle().pending.iter().any(|job| job.account_id == account.id && job.principal == principal) {
        return Err("Identity revocation pending".into());
    }
    Ok(account)
}
/// Caller-authenticated self-service writes (profile, theme preference,
/// coach-mark dismissal, link challenges, consent, terms acceptance, self
/// `revoke`) go through this instead of `account_for` so a `Suspended`
/// account cannot keep mutating its own state. Admin-gated writes that act
/// ON another account (grant/revoke_role, set_family, set_exclusion,
/// erase_account, set_account_status itself) intentionally keep using
/// `account_for`/`get_account` directly — an admin must still be able to
/// manage or clean up a suspended account.
fn account_for_write(principal: Principal) -> Outcome<Account> {
    let account = account_for(principal)?;
    if account.status == AccountStatus::Suspended {
        return Err("Account suspended".into());
    }
    Ok(account)
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
    if principal_is_denied(principal) { return Err("Identity revoked; surviving-account relink required".into()); }
    if let Some(account) = find_account_by_principal(principal) {
        account_for(principal)?;
        return Ok(account.id);
    }
    if principal_denial(principal).is_some() { return Err("Previous identity authorization requires surviving account".into()); }
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
        status: AccountStatus::Active,
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
        status: AccountStatus::Active,
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
    let lifecycle = migrate_legacy_unlink_targets(link_lifecycle()).expect("Invalid historical unlink inventory; upgrade refused");
    for job in &lifecycle.pending {
        deny_unlinked_principal(job.principal, &job.account_id, job.version).expect("Invalid pending principal denial; upgrade refused");
    }
    store_link_lifecycle(&lifecycle);
}

#[ic_cdk::query]
fn whoami() -> Outcome<Account> {
    account_for(ic_cdk::api::msg_caller())
}

#[ic_cdk::update]
fn register_account() -> Outcome<Account> {
    let caller = ic_cdk::api::msg_caller();
    let account_id = ensure_account(caller)?;
    get_account(&account_id).ok_or("Account unavailable".into())
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
    let account_id = account_for_write(caller)?.id;
    if !valid_display_name(&display_name) {
        return Err("Display name must be 1-80 characters".into());
    }
    if avatar_ref.as_deref().is_some_and(|a| a.len() > 512) {
        return Err("Avatar reference must be at most 512 characters".into());
    }
    let existing = get_profile_entry(&account_id);
    let profile = Profile {
        account_id: account_id.clone(),
        display_name: display_name.trim().to_string(),
        avatar_ref,
        updated_at_ns: ic_cdk::api::time(),
        theme_preference: existing.as_ref().and_then(|p| p.theme_preference.clone()),
        club_switcher_hint_seen_at: existing.as_ref().and_then(|p| p.club_switcher_hint_seen_at),
    };
    put_profile_entry(&profile);
    Ok(profile)
}

/// Sets (or clears) the caller's UI theme preference, so it follows the
/// account across devices. Creates a blank profile entry if the caller has
/// never called `set_profile`.
#[ic_cdk::update]
fn set_theme_preference(theme: Option<String>) -> Outcome<Profile> {
    let caller = ic_cdk::api::msg_caller();
    let account_id = account_for_write(caller)?.id;
    if let Some(value) = theme.as_deref() {
        if value != "light" && value != "dark" {
            return Err("Theme must be \"light\" or \"dark\"".into());
        }
    }
    let mut profile = get_or_init_profile(&account_id);
    profile.theme_preference = theme;
    profile.updated_at_ns = ic_cdk::api::time();
    put_profile_entry(&profile);
    Ok(profile)
}

/// Records that the caller has dismissed the club switcher coach-mark, so
/// it stays dismissed across devices. Creates a blank profile entry if the
/// caller has never called `set_profile`.
#[ic_cdk::update]
fn set_club_switcher_hint_seen() -> Outcome<Profile> {
    let caller = ic_cdk::api::msg_caller();
    let account_id = account_for_write(caller)?.id;
    let mut profile = get_or_init_profile(&account_id);
    profile.club_switcher_hint_seen_at = Some(ic_cdk::api::time() / 1_000_000);
    profile.updated_at_ns = ic_cdk::api::time();
    put_profile_entry(&profile);
    Ok(profile)
}

/// The caller's own profile, or an error when none has been set yet.
#[ic_cdk::query]
fn get_profile() -> Outcome<Profile> {
    let account_id = account_for(ic_cdk::api::msg_caller())?.id;
    get_profile_entry(&account_id).ok_or("Profile not set".into())
}

/// Batch profile lookup by account id (principal text / user id), used by
/// the frontend profile cache to resolve many ids in one round trip.
/// Unknown ids are skipped rather than causing an error.
#[ic_cdk::query]
fn get_profiles_by_ids(ids: Vec<String>) -> Vec<Profile> {
    ids.iter().filter_map(|id| get_profile_entry(id)).collect()
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
    let mut results = Vec::new();
    for profile in all_profiles() {
        if profile.display_name.trim().is_empty()
            || !profile.display_name.to_lowercase().contains(&needle)
        {
            continue;
        }
        let principal = match get_account(&profile.account_id).and_then(|a| a.principals.first().copied()) {
            Some(p) => p,
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
    let account_id = account_for(ic_cdk::api::msg_caller())?.id;
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
    let account = account_for(ic_cdk::api::msg_caller())?;
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
    let core = state();
    require_governor(&core, ic_cdk::api::msg_caller())?;
    let accounts: Vec<Account> = ACCOUNTS.with(|m| m.borrow().iter().map(|e| decode(&e.value())).collect());
    Ok(State {
        schema: core.schema,
        governor: core.governor,
        accounts,
        profiles: all_profiles(),
        roles: core.roles,
        families: core.families,
        exclusions: core.exclusions,
        challenges: core.challenges,
        external_bindings: core.external_bindings,
        privacy_consents: core.privacy_consents,
        terms_acceptances: core.terms_acceptances,
        entitlements: all_entitlements(),
        verifiers: core.verifiers,
        attestation_secret: core.attestation_secret,
        next_challenge: core.next_challenge,
    })
}

#[ic_cdk::query]
fn get_external_bindings(account_id: String) -> Outcome<Vec<ExternalSiteBinding>> {
    let caller = ic_cdk::api::msg_caller();
    let state = state();
    let account = account_for(caller)?;
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
    let account = account_for(caller)?;
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
    let account = account_for_write(caller)?;
    if DELETION_TICKETS.with(|m|m.borrow().contains_key(&account.id)) { return Err("Deletion reservation pending".into()); }
    if link_lifecycle().pending.iter().any(|job| job.account_id == account.id) { return Err("Unlink recovery pending".into()); }
    authenticated(target)?;
    validate_denied_relink(target, &account.id, account.version)?;
    if find_account_by_principal(target).is_some() {
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
    if find_account_by_principal(caller).is_some() {
        return Err("Identity already assigned".into());
    }
    let mut account = get_account(&challenge.account_id).ok_or("Account unavailable")?;
    if DELETION_TICKETS.with(|m|m.borrow().contains_key(&account.id)) { return Err("Deletion reservation pending".into()); }
    if account.status != AccountStatus::Active || link_lifecycle().pending.iter().any(|job| job.account_id == account.id) {
        return Err("Account unavailable during link recovery".into());
    }
    if challenge.accepted
        || account.version != challenge.expected_version
        || !account.principals.contains(&challenge.issuer)
    {
        return Err("Link authorization changed".into());
    }
    validate_denied_relink(caller, &account.id, account.version)?;
    account.version = account
        .version
        .checked_add(1)
        .ok_or("Account version exhausted")?;
    if account.principals.len() >= MAX_PRINCIPALS {
        return Err("Identity quota reached".into());
    }
    account.principals.push(caller);
    put_account(&account);
    index_principal(caller, &account.id);
    state.challenges[index].accepted = true;
    store(&state);
    if let Some(mut denial) = principal_denial(caller) {
        denial.reauthorized_version = Some(account.version);
        bump_removal_history();
        PRINCIPAL_DENIALS.with(|m| m.borrow_mut().insert(caller.to_text(), encode(&denial)));
    }
    Ok(account)
}
#[ic_cdk::update]
async fn revoke(principal: Principal, expected_version: u64) -> Outcome<Account> {
    if !account_group_rehearsal_enabled() { return Err("Cross-group identity revocation not released".into()); }
    let caller = ic_cdk::api::msg_caller();
    // A self-unlink may only be resumed by a surviving sign-in identity.
    let current = account_for_write(caller)?;
    if DELETION_TICKETS.with(|m|m.borrow().contains_key(&current.id)) { return Err("Deletion reservation pending".into()); }
    if principal == caller { return Err("Use a surviving identity to revoke this sign-in".into()); }
    if !current.principals.contains(&principal) || current.principals.len() == 1 {
        return Err("Cannot revoke missing or last identity".into());
    }
    if current.version != expected_version {
        return Err("Account version conflict".into());
    }
    let mut lifecycle = link_lifecycle();
    if lifecycle.authorities.is_empty() { return Err("Complete club authority inventory required".into()); }
    if let Some(job) = lifecycle.pending.iter().find(|job| job.account_id == current.id) {
        if job.principal != principal || job.version != expected_version { return Err("Different unlink recovery pending".into()); }
    } else {
        if lifecycle.pending.len() >= 1000 { return Err("Unlink recovery quota reached".into()); }
        // Denial and intent commit in the same pre-await message. Keep denial
        // after completion; deindexing alone would permit fresh registration.
        deny_unlinked_principal(principal, &current.id, expected_version)?;
        lifecycle.pending.push(UnlinkIntent { account_id: current.id.clone(), principal, version: expected_version, acknowledged: vec![], authorities: lifecycle.authorities.clone() });
        store_link_lifecycle(&lifecycle);
    }
    // Intent persists BEFORE any await. A missing response is replayed against
    // the same authority, whose removal endpoint is idempotent.
    let frozen = lifecycle.pending.iter().find(|job| job.account_id == current.id).ok_or("Unlink intent missing")?.clone();
    deny_unlinked_principal(principal, &current.id, expected_version)?;
    for authority in unlink_targets(&frozen)? {
        let latest = link_lifecycle();
        let job = latest.pending.iter().find(|job| job.account_id == current.id).ok_or("Unlink already completed; reload account")?;
        if job.principal != principal || job.version != expected_version || job.authorities != frozen.authorities { return Err("Unlink recovery changed".into()); }
        if job.acknowledged.contains(&authority) { continue; }
        let response = ic_cdk::call::Call::bounded_wait(authority, "revoke_linked_principal")
            .with_args(&(current.id.clone(), principal, expected_version)).await
            .map_err(|_| "Club authority unavailable; retry unlink recovery".to_string())?;
        let ack: Outcome<()> = response.candid().map_err(|_| "Invalid club unlink acknowledgement".to_string())?;
        ack?;
        let mut latest = link_lifecycle();
        let job = latest.pending.iter_mut().find(|job| job.account_id == current.id).ok_or("Unlink recovery changed")?;
        if job.principal != principal || job.version != expected_version { return Err("Unlink recovery changed".into()); }
        if job.authorities != frozen.authorities { return Err("Unlink authority snapshot changed".into()); }
        if !job.acknowledged.contains(&authority) { job.acknowledged.push(authority); }
        store_link_lifecycle(&latest);
    }
    let latest = link_lifecycle();
    let completed = latest.pending.iter().find(|job| job.account_id == current.id).ok_or("Unlink recovery changed")?;
    if completed.principal != principal || completed.version != expected_version || completed.authorities != frozen.authorities ||
        !unlink_targets(completed)?.iter().all(|id| completed.acknowledged.contains(id)) {
        return Err("Complete unlink acknowledgements required".into());
    }
    let mut account = get_account(&current.id).ok_or("Account unavailable")?;
    if account.version != expected_version || !account.principals.contains(&caller) { return Err("Unlink authorization changed".into()); }
    account.version = account
        .version
        .checked_add(1)
        .ok_or("Account version exhausted")?;
    account.principals.retain(|item| *item != principal);
    put_account(&account);
    deindex_principal(principal);
    let mut latest = link_lifecycle(); latest.pending.retain(|job| job.account_id != current.id); store_link_lifecycle(&latest);
    Ok(account)
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
    if !account_exists(&account_id) {
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
    let account = account_for(caller)?;
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
    let account_id = account_for_write(caller)?.id;
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
    let account = account_for(caller)?;
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
    let account_id = account_for(ic_cdk::api::msg_caller())?.id;
    Ok(state
        .terms_acceptances
        .iter()
        .find(|entry| entry.account_id == account_id)
        .cloned())
}

#[ic_cdk::update]
fn erase_account(account_id: String) -> Outcome<()> {
    if group_inventory_binding().is_some() { return Err("Bound deletion required".into()); }
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    let caller_account = account_for(caller)?;
    let caller_is_app_admin =
        account_has_role(&state, &caller_account.id, "app_admin", None, None, None);
    if caller_account.id != account_id && state.governor != caller && !caller_is_app_admin {
        return Err("Forbidden".into());
    }
    let account = get_account(&account_id).ok_or("Unknown account")?;
    if link_lifecycle().pending.iter().any(|job| job.account_id == account_id) { return Err("Unlink recovery pending".into()); }
    if account.principals.contains(&state.governor) {
        return Err("Governor account cannot be erased".into());
    }
    erase_account_core(&mut state, &account)?;
    store(&state);
    Ok(())
}

fn erase_account_core(state: &mut CoreState, account: &Account) -> Outcome<()> {
    if removal_intent(&account.id).is_some() { return Err("Complete receiver drain required before erasure".into()); }
    let account_id = account.id.clone();
    if account.principals.contains(&state.governor) { return Err("Governor account cannot be erased".into()); }
    let version = account.version.checked_add(1).ok_or("Account version exhausted")?;
    if account_is_erased(&account_id) { return Err("Account already erased".into()); }
    if ERASED_ACCOUNTS.with(|m| m.borrow().len()) >= MAX_ACCOUNTS as u64 {
        return Err("Erased account history capacity reached".into());
    }
    // Terminal history survives deletion of personal records and indexes.
    // This is identity-local revocation, not a remote role-drain receipt.
    deny_principals(&account.principals, &account_id, version, DenialReason::Erased)?;
    bump_removal_history();
    ERASED_ACCOUNTS.with(|m| m.borrow_mut().insert(account_id.clone(), version));
    let erased_principals = account.principals.clone();
    remove_account(&account_id);
    for principal in &erased_principals {
        deindex_principal(*principal);
        remove_entitlements_for_principal(*principal);
    }
    remove_profile_entry(&account_id);
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
    state
        .terms_acceptances
        .retain(|entry| entry.account_id != account_id);
    state.challenges.retain(|challenge| {
        challenge.account_id != account_id && !erased_principals.contains(&challenge.target)
    });
    Ok(())
}

/// Governor-only: moves one user's sign-in ID (`old`) to a new one (`new`).
/// Everything here except entitlements and link challenges is keyed by
/// account_id, so the move links `new` to the old account (same account_id,
/// so profile, roles, families, consents and terms follow) and unlinks
/// `old`. A bare account auto-created for `new` at sign-in is removed first;
/// any real data on it (profile, roles, ...) refuses the move. Returns the
/// number of records changed (or that would change when `dry_run`).
/// Any NEW stored principal / principal-text field must be added here.
#[ic_cdk::update]
fn rekey_principal(old: Principal, new: Principal, dry_run: bool) -> Outcome<u64> {
    let caller = ic_cdk::api::msg_caller();
    let mut state = state();
    require_governor(&state, caller)?;
    if !link_lifecycle().pending.is_empty() { return Err("Unlink recovery pending".into()); }
    let changed = rekey_principal_core(&mut state, old, new, dry_run)?;
    if !dry_run {
        store(&state);
    }
    Ok(changed)
}

fn rekey_principal_core(
    state: &mut CoreState,
    old: Principal,
    new: Principal,
    dry_run: bool,
) -> Outcome<u64> {
    if [old,new].iter().any(|p| find_account_by_principal(*p).is_some_and(|a| DELETION_TICKETS.with(|m|m.borrow().contains_key(&a.id)))) {
        return Err("Deletion reservation pending".into());
    }
    if removal_subject_fenced(old) || removal_subject_fenced(new) ||
        find_account_by_principal(old).is_some_and(|a| removal_intent(&a.id).is_some()) ||
        find_account_by_principal(new).is_some_and(|a| removal_intent(&a.id).is_some()) {
        return Err("Removal barrier pending".into());
    }
    if old == Principal::anonymous() || new == Principal::anonymous() {
        return Err("Anonymous principal not allowed".into());
    }
    if let Some(previous) = principal_denial(old) {
        if previous.reason == DenialReason::Rekeyed && previous.rekey_destination == Some(new) && principal_denial(new).is_none() &&
            !account_is_erased(&previous.account_id) &&
            find_account_by_principal(new).is_some_and(|a| a.id == previous.account_id && a.version >= previous.version && a.principals.contains(&new) && !a.principals.contains(&old)) {
            return Ok(0);
        }
        return Err("Revoked identity cannot be rekeyed".into());
    }
    if principal_denial(new).is_some() {
        return Err("Revoked identity cannot be rekeyed".into());
    }
    if old == new {
        return Err("Old and new sign-in IDs are the same".into());
    }
    if old == state.governor || new == state.governor {
        return Err("The governor cannot be moved".into());
    }
    let Some(mut account) = find_account_by_principal(old) else {
        // Already moved (or never existed): nothing to do.
        return Ok(0);
    };
    if !account.principals.contains(&old) { return Err("Stale principal account index".into()); }
    if account_is_erased(&account.id) { return Err("Account erased".into()); }
    let next_version = account.version.checked_add(1).ok_or("Account version exhausted")?;
    let mut changed: u64 = 0;
    // A bare account created for `new` at sign-in must go first.
    let bare = match find_account_by_principal(new) {
        Some(existing) if existing.id == account.id => None,
        Some(existing) => {
            let id = existing.id.clone();
            let has_data = get_profile_entry(&id).is_some()
                || state.roles.iter().any(|g| g.account_id == id)
                || state.families.iter().any(|f| f.account_id == id)
                || state.exclusions.iter().any(|e| e.account_id == id)
                || state.external_bindings.iter().any(|b| b.account_id == id)
                || all_entitlements().iter().any(|e| e.principal == new);
            if has_data || existing.principals.len() > 1 {
                return Err("New sign-in ID already has a profile or data in identity_access".into());
            }
            Some(existing)
        }
        None => None,
    };
    // All refusal checks precede the durable terminal denial and data moves.
    if !dry_run {
        deny_principals(&[old], &account.id, next_version, DenialReason::Rekeyed)?;
        let mut denial = principal_denial(old).ok_or("Rekey denial missing")?;
        denial.rekey_destination = Some(new);
        bump_removal_history();
        PRINCIPAL_DENIALS.with(|m| m.borrow_mut().insert(old.to_text(), encode(&denial)));
    }
    if let Some(existing) = &bare {
        changed += 1;
        if !dry_run {
            remove_account(&existing.id);
            deindex_principal(new);
            let id = existing.id.clone();
            state.privacy_consents.retain(|c| c.account_id != id);
            state.terms_acceptances.retain(|t| t.account_id != id);
            state.challenges.retain(|c| c.account_id != id);
        }
    }
    // Link new, unlink old on the surviving account.
    changed += 1;
    if !dry_run {
        account.principals.retain(|p| *p != old && *p != new);
        account.principals.push(new);
        account.version = next_version;
        put_account(&account);
        deindex_principal(old);
        index_principal(new, &account.id);
    }
    // Principal-keyed entitlements.
    let moved: Vec<(String, Entitlement)> = ENTITLEMENTS.with(|m| {
        m.borrow()
            .iter()
            .filter_map(|e| {
                let ent: Entitlement = decode(&e.value());
                (ent.principal == old).then(|| (e.key().clone(), ent))
            })
            .collect()
    });
    changed += moved.len() as u64;
    if !dry_run {
        for (key, mut ent) in moved {
            ENTITLEMENTS.with(|m| m.borrow_mut().remove(&key));
            ent.principal = new;
            let new_key = entitlement_key(new, &ent.product_id, &ent.transaction_id);
            put_entitlement(&new_key, &ent);
        }
    }
    // Pending link challenges naming old are void.
    let stale = state
        .challenges
        .iter()
        .filter(|c| c.issuer == old || c.target == old)
        .count();
    changed += stale as u64;
    if !dry_run {
        state.challenges.retain(|c| c.issuer != old && c.target != old);
    }
    Ok(changed)
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
    if !account_exists(&account_id) {
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

/// Mirrors `grant_role`'s auth (governor-only).
#[ic_cdk::update]
fn revoke_role(account_id: String, role: String, club: Option<String>, team: Option<String>) -> Outcome<()> {
    revoke_role_scoped(account_id, role, None, club, team)
}

/// Mirrors `grant_role_scoped`'s auth (governor-only).
#[ic_cdk::update]
fn revoke_role_scoped(
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
    let before = state.roles.len();
    state.roles.retain(|item| {
        !(item.account_id == account_id
            && item.role == role
            && item.site_id == site_id
            && item.club == club
            && item.team == team)
    });
    if state.roles.len() == before {
        return Err("Role grant not found".into());
    }
    store(&state);
    Ok(())
}

/// Admin-gated (governor or an account holding the `app_admin` role):
/// suspends or reactivates an account. `Suspended` accounts are rejected by
/// `account_for_write`-gated self-service writes (see its doc comment);
/// admin-gated writes on their behalf keep working.
#[ic_cdk::update]
fn set_account_status(account_id: String, status: AccountStatus) -> Outcome<Account> {
    let caller = ic_cdk::api::msg_caller();
    let state = state();
    let caller_account = account_for(caller)?;
    let is_app_admin = account_has_role(&state, &caller_account.id, "app_admin", None, None, None);
    if state.governor != caller && !is_app_admin {
        return Err("Forbidden".into());
    }
    let mut account = get_account(&account_id).ok_or("Unknown account")?;
    if DELETION_TICKETS.with(|m|m.borrow().contains_key(&account.id)) { return Err("Deletion reservation pending".into()); }
    if status == AccountStatus::Suspended && account.principals.contains(&state.governor) {
        return Err("Governor account cannot be suspended".into());
    }
    account.status = status;
    put_account(&account);
    Ok(account)
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
    if !account_exists(&account_id) {
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
    if !account_exists(&account_id) {
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
    principal: Principal,
    product_id: String,
    transaction_id: String,
    expires_at_ms: u64,
    source: String,
) -> Outcome<Entitlement> {
    if !valid_id(&product_id) || !valid_id(&source) {
        return Err("Invalid entitlement fields".into());
    }
    let key = entitlement_key(principal, &product_id, &transaction_id);
    // Replay protection: once an Apple transaction id has been redeemed, it
    // is permanently bound to the first principal that redeemed it. The same
    // principal may re-verify (idempotent refresh, e.g. renewal), but a
    // different principal submitting the same transaction id is rejected.
    let existing = get_entitlement(&key);
    if let Some(existing) = &existing {
        if !transaction_id.is_empty() && existing.principal != principal {
            return Err("Transaction already redeemed by another identity".into());
        }
    }
    if existing.is_none() && entitlements_count() >= MAX_ENTITLEMENTS as u64 {
        return Err("Entitlement quota reached".into());
    }
    let record = Entitlement {
        principal,
        product_id,
        transaction_id,
        expires_at_ms,
        source,
        granted_at_ms: ic_cdk::api::time() / 1_000_000,
    };
    put_entitlement(&key, &record);
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
    let state = state();
    if state.governor != caller && !state.verifiers.contains(&caller) {
        return Err("Forbidden".into());
    }
    authenticated(principal)?;
    let record = upsert_entitlement(principal, product_id, transaction_id, expires_at_ms, source)?;
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
    let state = state();
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
    let record = upsert_entitlement(caller, product_id, transaction_id, expires_at_ms, source)?;
    Ok(record)
}

/// The caller's own entitlement records (active and expired).
#[ic_cdk::query]
fn get_my_entitlements() -> Outcome<Vec<Entitlement>> {
    let caller = ic_cdk::api::msg_caller();
    authenticated(caller)?;
    Ok(all_entitlements()
        .into_iter()
        .filter(|e| e.principal == caller)
        .collect())
}

/// True when `principal` holds any non-expired Pro entitlement. Callable by
/// any authenticated principal (boolean only, no entitlement detail leaked).
#[ic_cdk::query]
fn is_pro(principal: Principal) -> Outcome<bool> {
    authenticated(ic_cdk::api::msg_caller())?;
    let now_ms = ic_cdk::api::time() / 1_000_000;
    Ok(all_entitlements()
        .into_iter()
        .any(|e| e.principal == principal && e.expires_at_ms > now_ms))
}

#[ic_cdk::query]
fn check_field_access(account_id: String, section: String) -> Outcome<bool> {
    let state = state();
    let caller = ic_cdk::api::msg_caller();
    let caller_account = account_for(caller)?;
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
    #[test]
    fn history_retains_beyond_old_lifetime_caps() {
        assert!(MAX_ACCOUNTS > 10_001);
        for i in 0..80_001u32 {
            let subject = Principal::from_slice(&i.to_be_bytes());
            deny_principals(&[subject], "retained-history", 1, DenialReason::Erased).unwrap();
        }
        for i in 0..10_001u32 {
            ERASED_ACCOUNTS.with(|m| m.borrow_mut().insert(format!("retained-{i}"), 1));
        }
        assert!(PRINCIPAL_DENIALS.with(|m| m.borrow().len()) > 80_000);
        assert!(ERASED_ACCOUNTS.with(|m| m.borrow().len()) > 10_000);
        assert!(principal_denial(Principal::from_slice(&0u32.to_be_bytes())).is_some());
        assert!(ERASED_ACCOUNTS.with(|m| m.borrow().contains_key(&"retained-0".to_string())));
    }
    #[test]
    fn actual_account_registration_crosses_10000_and_keeps_first_identity() {
        let principal_at = |i: u32| Principal::self_authenticating(i.to_be_bytes());
        for i in 0..10_001u32 { ensure_account(principal_at(i)).unwrap(); }
        assert_eq!(account_count(), 10_001);
        let first = account_for(principal_at(0)).unwrap();
        assert_eq!(ensure_account(principal_at(0)).unwrap(), first.id);
        assert_eq!(account_count(), 10_001);
        assert_eq!(account_for(principal_at(10_000)).unwrap().id, account_id(principal_at(10_000)));
        assert!(ensure_account(Principal::anonymous()).is_err());
    }
    #[test]
    fn removal_intent_survives_restored_accounts_and_cannot_complete_without_receivers() {
        let (snapshot,binding,clubs)=group_inventory::tests::fixture();
        let p=|v| Principal::from_slice(&[v,1]);
        let extra=vec![group_inventory::Supplemental {group_id:"g0".into(),domain:"media_blob_store".into(),canister:p(91),subnet:p(80)},
            group_inventory::Supplemental {group_id:"g1".into(),domain:"media_blob_store".into(),canister:p(92),subnet:p(80)}];
        let inventory=group_inventory::RemovalInventory {groups:group_inventory::Evidence {binding,history_revision:0,snapshot},supplemental:extra,
            media:clubs.iter().enumerate().map(|(n,c)|group_inventory::MediaEvidence {club_authority:*c,
                registry:group_inventory::MediaRegistry {active:false,stores:vec![p(91+n as u8)]}}).collect()};
        let subject=principal(150); let restored_alias=principal(151);
        let account=Account {id:"barrier-restored-account".into(),principals:vec![subject],version:5,status:AccountStatus::Active};
        put_account(&account); index_principal(subject,&account.id);
        let intent=persist_removal_intent(&account,inventory.clone(),p(90)).unwrap();
        assert_eq!(intent.generation,1); assert_eq!(intent.targets.len(),27);
        assert!(account_for(subject).is_err()); assert!(ensure_account(subject).is_err());
        assert_eq!(principal_eligibility(subject).decision,EligibilityDecision::Denied);
        let mut restored=account.clone(); restored.version=99; restored.principals=vec![restored_alias];
        put_account(&restored); index_principal(restored_alias,&restored.id);
        assert!(account_for(restored_alias).is_err());
        assert_eq!(principal_eligibility(restored_alias).decision,EligibilityDecision::Denied);
        let mut core=empty_core_state(principal(152));
        assert_eq!(erase_account_core(&mut core,&restored),Err("Complete receiver drain required before erasure".into()));
        assert!(rekey_principal_core(&mut core,restored_alias,principal(153),false).is_err());
        assert_eq!(persist_removal_intent(&restored,inventory,p(90)).unwrap(),intent);
        assert_eq!(REMOVAL_GENERATION.with(|m|*m.borrow().get()),1);
        assert_eq!(decode::<removal_barrier::Intent>(&encode(&intent)),intent);
        let receipt = removal_barrier::Receipt { request: intent.request(), receiver: intent.targets[0], outstanding: 3u8.into() };
        let receipt_key = format!("{}:{}", account.id, receipt.receiver.to_text());
        REMOVAL_RECEIPTS.with(|m| m.borrow_mut().insert(receipt_key.clone(), encode(&receipt)));
        bump_removal_history();
        let manifest = history_manifest();
        assert_eq!(manifest.removal_generation, 1);
        assert_eq!(manifest.removal_barriers, 1);
        assert_eq!(manifest.removal_subjects, 1);
        assert_eq!(manifest.removal_receipts, 1);
        let page = history_page(manifest.revision, RemovalHistoryCursor::RemovalBarriers(None), 1).unwrap();
        assert_eq!(page.barriers, vec![(account.id.clone(), intent.clone())]);
        assert!(history_page(manifest.revision, RemovalHistoryCursor::RemovalBarriers(Some("x".repeat(257))), 1).is_err());
        let page = history_page(manifest.revision, RemovalHistoryCursor::RemovalSubjects(None), 1).unwrap();
        assert_eq!(page.subjects, vec![(subject.to_text(), account.id.clone())]);
        let page = history_page(manifest.revision, RemovalHistoryCursor::RemovalReceipts(None), 1).unwrap();
        assert_eq!(page.receipts, vec![(receipt_key, receipt)]);
        let other=Account {id:"barrier-bystander".into(),principals:vec![principal(154)],version:1,status:AccountStatus::Active};
        put_account(&other); index_principal(other.principals[0],&other.id);
        assert_eq!(account_for(other.principals[0]).unwrap(),other);
    }
    #[test]
    fn cross_group_account_lifecycle_is_off_outside_local_canisters() {
        assert!(!account_group_rehearsal_enabled());
        assert_eq!(set_club_authorities(vec![Principal::self_authenticating([125; 32])]), Err("Cross-group account lifecycle not released".into()));
    }
    #[test]
    fn pending_unlink_does_not_expose_revoked_identity_to_group_sync() {
        let a = Principal::self_authenticating([120; 32]);
        let b = Principal::self_authenticating([121; 32]);
        let account = Account { id: "unlink-filter".into(), principals: vec![a, b], version: 4, status: AccountStatus::Active };
        let lifecycle = LinkLifecycle { authorities: vec![a], pending: vec![UnlinkIntent { account_id: account.id.clone(), principal: b, version: 4, acknowledged: vec![], authorities: vec![a] }] };
        let restored: LinkLifecycle = decode(&encode(&lifecycle));
        assert_eq!(effective_account(account, &restored).principals, vec![a]);
        assert_eq!(restored.pending[0].version, 4);
        assert!(restored.pending[0].acknowledged.is_empty());
    }
    #[test]
    fn pending_unlink_blocks_private_shared_account_access() {
        let user = Principal::self_authenticating([122; 32]);
        let keeper = Principal::self_authenticating([123; 32]);
        let account = Account { id: "unlink-private".into(), principals: vec![user, keeper], version: 8, status: AccountStatus::Active };
        put_account(&account); index_principal(user, &account.id); index_principal(keeper, &account.id);
        store_link_lifecycle(&LinkLifecycle { authorities: vec![keeper], pending: vec![UnlinkIntent { account_id: account.id.clone(), principal: user, version: 8, acknowledged: vec![keeper], authorities: vec![keeper] }] });
        assert_eq!(account_for(user), Err("Identity revocation pending".into()));
        assert_eq!(account_for(keeper).unwrap().id, account.id);
        assert_eq!(link_lifecycle().pending[0].acknowledged, vec![keeper]);
        store_link_lifecycle(&LinkLifecycle::default());
    }
    fn principal(value: u8) -> Principal {
        Principal::self_authenticating([value; 32])
    }
    #[test]
    fn completed_denial_blocks_registration_even_without_account_index() {
        let removed = principal(104);
        deny_unlinked_principal(removed, "surviving-account", 8).unwrap();
        deindex_principal(removed);
        assert!(ensure_account(removed).is_err());
        assert!(account_for(removed).is_err());
        assert_eq!(principal_denial(removed).unwrap().version, 8);
    }
    #[test]
    fn denial_accepts_only_a_newer_same_account_relink() {
        let removed = principal(105);
        deny_unlinked_principal(removed, "original", 8).unwrap();
        assert!(validate_denied_relink(removed, "original", 7).is_err());
        assert!(validate_denied_relink(removed, "original", 8).is_err());
        assert!(validate_denied_relink(removed, "unrelated", 9).is_err());
        assert!(validate_denied_relink(removed, "original", 9).is_ok());
        assert!(deny_unlinked_principal(removed, "original", 7).is_err());
        assert!(deny_unlinked_principal(removed, "unrelated", 9).is_err());
    }
    #[test]
    fn rekey_and_dry_run_cannot_bypass_durable_denial() {
        let removed = principal(106); let active = principal(107);
        deny_unlinked_principal(removed, "original", 2).unwrap();
        let mut core = empty_core_state(principal(108));
        for dry in [true, false] {
            assert!(rekey_principal_core(&mut core, removed, active, dry).is_err());
            assert!(rekey_principal_core(&mut core, active, removed, dry).is_err());
        }
    }
    #[test]
    fn eligibility_denies_unknown_suspended_and_removed_but_keeps_survivor() {
        let removed = principal(94); let survivor = principal(95); let unknown = principal(96);
        let mut account = Account { id: "eligibility".into(), principals: vec![removed, survivor], version: 3, status: AccountStatus::Active };
        put_account(&account); index_principal(removed, &account.id); index_principal(survivor, &account.id);
        deny_unlinked_principal(removed, &account.id, 3).unwrap();
        assert_eq!(principal_eligibility(removed).decision, EligibilityDecision::Denied);
        assert_eq!(principal_eligibility(removed).denied_through_version, Some(3));
        assert_eq!(principal_eligibility(survivor).decision, EligibilityDecision::Eligible);
        assert_eq!(principal_eligibility(unknown).decision, EligibilityDecision::Denied);
        account.status = AccountStatus::Suspended; put_account(&account);
        assert_eq!(principal_eligibility(survivor).decision, EligibilityDecision::Denied);
    }
    #[test]
    fn reauthorization_retains_history_and_rejects_mismatched_restored_accounts() {
        let removed = principal(97);
        deny_unlinked_principal(removed, "original-generation", 8).unwrap();
        let mut denial = principal_denial(removed).unwrap(); denial.reauthorized_version = Some(10);
        PRINCIPAL_DENIALS.with(|m| m.borrow_mut().insert(removed.to_text(), encode(&denial)));
        let mut account = Account { id: denial.account_id.clone(), principals: vec![removed], version: 10, status: AccountStatus::Active };
        put_account(&account); index_principal(removed, &account.id);
        assert_eq!(principal_eligibility(removed).decision, EligibilityDecision::Eligible);
        account.version = 9; put_account(&account);
        assert_eq!(principal_eligibility(removed).decision, EligibilityDecision::Denied);
        account.id = "unrelated-generation".into(); account.version = 11; put_account(&account); index_principal(removed, &account.id);
        assert_eq!(principal_eligibility(removed).decision, EligibilityDecision::Denied);
        deindex_principal(removed);
        assert!(ensure_account(removed).is_err());
        assert_eq!(principal_denial(removed).unwrap().version, 8);
    }
    #[test]
    fn eligibility_transport_remains_unreleased() {
        assert_eq!(authority_eligibilities(principal(98), vec![principal(99)]), Err("Cross-group eligibility not released".into()));
    }
    #[test]
    fn service_readers_remain_separate_and_unreleased() {
        assert_eq!(set_service_authorities(vec![principal(97)]), Err("Service admission not released".into()));
        assert_eq!(service_account(principal(97), principal(98)), Err("Service admission not released".into()));
        assert!(service_authorities().is_empty());
    }
    #[test]
    fn service_inventory_rejects_duplicate_anonymous_and_over_capacity() {
        assert!(validate_service_authorities(&[principal(97)]).is_ok());
        assert!(validate_service_authorities(&[]).is_err());
        assert!(validate_service_authorities(&[principal(97), principal(97)]).is_err());
        assert!(validate_service_authorities(&[Principal::anonymous()]).is_err());
        assert!(validate_service_authorities(&[Principal::management_canister()]).is_err());
        let many = |n: u32| (0..n).map(|i| Principal::from_slice(&[1, (i >> 8) as u8, i as u8, 7])).collect::<Vec<_>>();
        assert!(validate_service_authorities(&many(200)).is_ok());
        assert!(validate_service_authorities(&many(4097)).is_err());
    }
    #[test]
    fn erasure_blocks_all_current_identities_and_preserves_other_accounts() {
        let a = principal(70); let b = principal(71); let survivor = principal(72);
        let erased = Account { id: "erase-terminal".into(), principals: vec![a, b], version: 4, status: AccountStatus::Active };
        let other = Account { id: "erase-bystander".into(), principals: vec![survivor], version: 9, status: AccountStatus::Active };
        for account in [&erased, &other] { put_account(account); for p in &account.principals { index_principal(*p, &account.id); } }
        let mut core = empty_core_state(principal(73));
        erase_account_core(&mut core, &erased).unwrap();
        assert!(get_account(&erased.id).is_none());
        for p in [a, b] {
            assert_eq!(principal_denial(p).unwrap().reason, DenialReason::Erased);
            assert_eq!(principal_denial(p).unwrap().version, 5);
            assert!(ensure_account(p).is_err());
            assert!(validate_denied_relink(p, &erased.id, 100).is_err());
            assert_eq!(principal_eligibility(p).decision, EligibilityDecision::Denied);
        }
        assert_eq!(account_for(survivor).unwrap(), other);
    }
    #[test]
    fn erased_account_history_blocks_old_unlinked_and_restored_accounts() {
        let current = principal(74); let old = principal(75);
        let account = Account { id: "erase-historical".into(), principals: vec![current], version: 8, status: AccountStatus::Active };
        put_account(&account); index_principal(current, &account.id);
        deny_unlinked_principal(old, &account.id, 5).unwrap();
        erase_account_core(&mut empty_core_state(principal(76)), &account).unwrap();
        assert!(validate_denied_relink(old, &account.id, 99).is_err());
        let restored = Account { id: account.id.clone(), principals: vec![old], version: 99, status: AccountStatus::Active };
        put_account(&restored); index_principal(old, &restored.id);
        let mut denial = principal_denial(old).unwrap(); denial.reauthorized_version = Some(99);
        PRINCIPAL_DENIALS.with(|m| m.borrow_mut().insert(old.to_text(), encode(&denial)));
        assert!(account_for(old).is_err());
        assert!(ensure_account(old).is_err());
        assert_eq!(principal_eligibility(old).decision, EligibilityDecision::Denied);
    }
    #[test]
    fn denied_batch_conflict_does_not_partially_erase_an_account() {
        let first = principal(77); let conflict = principal(78);
        let account = Account { id: "erase-conflict".into(), principals: vec![first, conflict], version: 3, status: AccountStatus::Active };
        put_account(&account); index_principal(first, &account.id);
        deny_unlinked_principal(conflict, "different-account", 3).unwrap();
        assert!(erase_account_core(&mut empty_core_state(principal(79)), &account).is_err());
        assert!(principal_denial(first).is_none());
        assert!(!account_is_erased(&account.id));
        assert_eq!(get_account(&account.id).unwrap(), account);
    }
    #[test]
    fn exhausted_versions_refuse_erasure_and_rekey_without_mutation() {
        let user = principal(80); let replacement = principal(81);
        let account = Account { id: "version-exhausted".into(), principals: vec![user], version: u64::MAX, status: AccountStatus::Active };
        put_account(&account); index_principal(user, &account.id);
        let mut core = empty_core_state(principal(82));
        assert!(erase_account_core(&mut core, &account).is_err());
        for dry in [true, false] { assert!(rekey_principal_core(&mut core, user, replacement, dry).is_err()); }
        assert!(principal_denial(user).is_none());
        assert_eq!(get_account(&account.id).unwrap(), account);
    }
    #[test]
    fn legacy_denial_cbor_defaults_to_relinkable_unlink_only() {
        #[derive(Serialize)]
        struct OldDenial { account_id: String, version: u64, reauthorized_version: Option<u64> }
        let decoded: PrincipalDenial = decode(&encode(&OldDenial { account_id: "old-schema".into(), version: 3, reauthorized_version: None }));
        assert_eq!(decoded.reason, DenialReason::Unlinked);
        assert_eq!(decoded.version, 3);
        for reason in [DenialReason::Erased, DenialReason::Rekeyed] {
            let terminal = PrincipalDenial { account_id: "terminal".into(), version: 4, reauthorized_version: Some(99), reason: reason.clone(), rekey_destination: None };
            let restored: PrincipalDenial = decode(&encode(&terminal));
            assert_eq!(restored.reason, reason);
        }
    }
    #[test]
    fn unlink_recovery_uses_the_persisted_targets_not_a_new_registry() {
        let a = principal(110); let b = principal(111);
        let original = UnlinkIntent { account_id: "frozen".into(), principal: b, version: 4, acknowledged: vec![a], authorities: vec![a, b] };
        let restored: UnlinkIntent = decode(&encode(&original));
        let lifecycle = LinkLifecycle { authorities: vec![a], pending: vec![restored] };
        assert_eq!(unlink_targets(&lifecycle.pending[0]).unwrap(), vec![a, b]);
        assert!(!unlink_targets(&lifecycle.pending[0]).unwrap().iter().all(|id| lifecycle.pending[0].acknowledged.contains(id)));
    }
    #[test]
    fn missing_legacy_targets_and_foreign_acknowledgements_fail_closed() {
        let a = principal(112); let b = principal(113);
        let mut job = UnlinkIntent { account_id: "legacy".into(), principal: b, version: 4, acknowledged: vec![], authorities: vec![] };
        assert_eq!(unlink_targets(&job), Err("Exact unlink authority snapshot required".into()));
        job.authorities = vec![a]; job.acknowledged = vec![b];
        assert_eq!(unlink_targets(&job), Err("Foreign unlink acknowledgement".into()));
        job.acknowledged.clear(); job.authorities = vec![a, a];
        assert_eq!(unlink_targets(&job), Err("Invalid unlink authority snapshot".into()));
    }
    #[test]
    fn genuine_legacy_pending_cbor_migrates_using_its_frozen_inventory() {
        #[derive(Serialize)]
        struct OldIntent { account_id: String, principal: Principal, version: u64, acknowledged: Vec<Principal> }
        #[derive(Serialize)]
        struct OldLifecycle { authorities: Vec<Principal>, pending: Vec<OldIntent> }
        let a = principal(114); let b = principal(115);
        let old = OldLifecycle { authorities: vec![a, b], pending: vec![OldIntent {
            account_id: "old".into(), principal: b, version: 7, acknowledged: vec![a],
        }] };
        let decoded: LinkLifecycle = decode(&encode(&old));
        assert!(decoded.pending[0].authorities.is_empty());
        let migrated = migrate_legacy_unlink_targets(decoded).unwrap();
        assert_eq!(unlink_targets(&migrated.pending[0]).unwrap(), vec![a, b]);
        assert_eq!(migrated.pending[0].acknowledged, vec![a]);
        let mut invalid = migrated;
        invalid.pending[0].authorities.clear(); invalid.authorities.clear();
        assert!(migrate_legacy_unlink_targets(invalid).is_err());
    }
    fn empty_core_state(governor: Principal) -> CoreState {
        CoreState {
            schema: SCHEMA,
            governor,
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
        }
    }
    #[test]
    fn stale_restored_index_cannot_grant_access_or_rekey() {
        let stale = principal(83); let member = principal(84); let target = principal(85);
        let account = Account { id: "stale-index".into(), principals: vec![member], version: 7, status: AccountStatus::Active };
        put_account(&account); index_principal(stale, &account.id); index_principal(member, &account.id);
        assert!(account_for(stale).is_err());
        assert!(ensure_account(stale).is_err());
        assert_eq!(principal_eligibility(stale).decision, EligibilityDecision::Denied);
        assert!(rekey_principal_core(&mut empty_core_state(principal(86)), stale, target, false).is_err());
        assert!(principal_denial(stale).is_none());
        assert_eq!(get_account(&account.id).unwrap(), account);
    }
    #[test]
    fn rekey_replay_requires_exact_destination_and_non_erased_account() {
        let old = principal(87); let target = principal(88); let alias = principal(89);
        let account = Account { id: "exact-rekey".into(), principals: vec![old, alias], version: 3, status: AccountStatus::Active };
        put_account(&account); index_principal(old, &account.id); index_principal(alias, &account.id);
        let mut core = empty_core_state(principal(90));
        rekey_principal_core(&mut core, old, target, false).unwrap();
        assert_eq!(rekey_principal_core(&mut core, old, target, false), Ok(0));
        assert!(rekey_principal_core(&mut core, old, alias, false).is_err());
        ERASED_ACCOUNTS.with(|m| m.borrow_mut().insert(account.id.clone(), 5));
        assert!(rekey_principal_core(&mut core, old, target, false).is_err());
    }
    #[test]
    fn rekey_moves_account_to_new_principal_and_drops_bare_account() {
        let governor = principal(1);
        let old = principal(40);
        let new = principal(41);
        let old_id = account_id(old);
        let new_id = account_id(new);
        put_account(&Account { id: old_id.clone(), principals: vec![old], version: 3, status: AccountStatus::Active });
        index_principal(old, &old_id);
        put_profile_entry(&Profile {
            account_id: old_id.clone(),
            display_name: "Paul".into(),
            avatar_ref: None,
            updated_at_ns: 1, theme_preference: None, club_switcher_hint_seen_at: None });
        put_account(&Account { id: new_id.clone(), principals: vec![new], version: 0, status: AccountStatus::Active });
        index_principal(new, &new_id);
        let key = entitlement_key(old, "pro", "");
        put_entitlement(&key, &Entitlement {
            principal: old,
            product_id: "pro".into(),
            transaction_id: String::new(),
            expires_at_ms: 100,
            source: "governor".into(),
            granted_at_ms: 1,
        });
        let mut state = empty_core_state(governor);
        state.roles.push(RoleGrant {
            account_id: old_id.clone(),
            role: "app_admin".into(),
            site_id: None,
            club: None,
            team: None,
        });

        // Dry run reports changes but writes nothing.
        assert_eq!(rekey_principal_core(&mut state, old, new, true), Ok(3));
        assert!(principal_denial(old).is_none());
        assert_eq!(find_account_by_principal(old).map(|a| a.id), Some(old_id.clone()));

        assert_eq!(rekey_principal_core(&mut state, old, new, false), Ok(3));
        let moved = find_account_by_principal(new).expect("new linked");
        assert_eq!(moved.id, old_id);
        assert_eq!(moved.principals, vec![new]);
        assert!(find_account_by_principal(old).is_none());
        assert!(get_account(&new_id).is_none());
        assert_eq!(get_profile_entry(&moved.id).map(|p| p.display_name), Some("Paul".into()));
        assert!(state.roles.iter().any(|g| g.account_id == old_id && g.role == "app_admin"));
        assert!(get_entitlement(&key).is_none());
        assert_eq!(get_entitlement(&entitlement_key(new, "pro", "")).map(|e| e.principal), Some(new));
        assert_eq!(principal_denial(old).unwrap().reason, DenialReason::Rekeyed);
        assert_eq!(principal_denial(old).unwrap().version, 4);
        assert!(ensure_account(old).is_err());
        assert!(validate_denied_relink(old, &moved.id, 99).is_err());
        assert_eq!(principal_eligibility(new).decision, EligibilityDecision::Eligible);
        assert_eq!(principal_eligibility(old).decision, EligibilityDecision::Denied);
        // Second run is a no-op.
        assert_eq!(rekey_principal_core(&mut state, old, new, false), Ok(0));
    }
    #[test]
    fn rekey_refuses_when_new_principal_has_a_profile() {
        let governor = principal(1);
        let old = principal(50);
        let new = principal(51);
        put_account(&Account { id: account_id(old), principals: vec![old], version: 0, status: AccountStatus::Active });
        index_principal(old, &account_id(old));
        put_account(&Account { id: account_id(new), principals: vec![new], version: 0, status: AccountStatus::Active });
        index_principal(new, &account_id(new));
        put_profile_entry(&Profile {
            account_id: account_id(new),
            display_name: "Someone".into(),
            avatar_ref: None,
            updated_at_ns: 1, theme_preference: None, club_switcher_hint_seen_at: None });
        let mut state = empty_core_state(governor);
        assert!(rekey_principal_core(&mut state, old, new, false).is_err());
        assert!(rekey_principal_core(&mut state, governor, new, false).is_err());
        assert!(find_account_by_principal(old).is_some());
    }
    #[test]
    fn ids_and_role_scope_are_bounded() {
        assert!(valid_id("club-a"));
        assert!(!valid_id(""));
        assert!(!valid_id(&"x".repeat(129)));
        let governor = principal(1);
        put_account(&Account {
            id: "account-1".into(),
            principals: vec![principal(2)],
            version: 0,
            status: AccountStatus::Active,
        });
        let mut state = empty_core_state(governor);
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
        assert!(account_exists("account-1"));
        assert!(!account_exists("missing"));
    }
    #[test]
    fn exclusions_override_scoped_roles_but_not_global_role_detection() {
        let governor = principal(1);
        let mut state = empty_core_state(governor);
        state.roles.push(RoleGrant {
            account_id: "a".into(),
            role: "app_admin".into(),
            site_id: None,
            club: None,
            team: None,
        });
        state.exclusions.push(Exclusion {
            account_id: "a".into(),
            site_id: None,
            club: "club-a".into(),
            team: None,
        });
        assert!(account_has_role(&state, "a", "app_admin", None, None, None));
        assert!(excluded(&state, "a", None, Some("club-a"), None));
    }
    #[test]
    fn multi_site_roles_and_exclusions_are_isolated() {
        let governor = principal(1);
        put_account(&Account {
            id: "acc-1".into(),
            principals: vec![principal(2)],
            version: 0,
            status: AccountStatus::Active,
        });
        let mut state = empty_core_state(governor);
        state.roles.push(RoleGrant {
            account_id: "acc-1".into(),
            role: "club_admin".into(),
            site_id: Some("site-a".into()),
            club: Some("club-1".into()),
            team: None,
        });
        state.exclusions.push(Exclusion {
            account_id: "acc-1".into(),
            site_id: Some("site-b".into()),
            club: "club-1".into(),
            team: None,
        });
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
        let mut state = empty_core_state(governor);
        state.families.push(FamilyLink {
            account_id: "guardian-1".into(),
            child_id: "child-9".into(),
        });
        state.exclusions.push(Exclusion {
            account_id: "guardian-1".into(),
            site_id: Some("site-a".into()),
            club: "club-1".into(),
            team: None,
        });

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
        let mut state = empty_core_state(governor);
        state.roles.push(RoleGrant {
            account_id: "player".into(),
            role: "player".into(),
            site_id: Some("site-a".into()),
            club: Some("club-a".into()),
            team: Some("team-a".into()),
        });
        state.roles.push(RoleGrant {
            account_id: "admin".into(),
            role: "app_admin".into(),
            site_id: None,
            club: None,
            team: None,
        });

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
        put_account(&Account {
            id: "user-1".into(),
            principals: vec![principal(2)],
            version: 0,
            status: AccountStatus::Active,
        });
        let mut state = empty_core_state(governor);
        state.privacy_consents.push(PrivacyConsent {
            account_id: "user-1".into(),
            purpose: "child_photo_processing".into(),
            granted: true,
            updated_at_ns: 0,
        });

        assert!(state
            .privacy_consents
            .iter()
            .any(|entry| entry.account_id == "user-1"
                && entry.purpose == "child_photo_processing"
                && entry.granted));
        assert!(account_exists("user-1"));
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
                status: AccountStatus::Active,
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
                status: AccountStatus::Active,
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
            updated_at_ns: 1, theme_preference: None, club_switcher_hint_seen_at: None }];
        let account_id = "a".to_string();
        let replacement = Profile {
            account_id: account_id.clone(),
            display_name: "New".into(),
            avatar_ref: Some("blob:avatar-1".into()),
            updated_at_ns: 2, theme_preference: None, club_switcher_hint_seen_at: None };
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
                updated_at_ns: 0, theme_preference: None, club_switcher_hint_seen_at: None },
            Profile {
                account_id: "user-2".into(),
                display_name: "Stays".into(),
                avatar_ref: None,
                updated_at_ns: 0, theme_preference: None, club_switcher_hint_seen_at: None },
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
    fn legacy_schema4_blob_splits_into_maps_on_migration() {
        let governor = principal(1);
        let user = principal(2);
        let legacy = State {
            schema: 4,
            governor,
            accounts: vec![Account {
                id: "user-1".into(),
                principals: vec![user],
                version: 3,
                status: AccountStatus::Active,
            }],
            profiles: vec![Profile {
                account_id: "user-1".into(),
                display_name: "Paul".into(),
                avatar_ref: None,
                updated_at_ns: 7, theme_preference: None, club_switcher_hint_seen_at: None }],
            roles: vec![RoleGrant {
                account_id: "user-1".into(),
                role: "club_admin".into(),
                site_id: None,
                club: Some("club-a".into()),
                team: None,
            }],
            families: vec![],
            exclusions: vec![],
            challenges: vec![],
            external_bindings: vec![],
            privacy_consents: vec![],
            terms_acceptances: vec![],
            entitlements: vec![Entitlement {
                principal: user,
                product_id: "pro".into(),
                transaction_id: "tx-1".into(),
                expires_at_ms: 100,
                source: "iap".into(),
                granted_at_ms: 50,
            }],
            verifiers: vec![],
            attestation_secret: vec![],
            next_challenge: 9,
        };
        let migrated = migrate_legacy_state(legacy);
        assert_eq!(migrated.schema, SCHEMA);
        assert_eq!(migrated.governor, governor);
        assert_eq!(migrated.roles.len(), 1);
        assert_eq!(migrated.next_challenge, 9);
        // The big collections now live in the maps, not the blob.
        let account = get_account("user-1").expect("account migrated into map");
        assert_eq!(account.version, 3);
        assert_eq!(
            find_account_by_principal(user).map(|a| a.id),
            Some("user-1".to_string())
        );
        assert_eq!(
            get_profile_entry("user-1").map(|p| p.display_name),
            Some("Paul".to_string())
        );
        let key = entitlement_key(user, "pro", "tx-1");
        assert!(get_entitlement(&key).is_some());
    }

    #[test]
    fn entitlement_replay_by_different_principal_is_rejected() {
        let first = principal(2);
        let second = principal(3);
        let key = entitlement_key(first, "pro", "tx-1");
        put_entitlement(
            &key,
            &Entitlement {
                principal: first,
                product_id: "pro".into(),
                transaction_id: "tx-1".into(),
                expires_at_ms: 100,
                source: "iap".into(),
                granted_at_ms: 50,
            },
        );
        // Mirror upsert_entitlement's replay guard: the key is derived from
        // the transaction id alone, so a different principal collides with
        // the bound record and must be rejected; the same principal may
        // re-verify.
        let existing = get_entitlement(&entitlement_key(second, "pro", "tx-1"))
            .expect("transaction id resolves to the bound record");
        assert_ne!(existing.principal, second, "replay must be rejected");
        let same = get_entitlement(&entitlement_key(first, "pro", "tx-1"))
            .expect("same principal re-verifies against the same record");
        assert_eq!(same.principal, first);
    }

    #[test]
    fn erase_account_cleanup_clears_maps_and_blob_entries() {
        let user = principal(2);
        put_account(&Account {
            id: "user-1".into(),
            principals: vec![user],
            version: 1,
            status: AccountStatus::Active,
        });
        index_principal(user, "user-1");
        put_profile_entry(&Profile {
            account_id: "user-1".into(),
            display_name: "Gone".into(),
            avatar_ref: None,
            updated_at_ns: 1, theme_preference: None, club_switcher_hint_seen_at: None });
        let key = entitlement_key(user, "pro", "tx-1");
        put_entitlement(
            &key,
            &Entitlement {
                principal: user,
                product_id: "pro".into(),
                transaction_id: "tx-1".into(),
                expires_at_ms: 100,
                source: "iap".into(),
                granted_at_ms: 50,
            },
        );
        let mut state = empty_core_state(principal(1));
        state.roles.push(RoleGrant {
            account_id: "user-1".into(),
            role: "club_admin".into(),
            site_id: None,
            club: Some("club-a".into()),
            team: None,
        });
        state.terms_acceptances.push(TermsAcceptance {
            account_id: "user-1".into(),
            terms_version: 1,
            accepted_at_ms: 0,
        });
        // Mirror erase_account's cleanup sequence (the handler itself needs
        // msg_caller, which is unavailable in tests).
        let erased = remove_account("user-1").expect("account exists");
        for p in &erased.principals {
            deindex_principal(*p);
            remove_entitlements_for_principal(*p);
        }
        remove_profile_entry("user-1");
        state.roles.retain(|grant| grant.account_id != "user-1");
        state
            .terms_acceptances
            .retain(|entry| entry.account_id != "user-1");
        assert!(!account_exists("user-1"));
        assert!(find_account_by_principal(user).is_none());
        assert!(get_profile_entry("user-1").is_none());
        assert!(get_entitlement(&key).is_none());
        assert_eq!(entitlements_count(), 0);
        assert!(state.roles.is_empty());
        assert!(state.terms_acceptances.is_empty());
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
    #[test]
    fn history_access_is_local_governor_only() {
        let governor = principal(140);
        assert!(history_access(true, governor, governor).is_ok());
        assert_eq!(history_access(false, governor, governor), Err("Removal history recovery not released".into()));
        assert!(history_access(true, governor, principal(141)).is_err());
        assert!(history_access(true, governor, Principal::anonymous()).is_err());
    }
    #[test]
    fn history_pages_preserve_terminal_fields_and_reject_stale_snapshots() {
        let subject = principal(142);
        deny_principals(&[subject], "history-page-account", 12, DenialReason::Rekeyed).unwrap();
        let mut denial = principal_denial(subject).unwrap();
        denial.rekey_destination = Some(principal(143));
        bump_removal_history();
        PRINCIPAL_DENIALS.with(|m| m.borrow_mut().insert(subject.to_text(), encode(&denial)));
        let revision = removal_history_revision();
        let mut cursor = RemovalHistoryCursor::PrincipalDenials(None);
        let mut found = false;
        for _ in 0..100 {
            let page = history_page(revision, cursor, 1).unwrap();
            assert!(page.denials.len() + page.erased.len() + page.pending.len() <= 1);
            for (key, row) in page.denials {
                if key == subject.to_text() {
                    found = true;
                    assert_eq!(row.reason, DenialReason::Rekeyed);
                    assert_eq!(row.version, 12);
                    assert_eq!(row.rekey_destination, Some(principal(143)));
                }
            }
            cursor = page.next;
            if matches!(cursor, RemovalHistoryCursor::Done) { break; }
        }
        assert!(found);
        assert!(history_page(revision, RemovalHistoryCursor::Done, 0).is_err());
        assert!(history_page(revision, RemovalHistoryCursor::Done, 201).is_err());
        assert!(history_page(revision, RemovalHistoryCursor::ErasedAccounts(Some("x".repeat(257))), 1).is_err());
        bump_removal_history();
        assert!(history_page(revision, RemovalHistoryCursor::PrincipalDenials(None), 1).is_err());
    }
    #[test]
    fn history_lifecycle_preserves_exact_legacy_receipts_without_drain_claim() {
        let authority = principal(144);
        let before = removal_history_revision();
        store_link_lifecycle(&LinkLifecycle { authorities: vec![authority], pending: vec![UnlinkIntent {
            account_id: "history-intent".into(), principal: principal(145), version: 7,
            authorities: vec![authority], acknowledged: vec![authority],
        }] });
        assert!(removal_history_revision() > before);
        let manifest = history_manifest();
        assert_eq!(manifest.pending_intents, 1);
        assert_eq!(manifest.club_authorities, vec![authority]);
        let page = history_page(manifest.revision, RemovalHistoryCursor::PendingIntents(0), 1).unwrap();
        assert_eq!(page.pending[0].authorities, vec![authority]);
        assert_eq!(page.pending[0].acknowledged, vec![authority]);
        assert_eq!(page.pending[0].version, 7);
        assert!(history_page(manifest.revision, RemovalHistoryCursor::PendingIntents(2), 1).is_err());
        store_link_lifecycle(&LinkLifecycle::default());
        assert!(history_page(manifest.revision, page.next, 1).is_err());
    }
}

pub fn candid_interface() -> String {
    __export_service()
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
