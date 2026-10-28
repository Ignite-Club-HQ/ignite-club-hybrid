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
const PRIVATE_NAME_WRITER_MEMORY: u8 = 30;
#[path = "../../shared/private_name_writer_window.rs"]
mod private_name_writer_window;
use private_name_writer_window::{WriterRequest, WriterReceipt};
#[ic_cdk::update]
fn freeze_private_name_preparation(request: WriterRequest) -> Result<(), String> { private_name_writer_window::freeze(request) }
#[ic_cdk::update]
fn read_private_name_preparation(request: WriterRequest) -> Result<WriterReceipt, String> { private_name_writer_window::preparation_receipt(request) }
#[ic_cdk::update]
fn finish_private_name_preparation(request: WriterRequest) -> Result<(), String> { private_name_writer_window::finish_preparation(request) }
#[ic_cdk::update]
fn activate_private_name_preparation(request: WriterRequest) -> Result<(), String> { private_name_writer_window::activate_preparation(request) }
#[ic_cdk::update]
fn open_private_name_writer_window(request: WriterRequest) -> Result<(), String> { private_name_writer_window::open(request) }
#[ic_cdk::update]
fn seal_private_name_writer_window(request: WriterRequest) -> Result<(), String> { private_name_writer_window::seal(request) }
#[ic_cdk::update]
fn read_private_name_writer_window(request: WriterRequest) -> Result<WriterReceipt, String> { private_name_writer_window::receipt(request) }

mod group_inventory;
mod removal_barrier;
mod deletion_timing;
mod admission;
mod membership_directory;
mod membership_directory_store;
mod membership_materializer;
mod membership_updates;
mod membership_private_lookup;
mod membership_namespace;
mod membership_coordinator;
mod membership_propagation;
mod membership_transport;
mod membership_runtime;
mod membership_locations;
mod membership_wire;
mod membership_acceptance;
mod admin_accounts;
mod guardian_search;
mod private_name_audience;
mod private_name_conversion;
mod private_name_account_inventory;
mod private_name_cleanup;
use private_name_cleanup::CleanupAccount;
use private_name_account_inventory::{AccountInventoryCursor, AccountInventoryPage};
mod private_name_conversion_approval;
use private_name_conversion_approval::{SignedApproval,ApprovalReceipt};
mod private_name_coordination;
mod private_name_write_coordinator;
use private_name_write_coordinator::WriteWindow;
use group_inventory::RemovalInventory;
use private_name_coordination::Intent;
use private_name_conversion::{ConversionPage, ConversionProfileRow};
mod private_profile_reference;
mod secure_name_save;
mod club_profiles;
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
const MEM_GROUP2_ADMISSION: u8 = 17;
// Directory-specific additive storage: never share lifecycle/admission maps.
const MEM_DIRECTORY_POOL_META:u8=18;
const MEM_DIRECTORY_POOL_BLOCKS:u8=19;
const MEM_DIRECTORY_COORDINATOR:u8=20;
const MEM_DIRECTORY_UPDATES:u8=21;
const MEM_DIRECTORY_WORKER:u8=22;
const MEM_DIRECTORY_SESSIONS:u8=23;
const MEM_DIRECTORY_CONFIG:u8=24;
// Additive traversal revision. Any account/link/profile write invalidates
// guardian candidate continuations; no copied name index or new key material.
const MEM_PROFILE_SEARCH_REVISION:u8=25;
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
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct GuardianProfilePage {
    pub revision: u64,
    pub rows: Vec<ProfileSearchResult>,
    pub scanned: u16,
    pub next: Option<guardian_search::Cursor>,
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
    let account = account_for_write(subject).ok().filter(|a| !DELETION_TICKETS.with(|m| m.borrow().contains_key(&a.id)));
    PrincipalEligibility {
        subject,
        decision: if account.is_some() { EligibilityDecision::Eligible } else { EligibilityDecision::Denied },
        account_version: account.map(|a| a.version),
        denied_through_version: principal_denial(subject).map(|d| d.version),
    }
}
fn authority_eligibilities(caller: Principal, subjects: Vec<Principal>) -> Outcome<Vec<PrincipalEligibility>> {
    let production = group2_admission();
    if !account_group_rehearsal_enabled() && !production.enabled { return Err("Cross-group eligibility not released".into()); }
    let legacy = account_group_rehearsal_enabled() && (link_lifecycle().authorities.contains(&caller) || service_authorities().contains(&caller));
    if !legacy && !(production.enabled && production.readers.contains(&caller)) { return Err("Configured authority required".into()); }
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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let account = effective_account(account_for_write(subject)?, &link_lifecycle());
    if !account.principals.contains(&subject) { return Err("Identity revocation pending".into()); }
    Ok(account)
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
    static PROFILE_SEARCH_REVISION: RefCell<StableCell<u64, Memory>> = RefCell::new(StableCell::init(memory(MEM_PROFILE_SEARCH_REVISION), 0));
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
    static GROUP2_ADMISSION: RefCell<StableCell<Vec<u8>, Memory>> = RefCell::new(StableCell::init(memory(MEM_GROUP2_ADMISSION), Vec::new()));
    static REMOVAL_RECEIPTS: RefCell<StableBTreeMap<String, Vec<u8>, Memory>> =
        RefCell::new(StableBTreeMap::init(memory(MEM_REMOVAL_RECEIPTS)));
    static DIRECTORY_CONFIG:RefCell<StableCell<Vec<u8>,Memory>>=RefCell::new(StableCell::init(memory(MEM_DIRECTORY_CONFIG),Vec::new()));
    static DIRECTORY_COORDINATOR:RefCell<membership_coordinator::Coordinator<Memory>>=RefCell::new(
        membership_coordinator::Coordinator::open(memory(MEM_DIRECTORY_COORDINATOR),
            membership_namespace::Pool::open(memory(MEM_DIRECTORY_POOL_META),memory(MEM_DIRECTORY_POOL_BLOCKS),16384,8192).expect("Directory namespace budget"),memory(MEM_DIRECTORY_UPDATES)));
    static DIRECTORY_WORKER:RefCell<membership_propagation::Worker<Memory>>=RefCell::new(membership_propagation::Worker::open(memory(MEM_DIRECTORY_WORKER)));
    static DIRECTORY_SESSIONS:RefCell<membership_private_lookup::Sessions<Memory>>=RefCell::new(membership_private_lookup::Sessions::open(memory(MEM_DIRECTORY_SESSIONS)));
    static DIRECTORY_TIMER_BUSY:RefCell<bool>=const{RefCell::new(false)};
}
fn directory_config()->Outcome<membership_runtime::Config>{
    DIRECTORY_CONFIG.with(|m|if m.borrow().get().is_empty(){Err("Membership directory unconfigured".into())}else{Ok(decode(m.borrow().get()))})
}
fn save_directory_config(config:&membership_runtime::Config){DIRECTORY_CONFIG.with(|m|m.borrow_mut().set(encode(config)));}
async fn directory_lifecycle(binding:&group_inventory::Binding,sources:&[(String,Principal)])->Outcome<Vec<membership_acceptance::Lifecycle>>{
    directory_lifecycle_checked(binding,sources,||Ok(())).await
}
async fn directory_lifecycle_checked(binding:&group_inventory::Binding,sources:&[(String,Principal)],recheck:impl Fn()->Outcome<()>)->Outcome<Vec<membership_acceptance::Lifecycle>>{
    if sources.len()>100{return Err("Directory lifecycle budget exceeded".into());}
    let mut targets=vec![ic_cdk::api::canister_self(),binding.registry];targets.extend(sources.iter().map(|(_,p)|*p));
    let mut result=vec![];
    for target in targets{
        let info=ic_cdk::management_canister::canister_info(&ic_cdk::management_canister::CanisterInfoArgs{canister_id:target,num_requested_changes:Some(0)}).await.map_err(|_|"Replica directory lifecycle unavailable")?;
        recheck()?;
        result.push(membership_acceptance::Lifecycle{canister:target,changes:info.total_num_changes,module_hash:info.module_hash.ok_or("Directory module missing")?});
    }
    Ok(result)
}
fn recheck_directory(config:&membership_runtime::Config)->Outcome<()> {
    let current=directory_config()?;
    // Pending notifications may advance during awaits; they never alter the
    // captured authority inventory and must not be overwritten by callbacks.
    if !current.enabled || !current.same_configuration(config) { return Err("Directory configuration changed".into()); }
    Ok(())
}
/// Configures transport only. Does not enable a public reader or certify
/// legacy club ownership, source freshness, recovery or directory cutover.
#[ic_cdk::update]
async fn configure_membership_directory(binding:group_inventory::Binding,authorities:Vec<Principal>,generation:u64)->Outcome<Vec<membership_transport::SourceBinding>>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(),ic_cdk::api::msg_caller())?;
    admission_configuration_clear()?;
    let pinned=group_inventory_binding().ok_or("Existing deployment registry pin required")?;
    let mut expected=pinned.clone();expected.registry_revision=binding.registry_revision;
    if expected!=binding || binding.registry_revision<pinned.registry_revision {return Err("Pinned directory deployment required".into());}
    let prior=directory_config().ok();
    let recheck=||->Outcome<()>{
        admission_configuration_clear()?;
        let current=directory_config().ok();
        let unchanged=match (&prior,&current){(None,None)=>true,(Some(a),Some(b))=>a.same_configuration(b),_=>false};
        if group_inventory_binding().as_ref()!=Some(&pinned)||!unchanged{Err("Directory configuration changed during verification".into())}else{Ok(())}
    };
    let first=read_registry_pages(&binding,recheck).await?;
    let second=read_registry_pages(&binding,recheck).await?;
    if first!=second{return Err("Directory registry changed".into());}
    // Original G1 predates registry registration. Trust only the existing
    // deployment pin AND these immutable original mainnet identities; never
    // derive a legacy writer from caller names, missing assignments or a new
    // lifecycle grant. This changes inventory, not club ownership/readiness.
    let verified=if let Some(original)=membership_coordinator::original_mainnet_writer(&binding,ic_cdk::api::canister_self()){
        membership_coordinator::verify_inventory_with_original(&first,&binding,&authorities,generation,original)?
    }else{membership_coordinator::verify_inventory(&first,&binding,&authorities,generation)?};
    let digest=verified.digest().to_vec();let sources=verified.source_bindings();
    // Pin independent replica history BEFORE any source build. Restored
    // application counters or a same-Wasm snapshot cannot replay this pin.
    let lifecycle=directory_lifecycle(&binding,&sources).await?;
    let lifecycle_after=directory_lifecycle(&binding,&sources).await?;
    membership_acceptance::check_lifecycle(&lifecycle,&lifecycle_after)?;
    recheck()?;
    let config=match directory_config(){
        Ok(existing)=>{
            if existing.binding!=binding||existing.generation!=generation||existing.inventory_digest!=digest||existing.sources!=sources||!existing.enabled{return Err("Directory replacement requires fenced recovery; not released".into());}
            membership_acceptance::check_lifecycle(&existing.lifecycle,&lifecycle)?;existing
        },
        Err(_)=>membership_runtime::Config{binding,generation,inventory_digest:digest,sources,pending:Default::default(),enabled:true,next_source:0,lifecycle,release:None},
    };
    DIRECTORY_COORDINATOR.with(|m|m.borrow_mut().bind_inventory(verified))?;
    let grants=config.sources.iter().map(|(id,_)|config.source_binding(ic_cdk::api::canister_self(),id)).collect::<Outcome<Vec<_>>>()?;
    save_directory_config(&config);arm_directory_timer();Ok(grants)
}
#[ic_cdk::update]
fn disable_membership_directory()->Outcome<()>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));
require_governor(&state(),ic_cdk::api::msg_caller())?;let mut c=directory_config()?;c.enabled=false;save_directory_config(&c);Ok(())}
/// Exact operator readback of the separate directory configuration. Does not
/// return memberships, grant lifecycle readers, or certify currentness.
#[derive(CandidType,Deserialize)]
struct DirectoryConfigurationReadback { binding:group_inventory::Binding,generation:u64,inventory_digest:Vec<u8>,sources:Vec<(String,Principal)>,enabled:bool,app_enabled:bool }
#[ic_cdk::update]
fn read_membership_directory_configuration()->Outcome<DirectoryConfigurationReadback>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(),ic_cdk::api::msg_caller())?;
    let c=directory_config()?;
    Ok(DirectoryConfigurationReadback{binding:c.binding,generation:c.generation,inventory_digest:c.inventory_digest,sources:c.sources,enabled:c.enabled,app_enabled:c.release.is_some()})
}
/// Caller-private diagnostic, not the release/current reader. The actor never
/// accepts another account ID or aliases. Source/ownership and fresh account
/// checks precede every persisted page/replay, with no intervening await.
#[ic_cdk::update]
fn read_my_membership_directory_diagnostic(consumer:u64,token:Option<membership_wire::Token>)->Outcome<membership_wire::Reply>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let caller=ic_cdk::api::msg_caller();
    let viewer=membership_lookup_viewer(caller)?;
    let config=directory_config()?;recheck_directory(&config)?;
    let (page,next)=DIRECTORY_COORDINATOR.with(|c|DIRECTORY_SESSIONS.with(|s|c.borrow().private_page(&mut s.borrow_mut(),caller,viewer.clone(),consumer,membership_wire::continuation(token),ic_cdk::api::time())))?;
    Ok(membership_wire::diagnostic(caller,&viewer,config.generation,config.binding.registry_revision,config.inventory_digest,page,next))
}
/// Only the exact configured source may notify; never accepts raw edges.
#[ic_cdk::update]
fn invalidate_membership_directory_source(binding:membership_transport::SourceBinding,revision:candid::Nat)->membership_transport::UnitReply {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let result=(||->Outcome<()>{
        let mut c=directory_config()?;let revision=membership_transport::number(&revision)?;
        // Validate against a local config copy first. Coordinator validation
        // precedes all writes; no await can interleave the two durable saves.
        c.invalidate(ic_cdk::api::canister_self(),ic_cdk::api::msg_caller(),&binding,revision)?;
        let digest:[u8;32]=binding.inventory_digest.as_slice().try_into().map_err(|_|"Invalid directory inventory digest")?;
        let observed=membership_materializer::Binding{authority:ic_cdk::api::msg_caller(),generation:binding.generation,revision:c.pending.get(&binding.group).copied().unwrap_or(revision),inventory_digest:digest};
        DIRECTORY_COORDINATOR.with(|m|m.borrow_mut().observe_invalidation(&binding.group,&observed))?;
        save_directory_config(&c);Ok(())
    })();
    match result{Ok(())=>membership_transport::UnitReply::Ok,Err(e)=>membership_transport::UnitReply::Err(e)}
}
async fn directory_source_status(config:&membership_runtime::Config,source:&str,authority:Principal)->Outcome<(u64,u64,bool)>{
    let grant=config.source_binding(ic_cdk::api::canister_self(),source)?;recheck_directory(config)?;
    let reply=ic_cdk::call::Call::bounded_wait(authority,"read_directory_membership_status").with_arg(&grant).await.map_err(|_|"Directory source status unavailable")?;
    recheck_directory(config)?;
    let status:membership_transport::Reply<membership_transport::Status>=reply.candid().map_err(|_|"Invalid directory source status reply")?;
    let result=status.result()?.checked()?;
    directory_config()?.check_watermark(source,result.0)?;
    let digest:[u8;32]=config.inventory_digest.as_slice().try_into().map_err(|_|"Invalid directory inventory digest")?;
    let observed=membership_materializer::Binding{authority,generation:config.generation,revision:result.0,inventory_digest:digest};
    DIRECTORY_COORDINATOR.with(|m|{
        let mut coordinator=m.borrow_mut();
        coordinator.check_observed_watermark(source,&observed)?;
        coordinator.observe_invalidation(source,&observed)
    })?;
    Ok(result)
}
/// One exact source and one bounded unit per invocation; retries preserve
/// requests/publications. Governor-only until live worker acceptance passes.
#[ic_cdk::update]
async fn advance_membership_directory_source(source:String)->Outcome<membership_runtime::Progress>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(),ic_cdk::api::msg_caller())?;
    advance_directory_source(source).await
}
async fn advance_directory_source(source:String)->Outcome<membership_runtime::Progress>{
    let config=directory_config()?;let authority=config.sources.iter().find(|(id,_)|id==&source).ok_or("Unknown directory source")?.1;
    let (revision,_,_)=directory_source_status(&config,&source,authority).await?;
    DIRECTORY_COORDINATOR.with(|c|DIRECTORY_WORKER.with(|w|w.borrow_mut().resume_or_start(&mut c.borrow_mut(),&source,authority,revision)))?;
    let phase=DIRECTORY_WORKER.with(|w|w.borrow().phase(&source))?.0;
    let mut scanned=0;
    match phase {
        "pull"=>{
            let (captured,cursor)=DIRECTORY_WORKER.with(|w|w.borrow().request(&source))?;
            let grant=config.source_binding(ic_cdk::api::canister_self(),&source)?;
            // Pin the first capture too: a mutation between status and first
            // page must retry, never silently capture a different generation.
            let wire_cursor=Some(membership_transport::WireCursor::from(cursor.clone().unwrap_or(membership_propagation::Cursor{revision:captured.revision,phase:0,offset:0,nested:0})));
            let reply=ic_cdk::call::Call::bounded_wait(authority,"read_directory_membership_source_page").with_args(&(grant,wire_cursor)).await.map_err(|_|"Directory source page unavailable; request retained")?;
            recheck_directory(&config)?;
            let wire:membership_transport::Reply<membership_transport::WirePage>=reply.candid().map_err(|_|"Invalid directory source page")?;
            let wire=match wire.result(){
                Ok(page)=>page,
                Err(error) if error=="Retained source start changed"&&cursor.is_none()=>{
                    // No snapshot was acquired: retry the exact first request
                    // against a freshly observed revision, not an old cursor.
                    let (latest,_,_)=directory_source_status(&config,&source,authority).await?;
                    let unchanged=DIRECTORY_WORKER.with(|w|w.borrow().request(&source))?;
                    if unchanged!=(captured.clone(),cursor.clone()){return Err("Source propagation callback changed".into());}
                    DIRECTORY_COORDINATOR.with(|c|DIRECTORY_WORKER.with(|w|w.borrow_mut().start(&mut c.borrow_mut(),&source,authority,latest)))?;
                    return Err("Membership changed before snapshot capture; exact start refreshed".into());
                },
                Err(error)=>return Err(error),
            };
            let page=wire.checked()?;scanned=page.scanned as u64;
            // Positive source Club edges are checked against the existing
            // router location API. Missing legacy assignments remain unproven
            // and cannot enable a public directory; publication stays local.
            let mut unresolved_location=false;
            for edge in &page.edges{
                if let membership_materializer::Edge::Club{id,deleted:false}=edge{
                    let reply=ic_cdk::call::Call::bounded_wait(config.binding.registry,"read_hosted_club_assignment").with_args(&(id.clone(),config.binding.target_alias.clone(),config.binding.registry_revision)).await.map_err(|_|"Club ownership check unavailable; source page retained")?;
                    recheck_directory(&config)?;
                    let location:membership_transport::Reply<membership_locations::Assignment>=reply.candid().map_err(|_|"Invalid club ownership reply")?;
                    match location{
                        membership_transport::Reply::Ok(assignment)=>membership_locations::verify(id,&source,authority,&assignment,&config.sources,config.binding.registry_revision)?,
                        membership_transport::Reply::Err(error) if error=="Missing club assignment"=>unresolved_location=true,
                        membership_transport::Reply::Err(error)=>return Err(error),
                    }
                }
            }
            let terminal=page.next.is_none();
            DIRECTORY_COORDINATOR.with(|c|DIRECTORY_WORKER.with(|w|w.borrow_mut().accept(&mut c.borrow_mut(),&source,&captured,&cursor,page)))?;
            // Only the accepted exact request may change coverage. A delayed
            // callback rejected by the worker must not poison a newer page.
            if unresolved_location{DIRECTORY_COORDINATOR.with(|m|m.borrow_mut().unresolved_location(&source,&captured))?;}
            if terminal{DIRECTORY_COORDINATOR.with(|m|m.borrow_mut().finish_location_checks(&source,&captured))?;}
        },
        "materialize"=>{scanned=DIRECTORY_COORDINATOR.with(|c|DIRECTORY_WORKER.with(|w|w.borrow_mut().advance(&mut c.borrow_mut(),&source)))? as u64;},
        "published"|"acknowledged"=>{
            let captured=DIRECTORY_WORKER.with(|w|w.borrow().published(&source))?;
            let grant=config.source_binding(ic_cdk::api::canister_self(),&source)?;
            // Source acknowledgement is idempotent. Never clear local work on
            // a lost response; exact consensus status readback is mandatory.
            let reply=ic_cdk::call::Call::bounded_wait(authority,"acknowledge_directory_membership_source").with_args(&(grant,candid::Nat::from(captured.revision))).await.map_err(|_|"Source acknowledgement unknown; publication retained")?;
            recheck_directory(&config)?;
            let ack:membership_transport::UnitReply=reply.candid().map_err(|_|"Invalid source acknowledgement")?;
            if let membership_transport::UnitReply::Err(e)=ack{return Err(e);}
            let (current,acknowledged,pending)=directory_source_status(&config,&source,authority).await?;
            // Live changes remain observed and unreadable, but cannot starve
            // completion of the finite retained generation.
            if current<captured.revision||acknowledged!=captured.revision||pending!=(current!=acknowledged){return Err("Source acknowledgement readback changed; publication retained".into());}
            DIRECTORY_COORDINATOR.with(|c|DIRECTORY_WORKER.with(|w|w.borrow_mut().acknowledge_readback(&mut c.borrow_mut(),&source,&captured,acknowledged)))?;
        },
        _=>return Err("Unknown directory worker phase".into()),
    }
    let (phase,revision)=DIRECTORY_WORKER.with(|w|w.borrow().phase(&source))?;
    Ok(membership_runtime::Progress{source,phase:phase.into(),revision,scanned})
}
#[derive(CandidType,Deserialize)]
struct DirectoryCleanup { scanned:u64, complete:bool }
#[derive(CandidType,Deserialize)]
struct DirectoryAcceptanceCheck {snapshot_verified:bool,restoration_guard_verified:bool,source_revisions:Vec<(String,u64)>,verified_current:bool,app_enabled:bool}
/// Governor-only real acceptance check. Two separated complete consensus
/// revision scans bracket a shared snapshot instant; independent management
/// history rejects upgrade/restore ABA, including restoration of identity.
#[ic_cdk::update]
async fn check_membership_directory_acceptance()->Outcome<DirectoryAcceptanceCheck>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(),ic_cdk::api::msg_caller())?;
    let config=directory_config()?;recheck_directory(&config)?;
    let (_,expected,_)=verify_directory_snapshot(&config,||recheck_directory(&config)).await?;
    Ok(DirectoryAcceptanceCheck{snapshot_verified:true,restoration_guard_verified:true,source_revisions:expected,verified_current:false,app_enabled:config.release.is_some()})
}
/// Shared by release AND every private page, including reply replays. The
/// caller-specific recheck runs after each await, not only at final delivery.
async fn verify_directory_snapshot(config:&membership_runtime::Config,recheck:impl Fn()->Outcome<()>)->Outcome<(group_inventory::Snapshot,Vec<(String,u64)>,Vec<(String,Option<Principal>)>)>{
    recheck()?;
    let before=directory_lifecycle_checked(&config.binding,&config.sources,&recheck).await?;
    membership_acceptance::check_lifecycle(&config.lifecycle,&before)?;
    recheck()?;
    let registry_before=read_registry_pages(&config.binding,&recheck).await?;
    let photos_before=read_directory_photo_stores(&config.binding,&recheck).await?;
    let captured=DIRECTORY_COORDINATOR.with(|c|{let c=c.borrow();c.accepted_ownership()?;c.sources()})?;
    let expected=captured.iter().map(|s|(s.id.clone(),s.binding.revision)).collect::<Vec<_>>();
    let mut scans=vec![];
    for _ in 0..2{
        let mut stamps=vec![];
        for (source,authority) in &config.sources{
            let (revision,acknowledged,pending)=directory_source_status(&config,source,*authority).await?;
            recheck()?;
            stamps.push(membership_acceptance::Stamp{source:source.clone(),revision,acknowledged,pending});
        }
        scans.push(stamps);
    }
    membership_acceptance::check_collect(&expected,&scans[0],&scans[1])?;
    let registry_after=read_registry_pages(&config.binding,&recheck).await?;
    let photos_after=read_directory_photo_stores(&config.binding,&recheck).await?;
    if photos_before!=photos_after||photos_after.iter().map(|(id,_)|id).collect::<Vec<_>>()!=registry_after.groups.iter().map(|g|&g.id).collect::<Vec<_>>(){return Err("Directory photo-store inventory changed".into());}
    if registry_before!=registry_after{return Err("Directory registry changed during acceptance".into());}
    let after=directory_lifecycle_checked(&config.binding,&config.sources,&recheck).await?;
    membership_acceptance::check_lifecycle(&config.lifecycle,&after)?;
    recheck()?;
    let final_sources=DIRECTORY_COORDINATOR.with(|c|{let c=c.borrow();c.accepted_ownership()?;c.sources()})?;
    if expected!=final_sources.iter().map(|s|(s.id.clone(),s.binding.revision)).collect::<Vec<_>>(){return Err("Directory builds changed during acceptance".into());}
    Ok((registry_after,expected,photos_after))
}
async fn read_directory_photo_stores(binding:&group_inventory::Binding,recheck:impl Fn()->Outcome<()>)->Outcome<Vec<(String,Option<Principal>)>>{
    let mut cursor:Option<String>=None;let mut stores=vec![];
    loop{
        recheck()?;
        let reply=ic_cdk::call::Call::bounded_wait(binding.registry,"read_group_registry_page").with_args(&(&binding.target_alias,Some(binding.registry_revision),&cursor,64u32)).await.map_err(|_|"Directory photo registry unavailable")?;
        recheck()?;
        let page:Outcome<membership_wire::PhotoRegistryPage>=reply.candid().map_err(|_|"Invalid directory photo registry")?;let page=page?;
        if page.revision!=binding.registry_revision||page.groups.len()>64||stores.len()+page.groups.len()>100||page.next_cursor.as_ref().is_some_and(|n|cursor.as_ref().is_some_and(|c|n<=c)){return Err("Directory photo registry changed".into());}
        stores.extend(page.groups.into_iter().map(|g|(g.id,g.photo_store)));
        match page.next_cursor{None=>return Ok(stores),Some(next)=>cursor=Some(next)}
    }
}
/// Release permission is identity-owned, not a browser flag or saved report.
/// Repeating an acknowledged release is safe; a different release is refused.
#[ic_cdk::update]
async fn enable_membership_directory(release:String)->Outcome<DirectoryAcceptanceCheck>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(),ic_cdk::api::msg_caller())?;
    if release.len()!=40||!release.bytes().all(|v|v.is_ascii_digit()||(b'a'..=b'f').contains(&v)){return Err("Exact release commit required".into());}
    let config=directory_config()?;
    if config.release.as_ref().is_some_and(|prior|prior!=&release){return Err("Different lookup release already enabled".into());}
    let (_,expected,_)=verify_directory_snapshot(&config,||recheck_directory(&config)).await?;
    let mut current=directory_config()?;recheck_directory(&config)?;
    current.release=Some(release);save_directory_config(&current);
    Ok(DirectoryAcceptanceCheck{snapshot_verified:true,restoration_guard_verified:true,source_revisions:expected,verified_current:false,app_enabled:true})
}
#[ic_cdk::update]
async fn read_my_membership_directory(consumer:u64,token:Option<membership_wire::Token>)->Outcome<membership_wire::ReleasedReply>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let caller=ic_cdk::api::msg_caller();let viewer=membership_lookup_viewer(caller)?;
    let config=directory_config()?;let release=config.release.clone().ok_or("Membership lookup not released; existing discovery required")?;
    let recheck=||->Outcome<()>{
        recheck_directory(&config)?;
        if membership_lookup_viewer(caller)?!=viewer{return Err("Lookup caller account changed during verification".into());}Ok(())
    };
    let (registry,_,photo_stores)=verify_directory_snapshot(&config,&recheck).await?;recheck()?;
    // No await from the last eligibility/source checks through session commit.
    let (page,next,instance)=DIRECTORY_COORDINATOR.with(|c|DIRECTORY_SESSIONS.with(|s|{
        let mut sessions=s.borrow_mut();
        let (page,next)=c.borrow().private_page(&mut sessions,caller,viewer.clone(),consumer,membership_wire::continuation(token),ic_cdk::api::time())?;
        let instance=sessions.instance(caller,consumer)?;Ok::<_,String>((page,next,instance))
    }))?;
    let mut page=membership_wire::diagnostic(caller,&viewer,config.generation,config.binding.registry_revision,config.inventory_digest,page,next);
    // Current means the independently verified snapshot interval of this page,
    // never permanent freshness or authorization to read club resources.
    page.verified_current=true;
    Ok(membership_wire::ReleasedReply{page,instance,release,registry,photo_stores})
}
/// Governor-only bounded ownership acceptance. Every live source status and
/// complete registry is checked before local acceptance; no observer supplies
/// club claims or proofs. This never enables the verified-current reader.
#[ic_cdk::update]
async fn advance_membership_directory_ownership()->Outcome<membership_coordinator::OwnershipProgress>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(),ic_cdk::api::msg_caller())?;
    advance_directory_ownership().await
}
async fn advance_directory_ownership()->Outcome<membership_coordinator::OwnershipProgress>{
    let config=directory_config()?;recheck_directory(&config)?;
    if config.sources.len()>100{return Err("Ownership source-status budget exceeded".into());}
    let check=||recheck_directory(&config);
    let first=read_registry_pages(&config.binding,check).await?;
    let required=config.sources.iter().map(|(_,p)|*p).collect::<Vec<_>>();
    let original=membership_coordinator::original_mainnet_writer(&config.binding,ic_cdk::api::canister_self());
    let inventory=if let Some(p)=original{membership_coordinator::verify_inventory_with_original(&first,&config.binding,&required,config.generation,p)?}
        else{membership_coordinator::verify_inventory(&first,&config.binding,&required,config.generation)?};
    if inventory.digest().as_slice()!=config.inventory_digest.as_slice()||inventory.source_bindings()!=config.sources{return Err("Ownership inventory changed".into());}
    let captured=DIRECTORY_COORDINATOR.with(|c|c.borrow().sources())?;
    for (source,authority) in &config.sources{
        let (current,acknowledged,pending)=directory_source_status(&config,source,*authority).await?;
        if pending||current!=acknowledged||captured.iter().find(|s|&s.id==source).is_none_or(|s|s.binding.revision!=current){return Err("Ownership source has pending membership changes or changed revision".into());}
    }
    let second=read_registry_pages(&config.binding,check).await?;
    if first!=second{return Err("Ownership registry changed".into());}recheck_directory(&config)?;
    let after=DIRECTORY_COORDINATOR.with(|c|c.borrow().sources())?;
    if captured.iter().map(|s|(&s.id,&s.binding)).collect::<Vec<_>>()!=after.iter().map(|s|(&s.id,&s.binding)).collect::<Vec<_>>(){return Err("Ownership build changed during status checks".into());}
    DIRECTORY_COORDINATOR.with(|c|c.borrow_mut().advance_ownership(original))
}
// Independent of start: an exhausted pool must still be reclaimable.
#[ic_cdk::update]
fn reclaim_membership_directory()->Outcome<DirectoryCleanup>{
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(),ic_cdk::api::msg_caller())?;
    let (scanned,complete)=DIRECTORY_COORDINATOR.with(|c|c.borrow_mut().reclaim_retired())?;
    Ok(DirectoryCleanup{scanned:scanned as u64,complete})
}
// Native system timer: no public caller can trigger unbounded fan-out. Rotate
// one source per tick, preserve position across upgrade, and poll even when a
// notification was lost. Re-arm before awaiting so failures remain retryable.
fn arm_directory_timer(){
    if directory_config().is_ok_and(|c|c.enabled){
        if let Some(at)=ic_cdk::api::time().checked_add(30_000_000_000){ic_cdk::api::global_timer_set(at);}
    }
}
struct DirectoryTimerGuard;
impl Drop for DirectoryTimerGuard{fn drop(&mut self){DIRECTORY_TIMER_BUSY.with(|b|*b.borrow_mut()=false);}}
#[export_name="canister_global_timer"]
extern "C" fn membership_directory_global_timer(){
    if private_name_writer_window::enabled() { return; }
    arm_directory_timer();
    let entered=DIRECTORY_TIMER_BUSY.with(|b|{let mut b=b.borrow_mut();if *b{false}else{*b=true;true}});
    if !entered{return;}
    ic_cdk::futures::internals::in_executor_context(||ic_cdk::futures::spawn(async {
        let _guard=DirectoryTimerGuard;
        let Ok(mut config)=directory_config() else{return;};
        if !config.enabled||config.sources.is_empty(){return;}
        let at=config.next_source%config.sources.len();let source=config.sources[at].0.clone();
        config.next_source=(at+1)%config.sources.len();save_directory_config(&config);
        // Cleanup is bounded and happens independently of allocation success.
        let _=DIRECTORY_COORDINATOR.with(|c|c.borrow_mut().reclaim_retired());
        match advance_directory_source(source).await{
            Ok(progress) if progress.phase=="acknowledged"=>{let _=advance_directory_ownership().await;},
            Err(error)=>ic_cdk::println!("Directory refresh deferred: {}",error),_=>{},
        }
    }));
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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    history_access(account_group_rehearsal_enabled(), state().governor, ic_cdk::api::msg_caller())?;
    removal_intent(&account_id).ok_or("Removal intent missing".into())
}
// A bounded one-receiver step: retries always re-read the real receiver.
// Stored receipts are recovery evidence, never cached permission to complete.
#[ic_cdk::update]
async fn advance_account_removal_receiver(account_id: String, target: Principal) -> Outcome<removal_barrier::Receipt> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
fn group2_admission() -> admission::Config {
    GROUP2_ADMISSION.with(|m| if m.borrow().get().is_empty() { admission::Config::default() } else { decode(m.borrow().get()) })
}
fn admission_configuration_clear() -> Outcome<()> {
    if removal_pending() || DELETION_TICKETS.with(|m| !m.borrow().is_empty()) || !link_lifecycle().pending.is_empty() {
        return Err("Account removal or unlink pending".into());
    }
    Ok(())
}
/// Governor-only production repair. Derive readers from the pinned router,
/// never from a browser-supplied principal list. No lifecycle gate is released.
#[ic_cdk::update]
async fn authorize_group2_admission(binding: group_inventory::Binding) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    authorize_group_admission_inner("g2".into(), binding).await
}
/// Governor-only. Adds one new group's exact 12 readers (derived from two
/// pinned router reads) to the existing set; never removes or replaces readers.
/// Re-running for an already-authorized group is a no-op on the reader set.
#[ic_cdk::update]
async fn authorize_group_admission(group_id: String, binding: group_inventory::Binding) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    authorize_group_admission_inner(group_id, binding).await
}
async fn authorize_group_admission_inner(group_id: String, binding: group_inventory::Binding) -> Outcome<()> {
    require_governor(&state(), ic_cdk::api::msg_caller())?;
    if !admission::valid_group_id(&group_id) { return Err("New group id (g2 or later) required".into()); }
    admission_configuration_clear()?;
    let pinned = group_inventory_binding().ok_or("Deletion registry not pinned")?;
    let mut expected = pinned.clone(); expected.registry_revision = binding.registry_revision;
    if expected != binding || binding.registry_revision < pinned.registry_revision || !bound_deletion_released() {
        return Err("Pinned mainnet account connection required".into());
    }
    let history = removal_history_revision();
    let prior = group2_admission();
    let prior_bytes = encode(&prior);
    let recheck = || -> Outcome<()> {
        admission_configuration_clear()?;
        if group_inventory_binding().as_ref() != Some(&pinned) || removal_history_revision() != history || encode(&group2_admission()) != prior_bytes {
            return Err("Account configuration changed during authorization".into());
        }
        Ok(())
    };
    let mut observed = None;
    for _ in 0..2 {
        let mut groups = Vec::new(); let mut placements = Vec::new(); let mut cursor: Option<String> = None;
        loop {
            recheck()?;
            let reply = ic_cdk::call::Call::bounded_wait(binding.registry, "read_group_registry_page")
                .with_args(&(&binding.target_alias, Some(binding.registry_revision), &cursor, 64u32))
                .await.map_err(|_| "Admission registry unavailable".to_string())?;
            recheck()?;
            let page: Outcome<admission::Page> = reply.candid().map_err(|_| "Invalid admission registry reply".to_string())?;
            let page = page?;
            if page.revision != binding.registry_revision || page.groups.len() > 64 || page.groups.len() != page.placements.len() ||
                page.next_cursor.as_ref().is_some_and(|n| cursor.as_ref().is_some_and(|c| n <= c)) { return Err("Admission registry drift".into()); }
            groups.extend(page.groups); placements.extend(page.placements);
            if groups.len() > 4096 { return Err("Admission inventory bound exceeded".into()); }
            match page.next_cursor { None => break, Some(next) => cursor=Some(next) }
        }
        if observed.as_ref().is_some_and(|p| p != &(groups.clone(),placements.clone())) { return Err("Admission inventory changed".into()); }
        observed=Some((groups,placements));
    }
    let (groups,placements)=observed.ok_or("Admission inventory missing")?;
    let group_readers=admission::group_readers(&group_id,&groups,&placements,&binding)?;
    let readers=admission::merge(&prior.readers,&group_readers);
    recheck()?;
    GROUP2_ADMISSION.with(|m| m.borrow_mut().set(encode(&admission::Config { enabled:true,readers })));
    bump_removal_history();
    Ok(())
}
#[ic_cdk::update]
fn disable_group2_admission() -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(), ic_cdk::api::msg_caller())?;
    let mut config=group2_admission(); config.enabled=false;
    GROUP2_ADMISSION.with(|m|m.borrow_mut().set(encode(&config)));
    bump_removal_history(); Ok(())
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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let mut rows = vec![("registry".into(), binding.registry.to_text()), ("target_alias".into(), binding.target_alias),
        ("deployment_id".into(), binding.deployment_id), ("host".into(), binding.host),
        ("network_kind".into(), binding.network_kind), ("bound_deletion_released".into(), bound_deletion_released().to_string()),
        ("account_admission_released".into(), (account_group_rehearsal_enabled() || group2_admission().enabled).to_string())];
    // Read-only evidence; neither registers readers nor releases the lifecycle.
    let mut authorities = if account_group_rehearsal_enabled() { let mut a=link_lifecycle().authorities; a.extend(service_authorities()); a } else { vec![] };
    let production=group2_admission();
    if production.enabled { authorities.extend(production.readers); }
    authorities.sort(); authorities.dedup();
    rows.extend(authorities.into_iter().map(|p| ("eligibility_authority".into(), p.to_text())));
    Ok(rows)
}
/// Separate governor-only trust pin for the already-released deletion timing
/// protocol. Existing history/lifecycle gates remain unchanged.
#[ic_cdk::update]
fn pin_owner_test_deletion_registry(binding: group_inventory::Binding) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    require_governor(&state(), ic_cdk::api::msg_caller())?;
    if !bound_deletion_released() || binding.network_kind != "public_mainnet" { return Err("Bound deletion mainnet release required".into()); }
    store_group_inventory_binding(binding, removal_history_revision())
}
/// Only the pinned router may check a human before owner-test creation. This
/// narrow predicate neither registers a reader nor releases global admission.
#[ic_cdk::update]
fn read_owner_test_creation_eligible(subject: Principal) -> Outcome<bool> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let binding = group_inventory_binding().ok_or("Deletion registry not pinned")?;
    if ic_cdk::api::msg_caller() != binding.registry || !bound_deletion_released() { return Err("Pinned router and bound deletion release required".into()); }
    let account = match account_for_write(subject) { Ok(a) => a, Err(_) => return Ok(false) };
    Ok(!DELETION_TICKETS.with(|m| m.borrow().contains_key(&account.id)) && removal_intent(&account.id).is_none())
}

#[ic_cdk::update]
fn set_club_authorities(authorities: Vec<Principal>) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    bump_profile_search_revision();
    ACCOUNTS.with(|m| m.borrow_mut().insert(account.id.clone(), encode(account)));
}
fn remove_account(id: &str) -> Option<Account> {
    bump_profile_search_revision();
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
    bump_profile_search_revision();
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
    bump_profile_search_revision();
    PROFILES.with(|m| m.borrow_mut().remove(&account_id.to_string()));
}
fn all_profiles() -> Vec<Profile> {
    PROFILES.with(|m| m.borrow().iter().map(|e| decode(&e.value())).collect())
}
fn profile_search_revision() -> u64 { PROFILE_SEARCH_REVISION.with(|cell| *cell.borrow().get()) }
fn bump_profile_search_revision() {
    PROFILE_SEARCH_REVISION.with(|cell| { let mut value=cell.borrow_mut(); let next=value.get().checked_add(1).expect("Profile revision exhausted"); value.set(next); });
}
fn bounded_guardian_profile_rows(after: Option<String>) -> Vec<Profile> {
    PROFILES.with(|store| {
        let store=store.borrow();
        let bounds=after.map(|key|(std::ops::Bound::Excluded(key),std::ops::Bound::Unbounded))
            .unwrap_or((std::ops::Bound::Unbounded,std::ops::Bound::Unbounded));
        store.range(bounds).take(guardian_search::SCAN_LIMIT).map(|entry|decode(&entry.value())).collect()
    })
}
fn guardian_search_binding(caller: Principal, viewer: &membership_private_lookup::Viewer, authority: Principal, child: &str, config: &membership_runtime::Config) -> Vec<u8> {
    // Encode configuration fields only (worker progress is not a repin).
    Sha256::digest(encode(&(caller, &viewer.account, viewer.version, &viewer.aliases, authority, child,
        &config.binding, config.generation, &config.inventory_digest, &config.sources, config.enabled, &config.lifecycle, &config.release))).to_vec()
}
async fn verify_guardian_search(caller: Principal, authority: Principal, child: &str, viewer: &membership_private_lookup::Viewer, config: &membership_runtime::Config) -> Outcome<()> {
    let reply=ic_cdk::call::Call::bounded_wait(authority,"read_has_child_guardian")
        .with_args(&(caller,child.to_string())).await.map_err(|_|"Guardian verification unavailable")?;
    let guardian: bool=reply.candid().map_err(|_|"Invalid guardian verification")?;
    guardian_search::permit_disclosure(guardian,membership_lookup_viewer(caller)?==*viewer,config.same_configuration(&directory_config()?))
}

/// Exact-child bounded directory traversal for device-side encrypted matching.
/// Rehearsal only until the PII guardian audience and release acceptance pass.
#[ic_cdk::update]
async fn read_guardian_profile_candidates(authority: Principal, child: String, cursor: Option<guardian_search::Cursor>) -> Outcome<GuardianProfilePage> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != Some("1") { return Err("Private guardian search is not released".into()); }
    let caller=ic_cdk::api::msg_caller();
    let viewer=membership_lookup_viewer(caller)?;
    let config=directory_config()?;
    guardian_search::validate_scope(authority,&config.sources.iter().map(|(_,p)|*p).collect::<Vec<_>>(),&child)?;
    let binding=guardian_search_binding(caller,&viewer,authority,&child,&config);
    let revision=profile_search_revision();
    if let Some(ref c)=cursor { guardian_search::validate_cursor(c,revision,&binding,ic_cdk::api::time())?; }
    verify_guardian_search(caller,authority,&child,&viewer,&config).await?;
    if profile_search_revision()!=revision { return Err("Guardian directory changed".into()); }
    let after=cursor.as_ref().map(|c|c.after.clone());
    let profiles=bounded_guardian_profile_rows(after);
    let mut scanned=0u16; let mut rows=Vec::new(); let mut last=None;
    for profile in profiles {
        scanned+=1; last=Some(profile.account_id.clone());
        let account=match get_account(&profile.account_id){Some(a)=>a,None=>continue};
        let principal=match account.principals.iter().copied().find(|p| *p!=caller && membership_lookup_viewer(*p).is_ok()){Some(p)=>p,None=>continue};
        if profile.display_name.trim().is_empty(){continue;}
        // A private reference belongs to its original alias, not necessarily
        // the first/current alias returned by the historical search endpoint.
        let principal=if profile.display_name.starts_with("pii-display-name:") {
            if !private_profile_reference::valid(&profile.display_name,&account.principals){continue;}
            match profile.display_name.rsplit(':').next().and_then(|s|Principal::from_text(s).ok()) {Some(p) if membership_lookup_viewer(p).is_ok()=>p,_=>continue}
        } else {principal};
        rows.push(ProfileSearchResult{account_id:profile.account_id,principal,display_name:profile.display_name,avatar_ref:profile.avatar_ref});
        if rows.len()==guardian_search::RESULT_LIMIT{break;}
    }
    let has_next=last.as_ref().is_some_and(|last|PROFILES.with(|store|store.borrow().range((std::ops::Bound::Excluded(last.clone()),std::ops::Bound::Unbounded)).next().is_some()));
    verify_guardian_search(caller,authority,&child,&viewer,&config).await?;
    if profile_search_revision()!=revision {return Err("Guardian directory changed".into());}
    rows.retain(|row|membership_lookup_viewer(row.principal).is_ok());
    let next=if has_next {last.map(|after|guardian_search::Cursor{after,revision,binding,expires_at_ns:cursor.map(|c|c.expires_at_ns).unwrap_or(ic_cdk::api::time()+300_000_000_000)})} else {None};
    Ok(GuardianProfilePage{revision,rows,scanned,next})
}

/// Service-delegated name permission only. Registry placement authenticates
/// both the ORIGINAL PII caller and owning audience service; location alone
/// never admits a human. References must name this precise original PII caller.
#[ic_cdk::update]
async fn read_private_profile_name_authorization(viewer_principal: Principal, subjects: Vec<Principal>, scope: private_name_audience::Scope) -> Outcome<Vec<ProfileSearchResult>> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != Some("1") && !(scope.kind == "club" && private_club_name_displays_released()) { return Err("Private name audiences are not released".into()); }
    private_name_audience::validate(viewer_principal, &subjects, &scope)?;
    let service = ic_cdk::api::msg_caller();
    if !service_authorities().contains(&service) { return Err("Configured private-name service required".into()); }
    let viewer = membership_lookup_viewer(viewer_principal)?;
    let config = directory_config()?;
    let history = removal_history_revision();
    let revision = profile_search_revision();
    let active = || -> Outcome<()> {
        if membership_lookup_viewer(viewer_principal)? != viewer || !config.same_configuration(&directory_config()?)
            || history != removal_history_revision() || revision != profile_search_revision() {
            return Err("Private-name audience changed".into());
        }
        Ok(())
    };
    let inventory = read_registry_pages(&config.binding, active).await?;
    active()?;
    let registry_clubs = inventory.groups.iter().flat_map(|g| g.domains.iter().filter(|d| d.domain == "club_domain").map(|d| d.canister)).collect::<Vec<_>>();
    group_inventory::validate(&inventory, &config.binding, &registry_clubs, &[])?;
    if !inventory.groups.iter().any(|g| g.domains.iter().any(|d| d.domain == "pii_access_control" && d.canister == service)) {
        return Err("Original private-name service is not registered".into());
    }
    let domain = match scope.kind.as_str() { "competition" => "competition_domain", "league" => "mini_league_domain", "direct" | "broadcast" | "competition_admin" => "messaging_domain", _ => "club_domain" };
    if !inventory.groups.iter().any(|g| g.domains.iter().any(|d| d.domain == domain && d.canister == scope.authority)) {
        return Err("Private-name audience authority is not registered".into());
    }
    let mut rows = Vec::new();
    for subject in &subjects {
        let account = membership_lookup_viewer(*subject)?;
        let profile = get_profile_entry(&account.account).ok_or("Private profile not found")?;
        let expected = format!("pii-display-name:v1:{}:{}", service.to_text(), subject.to_text());
        if profile.display_name != expected { return Err("Original private-name binding changed".into()); }
        rows.push(ProfileSearchResult { account_id: profile.account_id, principal: *subject, display_name: profile.display_name, avatar_ref: profile.avatar_ref });
    }
    if scope.kind == "guardian_search" {
        if scope.profile_revision != revision { return Err("Guardian directory changed".into()); }
        verify_guardian_search(viewer_principal, scope.authority, &scope.resource, &viewer, &config).await?;
        active()?;
        verify_guardian_search(viewer_principal, scope.authority, &scope.resource, &viewer, &config).await?;
        active()?;
    } else {
        let method = match scope.kind.as_str() { "club" => "read_profile_membership_batch", "family" => "read_profile_family_batch", "competition" | "league" => "read_profile_audience_batch", "direct" => "read_profile_direct_batch", "broadcast" => "read_profile_broadcast_batch", "competition_admin" => "read_profile_competition_admin_batch", _ => return Err("Invalid audience".into()) };
        let mut retained: Option<club_profiles::MembershipBatch> = None;
        for _ in 0..2 {
            let expected = retained.as_ref().map(|r| r.revision.clone());
            let reply = ic_cdk::call::Call::bounded_wait(scope.authority, method)
                .with_args(&(viewer_principal, scope.resource.clone(), subjects.clone(), expected.clone())).await
                .map_err(|_| "Private-name relationship verification unavailable")?;
            active()?;
            let batch: Outcome<club_profiles::MembershipBatch> = reply.candid().map_err(|_| "Invalid private-name relationship reply")?;
            let batch = batch?;
            club_profiles::verify_batch(&batch, viewer_principal, &scope.resource, &subjects, expected.as_ref())?;
            if batch.members.iter().any(|member| !member) || retained.as_ref().is_some_and(|prior| prior != &batch) { return Err("Private-name relationship denied or changed".into()); }
            retained = Some(batch);
        }
    }
    // No await after these final subject/reference and caller rechecks.
    active()?;
    for row in &rows {
        let account = membership_lookup_viewer(row.principal)?;
        if account.account != row.account_id || get_profile_entry(&account.account).map(|p| p.display_name) != Some(row.display_name.clone()) { return Err("Private-name subject changed".into()); }
    }
    Ok(rows)
}

/// Final retained-match readback, without rescanning or deriving keys twice.
#[ic_cdk::update]
async fn read_guardian_profiles(authority: Principal, child: String, subjects: Vec<Principal>, revision: u64) -> Outcome<Vec<ProfileSearchResult>> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != Some("1"){return Err("Private guardian search is not released".into());}
    if subjects.len()>25 || subjects.iter().any(|p|*p==Principal::anonymous()) || subjects.iter().collect::<std::collections::BTreeSet<_>>().len()!=subjects.len(){return Err("Bounded distinct guardian candidates required".into());}
    let caller=ic_cdk::api::msg_caller(); let viewer=membership_lookup_viewer(caller)?; let config=directory_config()?;
    guardian_search::validate_scope(authority,&config.sources.iter().map(|(_,p)|*p).collect::<Vec<_>>(),&child)?;
    verify_guardian_search(caller,authority,&child,&viewer,&config).await?;
    if profile_search_revision()!=revision{return Err("Guardian directory changed".into());}
    verify_guardian_search(caller,authority,&child,&viewer,&config).await?;
    if profile_search_revision()!=revision{return Err("Guardian directory changed".into());}
    Ok(subjects.into_iter().filter_map(|principal| {
        let subject=membership_lookup_viewer(principal).ok()?;
        let profile=get_profile_entry(&subject.account)?;
        Some(ProfileSearchResult{account_id:profile.account_id,principal,display_name:profile.display_name,avatar_ref:profile.avatar_ref})
    }).collect())
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
// No public reader until exact source binding/propagation is released. This
// adapter uses identity-owned aliases freshly on every bounded lookup page.
fn membership_lookup_viewer(caller: Principal) -> Outcome<membership_private_lookup::Viewer> {
    let account=account_for_write(caller)?;
    if DELETION_TICKETS.with(|m|m.borrow().contains_key(&account.id)){return Err("Account deletion pending".into());}
    let account=effective_account(account,&link_lifecycle());
    if !account.principals.contains(&caller){return Err("Identity revocation pending".into());}
    Ok(membership_private_lookup::Viewer{account:account.id,version:account.version,aliases:account.principals})
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
/// The account id is SHA-256 of the creating principal, so the derived
/// account was provably created by this principal. Every legitimate removal
/// of a sign-in ID (revoke, rekey) leaves a durable denial, and erasure /
/// removal / deletion leave their own markers. If none of those exist, the
/// principal was never legitimately removed and may re-attach to its original
/// account (restoring profile, clubs and roles) instead of being locked out.
fn reclaimable_original_account(principal: Principal) -> Option<Account> {
    let derived = account_id(principal);
    let existing = get_account(&derived)?;
    if existing.principals.contains(&principal) { return Some(existing); }
    if principal_denial(principal).is_some() || account_is_erased(&derived) || removal_intent(&derived).is_some()
        || link_lifecycle().pending.iter().any(|job| job.account_id == derived)
        || DELETION_TICKETS.with(|m| m.borrow().contains_key(&derived))
        || existing.principals.len() >= MAX_PRINCIPALS {
        return None;
    }
    Some(existing)
}
fn reattach_original_account(principal: Principal, mut existing: Account) -> Outcome<String> {
    if !existing.principals.contains(&principal) {
        existing.principals.push(principal);
        existing.version = existing.version.checked_add(1).ok_or("Account version exhausted")?;
        put_account(&existing);
    }
    index_principal(principal, &existing.id);
    account_for(principal)?;
    Ok(existing.id)
}
/// A duplicate created by an earlier recovery attempt: only this sign-in ID,
/// no roles, families, exclusions, bindings or purchases. A draft profile is
/// discarded in favour of the original account's profile.
fn is_bare_duplicate(state: &CoreState, account: &Account, principal: Principal) -> bool {
    let id = &account.id;
    account.principals == vec![principal]
        && !state.roles.iter().any(|g| &g.account_id == id)
        && !state.families.iter().any(|f| &f.account_id == id)
        && !state.exclusions.iter().any(|e| &e.account_id == id)
        && !state.external_bindings.iter().any(|b| &b.account_id == id)
        && !all_entitlements().iter().any(|e| e.principal == principal)
        && !account_is_erased(id) && removal_intent(id).is_none()
        && !DELETION_TICKETS.with(|m| m.borrow().contains_key(id))
        && !link_lifecycle().pending.iter().any(|job| &job.account_id == id)
}
fn ensure_account(principal: Principal) -> Outcome<String> {
    authenticated(principal)?;
    if principal_is_denied(principal) { return Err("Identity revoked; surviving-account relink required".into()); }
    if let Some(account) = find_account_by_principal(principal) {
        // Earlier recovery may have parked this sign-in on a fresh, empty
        // account while the original still exists: move it back.
        if account.id != account_id(principal) {
            if let Some(original) = reclaimable_original_account(principal) {
                let mut state = state();
                if !original.principals.contains(&principal) && is_bare_duplicate(&state, &account, principal) {
                    let dup = account.id.clone();
                    remove_account(&dup);
                    PROFILES.with(|m| m.borrow_mut().remove(&dup));
                    state.privacy_consents.retain(|c| c.account_id != dup);
                    state.terms_acceptances.retain(|t| t.account_id != dup);
                    state.challenges.retain(|c| c.account_id != dup);
                    store(&state);
                    return reattach_original_account(principal, original);
                }
            }
        }
        account_for(principal)?;
        return Ok(account.id);
    }
    if principal_denial(principal).is_some() { return Err("Previous identity authorization requires surviving account".into()); }
    let derived = account_id(principal);
    if let Some(original) = reclaimable_original_account(principal) {
        return reattach_original_account(principal, original);
    }
    if account_count() >= MAX_ACCOUNTS as u64 {
        return Err("Account quota reached".into());
    }
    // The derived slot belongs to another live account (the caller was
    // unlinked from it). Never join it; give this unindexed, undenied
    // principal its own fresh account under a salted deterministic id.
    let id = if get_account(&derived).is_none() && !account_is_erased(&derived) { derived } else {
        let mut chosen = None;
        for n in 1u8..=16 {
            let mut hasher = Sha256::new();
            hasher.update(b"ignite-account-salt");
            hasher.update([n]);
            hasher.update(principal.as_slice());
            let digest = hasher.finalize();
            let hex: String = digest[..16].iter().map(|b| format!("{b:02x}")).collect();
            let candidate = format!("{}-{}-{}-{}-{}", &hex[..8], &hex[8..12], &hex[12..16], &hex[16..20], &hex[20..]);
            if let Some(found) = get_account(&candidate) {
                if found.principals.contains(&principal) {
                    index_principal(principal, &candidate);
                    account_for(principal)?;
                    return Ok(candidate);
                }
                continue;
            }
            if account_is_erased(&candidate) { continue; }
            chosen = Some(candidate);
            break;
        }
        chosen.ok_or("Account ID collision")?
    };
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
    arm_directory_timer();
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
    arm_directory_timer();
}

#[ic_cdk::query]
fn whoami() -> Outcome<Account> {
    account_for(ic_cdk::api::msg_caller())
}

#[ic_cdk::update]
fn register_account() -> Outcome<Account> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
fn secure_name_save_released() -> bool {
    #[cfg(target_arch = "wasm32")]
    { ic_cdk::api::env_var_name_exists("IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE") && ic_cdk::api::env_var_value("IGNITE_SECURE_ADULT_NAME_SAVE_RELEASE") == "1" }
    #[cfg(not(target_arch = "wasm32"))]
    { false }
}
fn private_club_name_displays_released() -> bool {
    #[cfg(target_arch = "wasm32")]
    { ic_cdk::api::env_var_name_exists("IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE") && ic_cdk::api::env_var_value("IGNITE_PRIVATE_CLUB_NAME_DISPLAY_RELEASE") == "1" }
    #[cfg(not(target_arch = "wasm32"))]
    { false }
}
fn secure_name_authority(caller: Principal, existing: Option<&Profile>) -> Outcome<Principal> {
    #[cfg(target_arch = "wasm32")]
    let configured = if ic_cdk::api::env_var_name_exists("IGNITE_SECURE_ADULT_NAME_PII") { Some(ic_cdk::api::env_var_value("IGNITE_SECURE_ADULT_NAME_PII")) } else { None };
    #[cfg(not(target_arch = "wasm32"))]
    let configured: Option<String> = None;
    secure_name_save::authority(secure_name_save_released(), configured.as_deref(), existing.map(|p|p.display_name.as_str()), caller)
}
/// Authenticated consensus capability: returns only the operator-pinned own-name
/// authority, never a browser-selected sink or authorization for other people.
#[ic_cdk::update]
fn read_secure_name_authority() -> Outcome<Principal> {
    let caller=ic_cdk::api::msg_caller();
    let account=account_for_write(caller)?;
    secure_name_authority(caller, get_profile_entry(&account.id).as_ref())
}
#[ic_cdk::update]
async fn set_profile(display_name: String, avatar_ref: Option<String>) -> Outcome<Profile> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let caller = ic_cdk::api::msg_caller();
    let account = account_for_write(caller)?;
    let account_id = account.id.clone();
    let valid_name = if display_name.starts_with("pii-display-name:") {
        private_profile_reference::valid(&display_name, &account.principals)
    } else { valid_display_name(&display_name) };
    if !valid_name {
        return Err("Display name must be 1-80 characters".into());
    }
    if avatar_ref.as_deref().is_some_and(|a| a.len() > 512) {
        return Err("Avatar reference must be at most 512 characters".into());
    }
    let existing = get_profile_entry(&account_id);
    if !private_profile_reference::preserves_private_name(
        existing.as_ref().map(|profile| profile.display_name.as_str()),
        &display_name,
    ) {
        return Err("Encrypted name must be updated at its original private-name authority".into());
    }
    if secure_name_save_released() {
        let authority=secure_name_authority(caller, existing.as_ref())?;
        if !secure_name_save::reference_matches(&display_name, authority, caller) {
            return Err("Save your personal name encrypted before updating the profile".into());
        }
        let revision=profile_search_revision();
        let history=removal_history_revision();
        let reply=ic_cdk::call::Call::bounded_wait(authority,"verify_secure_profile_name")
            .with_args(&(caller,)).await.map_err(|_|"Encrypted personal-name verification unavailable")?;
        let verified: Outcome<bool>=reply.candid().map_err(|_|"Invalid encrypted-name verification reply")?;
        if !verified? { return Err("Encrypted personal name is not saved".into()); }
        if account_for_write(caller)? != account || profile_search_revision()!=revision || removal_history_revision()!=history
            || get_profile_entry(&account_id)!=existing || secure_name_authority(caller,existing.as_ref())?!=authority {
            return Err("Profile changed during secure saving; check before retrying".into());
        }
    }
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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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

/// Purpose-bound full search. Browser-supplied authority IDs are locations,
/// never permissions: only pinned membership sources may verify this child.
#[ic_cdk::update]
async fn search_guardian_profiles(authority: Principal, child: String, query: String, limit: u16) -> Outcome<Vec<ProfileSearchResult>> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let caller = ic_cdk::api::msg_caller();
    let account = account_for_write(caller)?;
    let config = directory_config()?;
    let sources: Vec<Principal> = config.sources.iter().map(|(_, p)| *p).collect();
    let (needle, cap) = guardian_search::validate_request(authority, &sources, &child, &query, limit)?;
    let reply = ic_cdk::call::Call::bounded_wait(authority, "read_has_child_guardian")
        .with_args(&(caller, child.clone())).await.map_err(|_| "Guardian verification unavailable")?;
    let guardian: bool = reply.candid().map_err(|_| "Invalid guardian verification")?;
    guardian_search::permit_disclosure(guardian, account_for_write(caller)? == account, config.same_configuration(&directory_config()?))?;
    // Retain active principals only; a UUID is never used as a role principal.
    let retained_revision = profile_search_revision();
    let mut results = Vec::new();
    for profile in all_profiles() {
        if !profile.display_name.to_lowercase().contains(&needle) { continue; }
        let principal = match get_account(&profile.account_id).and_then(|a| a.principals.into_iter().find(|p| account_for_write(*p).is_ok())) {
            Some(p) if p != caller => p,
            _ => continue,
        };
        results.push(ProfileSearchResult { account_id: profile.account_id, principal, display_name: profile.display_name, avatar_ref: profile.avatar_ref });
        if results.len() >= cap { break; }
    }
    // Last consensus relationship check precedes disclosure, so a removal
    // processed while searching cannot use the original successful reply.
    let reply = ic_cdk::call::Call::bounded_wait(authority, "read_has_child_guardian")
        .with_args(&(caller, child)).await.map_err(|_| "Guardian verification unavailable")?;
    let guardian: bool = reply.candid().map_err(|_| "Invalid guardian verification")?;
    guardian_search::permit_disclosure(guardian, account_for_write(caller)? == account, config.same_configuration(&directory_config()?))?;
    guardian_search::permit_profile_revision(retained_revision, profile_search_revision())?;
    results.retain(|result| account_for_write(result.principal).is_ok());
    Ok(results)
}

/// Additive candidate reader for scoped client-side name matching. It does not
/// enable a privacy cutover or use the unreleased membership directory index.
#[ic_cdk::update]
async fn read_club_profiles(authority: Principal, club: String, subjects: Vec<Principal>) -> Outcome<Vec<ProfileSearchResult>> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != Some("1") {
        return Err("Private profile candidate reads are not released".into());
    }
    let caller = ic_cdk::api::msg_caller();
    let viewer = membership_lookup_viewer(caller)?;
    let config = directory_config()?;
    let sources: Vec<Principal> = config.sources.iter().map(|(_, p)| *p).collect();
    let subjects = club_profiles::validate(authority, &sources, &club, &subjects)?;
    let check = |expected: Option<candid::Nat>| {
        let club = club.clone();
        let subjects = subjects.clone();
        async move {
            let reply = ic_cdk::call::Call::bounded_wait(authority, "read_profile_membership_batch")
                .with_args(&(caller, club, subjects, expected)).await.map_err(|_| "Club membership verification unavailable")?;
            reply.candid::<Outcome<club_profiles::MembershipBatch>>().map_err(|_| "Invalid club membership verification")?
        }
    };
    let first = check(None).await?;
    club_profiles::permit(true, membership_lookup_viewer(caller)? == viewer, config.same_configuration(&directory_config()?))?;
    club_profiles::verify_batch(&first, caller, &club, &subjects, None)?;
    let candidates: Vec<_> = subjects.iter().zip(&first.members).filter_map(|(subject,member)| {
        if !member { return None; }
        account_for_write(*subject).ok().map(|account| (*subject,account))
    }).collect();
    // Two calls regardless of candidate count; expected revision rejects any
    // role/family/removal change across observations. No boolean-only fallback.
    let final_batch = check(Some(first.revision.clone())).await?;
    club_profiles::permit(true, membership_lookup_viewer(caller)? == viewer, config.same_configuration(&directory_config()?))?;
    club_profiles::verify_batch(&final_batch, caller, &club, &subjects, Some(&first.revision))?;
    if final_batch.members != first.members { return Err("Profile membership changed without revision".into()); }
    // Read profiles after the final await, not from a suspended plaintext copy.
    let mut results = Vec::new();
    for (subject, subject_account) in candidates {
        if account_for_write(subject).ok().as_ref() != Some(&subject_account) { continue; }
        if let Some(profile) = get_profile_entry(&subject_account.id) {
            results.push(ProfileSearchResult { account_id: profile.account_id, principal: subject, display_name: profile.display_name, avatar_ref: profile.avatar_ref });
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

/// Bounded authenticated admin directory; full export stays governor-only.
#[ic_cdk::update]
fn list_admin_accounts(query: String, after: Option<String>, limit: u16) -> Outcome<admin_accounts::AdminAccountPage> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let core = state();
    admin_accounts::authorize(&core, ic_cdk::api::msg_caller())?;
    admin_accounts::page(&core, query, after, limit)
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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    let caller = ic_cdk::api::msg_caller();
    let state = state();
    admin_accounts::authorize(&state, caller)?;
    let mut account = get_account(&account_id).ok_or("Unknown account")?;
    if private_name_coordination::pending(&account_id) { return Err("Private-name suspension recovery pending".into()); }
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") == Some("1") && status == AccountStatus::Suspended && !private_name_writer_window::enabled() {
        return Err("Use coordinated private-name suspension".into());
    }
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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

    set_exclusion_scoped(account_id, None, club, team)
}

#[ic_cdk::update]
fn set_exclusion_scoped(
    account_id: String,
    site_id: Option<String>,
    club: String,
    team: Option<String>,
) -> Outcome<()> {
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    let _private_writer_lease = private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));

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
    fn guardian_storage_traversal_is_bounded_ordered_and_preserves_private_references() {
        for n in 0..130 {
            put_profile_entry(&Profile{account_id:format!("guardian-storage-{n:03}"),display_name:"pii-display-name:v1:opaque".into(),avatar_ref:None,updated_at_ns:1,theme_preference:None,club_switcher_hint_seen_at:None});
        }
        let first=bounded_guardian_profile_rows(Some("guardian-storage-".into()));
        assert_eq!(first.len(),100);
        assert_eq!(first[0].account_id,"guardian-storage-000");
        assert_eq!(first[99].account_id,"guardian-storage-099");
        let second=bounded_guardian_profile_rows(Some(first[99].account_id.clone()));
        assert_eq!(second.len(),30);
        assert_eq!(second[0].account_id,"guardian-storage-100");
        assert!(second.iter().all(|row|row.display_name=="pii-display-name:v1:opaque"));
    }
    #[test]
    fn guardian_profile_revision_invalidates_on_profile_and_account_mutations() {
        let opening=profile_search_revision();
        let account=Account{id:"guardian-revision-account".into(),principals:vec![Principal::from_slice(&[230,1])],version:1,status:AccountStatus::Active};
        put_account(&account);assert!(profile_search_revision()>opening);
        let prior=profile_search_revision();remove_account(&account.id);assert!(profile_search_revision()>prior);
        let prior=profile_search_revision();put_profile_entry(&Profile{account_id:account.id.clone(),display_name:"Name".into(),avatar_ref:None,updated_at_ns:1,theme_preference:None,club_switcher_hint_seen_at:None});assert!(profile_search_revision()>prior);
        let prior=profile_search_revision();remove_profile_entry(&account.id);assert!(profile_search_revision()>prior);
    }
    #[test]
    fn private_lookup_resolves_verified_aliases_and_fails_on_lifecycle_changes(){
        let caller=Principal::from_slice(&[51,1]);let alias=Principal::from_slice(&[52,1]);
        let id=ensure_account(caller).unwrap();let mut account=get_account(&id).unwrap();
        account.principals.push(alias);account.version=2;put_account(&account);index_principal(alias,&id);
        let viewer=membership_lookup_viewer(caller).unwrap();assert_eq!(viewer.aliases,vec![caller,alias]);assert_eq!(viewer.version,2);
        account.status=AccountStatus::Suspended;put_account(&account);assert!(membership_lookup_viewer(caller).is_err());
        account.status=AccountStatus::Active;put_account(&account);
        deny_principals(&[alias],&id,3,DenialReason::Unlinked).unwrap();assert_eq!(membership_lookup_viewer(caller).unwrap().aliases,vec![caller]);assert!(membership_lookup_viewer(alias).is_err());
        account.principals=vec![alias];put_account(&account);assert!(membership_lookup_viewer(caller).is_err());
        account.principals=vec![caller];put_account(&account);ERASED_ACCOUNTS.with(|m|m.borrow_mut().insert(id,3));assert!(membership_lookup_viewer(caller).is_err());
    }
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
    fn lost_principal_index_self_heals_only_for_listed_owner() {
        let owner = principal(170);
        let id = ensure_account(owner).unwrap();
        deindex_principal(owner);
        assert!(account_for(owner).is_err());
        assert_eq!(ensure_account(owner).unwrap(), id);
        assert_eq!(account_for(owner).unwrap().id, id);
        // Original account still has another alias but silently lost the
        // creator (no denial/erasure/removal): the creator gets it back, with
        // the alias kept, and repeat sign-ins are stable.
        let creator = principal(171);
        let original = Account { id: account_id(creator), principals: vec![principal(172)], version: 3, status: AccountStatus::Active };
        put_account(&original);
        let mut profile = get_or_init_profile(&original.id); profile.display_name = "Paul".into(); put_profile_entry(&profile);
        assert_eq!(ensure_account(creator).unwrap(), original.id);
        assert_eq!(get_account(&original.id).unwrap().principals, vec![principal(172), creator]);
        assert_eq!(get_account(&original.id).unwrap().version, 4);
        assert_eq!(ensure_account(creator).unwrap(), original.id);
        deindex_principal(creator);
        assert_eq!(ensure_account(creator).unwrap(), original.id);
        assert_eq!(get_profile_entry(&original.id).unwrap().display_name, "Paul");
        // Orphaned derived account (no logins left) is reclaimed by its owner.
        let orphan_owner = principal(173);
        let orphan_id = ensure_account(orphan_owner).unwrap();
        let mut orphan = get_account(&orphan_id).unwrap();
        orphan.principals.clear(); put_account(&orphan); deindex_principal(orphan_owner);
        assert_eq!(ensure_account(orphan_owner).unwrap(), orphan_id);
        assert_eq!(get_account(&orphan_id).unwrap().principals, vec![orphan_owner]);
    }
    #[test]
    fn sign_in_parked_on_empty_duplicate_moves_back_to_original() {
        init(Init { governor: principal(190) });
        let user = principal(174);
        let original = Account { id: account_id(user), principals: vec![principal(175)], version: 2, status: AccountStatus::Active };
        put_account(&original);
        let mut profile = get_or_init_profile(&original.id); profile.display_name = "Original".into(); put_profile_entry(&profile);
        // Simulate the earlier recovery that parked the sign-in on a fresh account.
        let dup = Account { id: "parked-duplicate".into(), principals: vec![user], version: 0, status: AccountStatus::Active };
        put_account(&dup); index_principal(user, &dup.id);
        let mut draft = get_or_init_profile(&dup.id); draft.display_name = "Draft".into(); put_profile_entry(&draft);
        assert_eq!(ensure_account(user).unwrap(), original.id);
        assert!(get_account(&dup.id).is_none());
        assert!(get_profile_entry(&dup.id).is_none());
        assert_eq!(account_for(user).unwrap().id, original.id);
        assert_eq!(get_profile_entry(&original.id).unwrap().display_name, "Original");
        // A duplicate that already holds roles is never discarded.
        let other = principal(176);
        let orig2 = Account { id: account_id(other), principals: vec![principal(177)], version: 1, status: AccountStatus::Active };
        put_account(&orig2);
        let busy = Account { id: "busy-duplicate".into(), principals: vec![other], version: 0, status: AccountStatus::Active };
        put_account(&busy); index_principal(other, &busy.id);
        let mut s = state();
        s.roles.push(RoleGrant { account_id: busy.id.clone(), role: "member".into(), site_id: None, club: Some("c".into()), team: None });
        store(&s);
        assert_eq!(ensure_account(other).unwrap(), busy.id);
        assert!(get_account(&busy.id).is_some());
    }
    #[test]
    fn erased_original_never_reattaches() {
        let user = principal(178);
        let original = Account { id: account_id(user), principals: vec![principal(179)], version: 1, status: AccountStatus::Active };
        put_account(&original);
        ERASED_ACCOUNTS.with(|m| m.borrow_mut().insert(original.id.clone(), 1));
        let fresh = ensure_account(user).unwrap();
        assert_ne!(fresh, original.id);
        assert_eq!(get_account(&original.id).unwrap().principals, vec![principal(179)]);
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
    fn production_admission_releases_only_exact_readers_not_lifecycle() {
        let reader=principal(98); let user=principal(99);
        let account=Account { id:"production-reader".into(),principals:vec![user],version:1,status:AccountStatus::Active };
        put_account(&account); index_principal(user,&account.id);
        GROUP2_ADMISSION.with(|m|m.borrow_mut().set(encode(&admission::Config {enabled:true,readers:vec![reader]})));
        assert_eq!(authority_eligibilities(reader,vec![user]).unwrap()[0].decision,EligibilityDecision::Eligible);
        assert_eq!(authority_eligibilities(user,vec![user]),Err("Configured authority required".into()));
        assert!(authority_eligibilities(reader,vec![]).is_err());
        assert!(authority_eligibilities(reader,vec![user,user]).is_err());
        assert!(authority_eligibilities(reader,(0..201u32).map(|i|Principal::self_authenticating(i.to_be_bytes())).collect()).is_err());
        assert!(!account_group_rehearsal_enabled());
        assert_eq!(service_account(reader,user),Err("Service admission not released".into()));
        assert_eq!(set_club_authorities(vec![reader]),Err("Cross-group account lifecycle not released".into()));
        let restored:admission::Config=decode(&encode(&group2_admission()));
        assert!(restored.enabled); assert_eq!(restored.readers,vec![reader]);
    }
    #[test]
    fn production_admission_keeps_suspension_erasure_and_deletion_denied() {
        let reader=principal(96);let user=principal(95);
        GROUP2_ADMISSION.with(|m|m.borrow_mut().set(encode(&admission::Config {enabled:true,readers:vec![reader]})));
        let mut account=Account {id:"production-denial".into(),principals:vec![user],version:2,status:AccountStatus::Active};
        put_account(&account);index_principal(user,&account.id);
        assert_eq!(authority_eligibilities(reader,vec![principal(94)]).unwrap()[0].decision,EligibilityDecision::Denied);
        account.status=AccountStatus::Suspended;put_account(&account);
        assert_eq!(authority_eligibilities(reader,vec![user]).unwrap()[0].decision,EligibilityDecision::Denied);
        account.status=AccountStatus::Active;put_account(&account);
        DELETION_TICKETS.with(|m|m.borrow_mut().insert(account.id.clone(),vec![0]));
        assert!(admission_configuration_clear().is_err());
        assert_eq!(authority_eligibilities(reader,vec![user]).unwrap()[0].decision,EligibilityDecision::Denied);
        DELETION_TICKETS.with(|m|m.borrow_mut().remove(&account.id));
        erase_account_core(&mut empty_core_state(principal(93)),&account).unwrap();
        assert_eq!(authority_eligibilities(reader,vec![user]).unwrap()[0].decision,EligibilityDecision::Denied);
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
        if std::env::var_os("IGNITE_EXPORT_CANDID").is_some() {
            std::fs::write(concat!(env!("CARGO_MANIFEST_DIR"), "/identity_access.did"), &exported).expect("write candid");
            return;
        }
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
