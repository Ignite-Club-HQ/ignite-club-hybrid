//! Rehearsal suspension coordinator. This is not complete writer coverage.
//! Unknown receiver outcomes remain locked; recovery never repins inventory.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use ic_stable_structures::{StableBTreeMap, StableCell};
use std::{cell::RefCell, collections::BTreeSet};
use sha2::{Digest, Sha256};
use super::{Account, AccountStatus, Outcome};

const CAPACITY: u64 = 4096;
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Request { pub operation_id: String, pub generation: u64, pub inventory_digest: Vec<u8> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Receipt { pub request: Request, pub receiver: Principal, pub completed: bool, pub release_epoch: candid::Nat }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum Phase { Preparing, Committed, Done }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Intent {
    pub request: Request, pub account: Account,
    pub profile_revision: u64,
    pub inventory: super::group_inventory::RemovalInventory,
    pub targets: Vec<Principal>, pub prepared: Vec<Receipt>, pub completed: Vec<Receipt>, pub phase: Phase,
}
impl Intent {
    fn verify(&self, target: Principal, receipt: &Receipt, completed: bool) -> Outcome<()> {
        if !self.targets.contains(&target) || receipt.receiver != target || receipt.request != self.request
            || receipt.completed != completed || receipt.release_epoch == candid::Nat::from(0u8) {
            return Err("Private-name fence receipt binding mismatch".into());
        }
        if completed {
            let prepared = self.prepared.iter().find(|r| r.receiver == target).ok_or("Prepared receipt missing")?;
            if receipt.release_epoch <= prepared.release_epoch { return Err("Private-name completion epoch did not advance".into()); }
        }
        Ok(())
    }
    fn record(&mut self, target: Principal, receipt: Receipt, completed: bool) -> Outcome<()> {
        self.verify(target, &receipt, completed)?;
        if completed && self.phase != Phase::Committed { return Err("Private-name mutation not committed".into()); }
        if !completed && self.phase != Phase::Preparing { return Err("Private-name preparation closed".into()); }
        let rows = if completed { &mut self.completed } else { &mut self.prepared };
        if let Some(prior) = rows.iter().find(|r| r.receiver == target) {
            // Other concurrent intents can advance the global epoch, but must
            // never replace this operation's original acknowledged boundary.
            if receipt.release_epoch < prior.release_epoch { return Err("Private-name receipt epoch regressed".into()); }
            return Ok(());
        }
        rows.push(receipt); Ok(())
    }
    fn can_commit(&self) -> Outcome<()> {
        if self.phase != Phase::Preparing || self.prepared.len() != self.targets.len() { return Err("Every original PII sink must be fenced".into()); }
        for target in &self.targets {
            self.verify(*target, self.prepared.iter().find(|r| r.receiver == *target).ok_or("Prepared receipt missing")?, false)?;
        }
        Ok(())
    }
}
fn create(operation_id: String, generation: u64, account: Account, inventory: super::group_inventory::RemovalInventory) -> Outcome<Intent> {
    if operation_id.is_empty() || operation_id.len() > 128 || generation == 0 || account.status != AccountStatus::Active
        || account.version == u64::MAX { return Err("Invalid private-name suspension intent".into()); }
    let clubs = inventory.groups.snapshot.groups.iter().flat_map(|g| g.domains.iter().filter(|d| d.domain == "club_domain").map(|d| d.canister)).collect::<Vec<_>>();
    super::group_inventory::validate_complete(&inventory.groups.snapshot, &inventory.groups.binding, &clubs, &[], &inventory.supplemental, &inventory.media)?;
    let mut targets: BTreeSet<_> = inventory.groups.snapshot.groups.iter().flat_map(|g| g.domains.iter().filter(|d| d.domain == "pii_access_control").map(|d| d.canister)).collect();
    targets.extend(inventory.supplemental.iter().filter(|d| d.domain == "pii_access_control").map(|d| d.canister));
    if targets.is_empty() || targets.len() > 256 { return Err("Bounded complete original PII inventory required".into()); }
    let inventory_digest = Sha256::digest(super::encode(&inventory)).to_vec();
    Ok(Intent { request: Request { operation_id, generation, inventory_digest }, account, profile_revision: super::profile_search_revision(), inventory, targets: targets.into_iter().collect(), prepared: vec![], completed: vec![], phase: Phase::Preparing })
}
thread_local! {
    // Additive storage, deliberately separate from removal and directory state.
    static INTENTS: RefCell<StableBTreeMap<String, Vec<u8>, super::Memory>> = RefCell::new(StableBTreeMap::init(super::memory(26)));
    static GENERATION: RefCell<StableCell<u64, super::Memory>> = RefCell::new(StableCell::init(super::memory(27), 0));
}
fn get(id: &str) -> Outcome<Intent> { INTENTS.with(|m| m.borrow().get(&id.to_string())).map(|b| super::decode(&b)).ok_or("Private-name intent missing".into()) }
fn save(intent: &Intent) { INTENTS.with(|m| m.borrow_mut().insert(intent.request.operation_id.clone(), super::encode(intent))); }
pub(super) fn pending(account: &str) -> bool { INTENTS.with(|m| m.borrow().iter().any(|e| { let i: Intent = super::decode(&e.value()); i.account.id == account && i.phase != Phase::Done })) }
pub(super) fn any_pending() -> bool { INTENTS.with(|m| m.borrow().iter().any(|e| super::decode::<Intent>(&e.value()).phase != Phase::Done)) }
fn access() -> Outcome<()> {
    if super::private_name_writer_window::enabled() { return Err("Use the all-writer coordinator in writer rehearsal".into()); }
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != Some("1") || !super::account_group_rehearsal_enabled() { return Err("Private-name coordination rehearsal required".into()); }
    super::require_governor(&super::state(), ic_cdk::api::msg_caller())
}
fn unchanged(intent: &Intent) -> Outcome<()> {
    if super::group_inventory_binding().as_ref() != Some(&intent.inventory.groups.binding)
        || super::supplemental_inventory() != intent.inventory.supplemental {
        return Err("Frozen private-name inventory changed; retain fences".into());
    }
    let mut expected = intent.account.clone();
    if intent.phase != Phase::Preparing { expected.status = AccountStatus::Suspended; expected.version = expected.version.checked_add(1).ok_or("Account version exhausted")?; }
    if super::get_account(&expected.id).as_ref() != Some(&expected) { return Err("Private-name account changed; retain fences".into()); }
    Ok(())
}
fn commit_preconditions(intent: &Intent) -> Outcome<()> {
    unchanged(intent)?;
    if super::profile_search_revision() != intent.profile_revision
        || super::removal_history_revision() != intent.inventory.groups.history_revision {
        return Err("Private-name authorization changed; retain fences".into());
    }
    Ok(())
}
#[ic_cdk::update]
async fn begin_private_name_suspension(operation_id: String, account_id: String, expected_history_revision: u64) -> Outcome<Intent> {
    access()?;
    if let Ok(prior) = get(&operation_id) {
        if prior.account.id != account_id { return Err("Immutable private-name operation conflict".into()); }
        return Ok(prior);
    }
    if INTENTS.with(|m| m.borrow().len()) >= CAPACITY { return Err("Private-name intent capacity reached".into()); }
    if pending(&account_id) { return Err("Private-name account operation pending".into()); }
    let account = super::get_account(&account_id).ok_or("Unknown account")?;
    if account.principals.contains(&super::state().governor) { return Err("Governor account cannot be suspended".into()); }
    let inventory = super::read_removal_inventory_evidence(expected_history_revision).await?;
    access()?;
    // Recheck both operation and capacity after the inventory awaits.
    if let Ok(prior) = get(&operation_id) {
        if prior.account.id != account_id { return Err("Immutable private-name operation conflict".into()); }
        return Ok(prior);
    }
    if pending(&account_id) || super::get_account(&account_id).as_ref() != Some(&account)
        || super::removal_history_revision() != expected_history_revision { return Err("Private-name preparation changed".into()); }
    if INTENTS.with(|m| m.borrow().len()) >= CAPACITY { return Err("Private-name intent capacity reached".into()); }
    let generation = GENERATION.with(|m| m.borrow().get().checked_add(1)).ok_or("Private-name generation exhausted")?;
    let intent = create(operation_id, generation, account, inventory)?;
    if let Some(profile) = super::get_profile_entry(&intent.account.id) {
        if profile.display_name.starts_with("pii-display-name:") {
            let parts = profile.display_name.split(':').collect::<Vec<_>>();
            if parts.len() != 4 || parts[1] != "v1" || !super::private_profile_reference::valid(&profile.display_name, &intent.account.principals)
                || Principal::from_text(parts[2]).ok().is_none_or(|p| !intent.targets.contains(&p)) {
                return Err("Subject original PII authority omitted from inventory".into());
            }
        }
    }
    GENERATION.with(|m| m.borrow_mut().set(generation)); save(&intent); Ok(intent)
}
#[ic_cdk::update]
fn read_private_name_suspension(operation_id: String) -> Outcome<Intent> { access()?; get(&operation_id) }
async fn read_receipt(target: Principal, request: &Request) -> Outcome<Receipt> {
    let reply = ic_cdk::call::Call::bounded_wait(target, "read_private_name_release_fence").with_arg(request).await.map_err(|_| "Private-name receipt unavailable; retain intent")?;
    let receipt: Outcome<Receipt> = reply.candid().map_err(|_| "Invalid private-name receipt")?; receipt
}
#[ic_cdk::update]
async fn prepare_private_name_suspension_sink(operation_id: String, target: Principal) -> Outcome<Intent> {
    access()?; let intent = get(&operation_id)?; unchanged(&intent)?;
    if intent.phase != Phase::Preparing || !intent.targets.contains(&target) { return Err("Exact preparing sink required".into()); }
    if !intent.prepared.iter().any(|r| r.receiver == target) {
        // Even a lost/trapped acknowledgement must be recovered by exact
        // consensus readback. Never release or replace an unknown intent.
        let _ = ic_cdk::call::Call::bounded_wait(target, "prepare_private_name_release_fence").with_arg(&intent.request).await;
    }
    let receipt = read_receipt(target, &intent.request).await?;
    access()?; let mut latest = get(&operation_id)?; unchanged(&latest)?;
    latest.record(target, receipt, false)?; save(&latest); Ok(latest)
}
#[ic_cdk::update]
fn commit_private_name_suspension(operation_id: String) -> Outcome<Intent> {
    access()?; let mut intent = get(&operation_id)?;
    if intent.phase != Phase::Preparing { return Ok(intent); }
    commit_preconditions(&intent)?;
    intent.can_commit()?;
    let mut account = intent.account.clone(); account.status = AccountStatus::Suspended;
    account.version = account.version.checked_add(1).ok_or("Account version exhausted")?;
    // No await: mutation and committed journal are one atomic message.
    super::put_account(&account); intent.phase = Phase::Committed; save(&intent); Ok(intent)
}
#[ic_cdk::update]
async fn complete_private_name_suspension_sink(operation_id: String, target: Principal) -> Outcome<Intent> {
    access()?; let intent = get(&operation_id)?; unchanged(&intent)?;
    if !intent.targets.contains(&target) || intent.phase == Phase::Preparing { return Err("Exact committed sink required".into()); }
    if intent.phase == Phase::Done { return Ok(intent); }
    let _ = ic_cdk::call::Call::bounded_wait(target, "complete_private_name_release_fence").with_arg(&intent.request).await;
    let receipt = read_receipt(target, &intent.request).await?;
    access()?; let mut latest = get(&operation_id)?; unchanged(&latest)?;
    if latest.phase == Phase::Done { latest.verify(target, &receipt, true)?; return Ok(latest); }
    latest.record(target, receipt, true)?;
    if latest.completed.len() == latest.targets.len() { latest.phase = Phase::Done; }
    save(&latest); Ok(latest)
}

#[cfg(test)] mod tests {
    use super::*;
    fn fixture() -> Intent {
        let (snapshot, binding, clubs) = super::super::group_inventory::tests::fixture();
        let p = |n| Principal::from_slice(&[n, 1]);
        let supplemental = vec![super::super::group_inventory::Supplemental { group_id:"g0".into(),domain:"media_blob_store".into(),canister:p(91),subnet:p(80) },super::super::group_inventory::Supplemental { group_id:"g1".into(),domain:"media_blob_store".into(),canister:p(92),subnet:p(80) }, super::super::group_inventory::Supplemental { group_id:"g0".into(),domain:"pii_access_control".into(),canister:p(93),subnet:p(80) }];
        let media = clubs.iter().enumerate().map(|(n,c)| super::super::group_inventory::MediaEvidence { club_authority:*c,registry:super::super::group_inventory::MediaRegistry {active:false,stores:vec![p(91+n as u8)]} }).collect();
        create("suspend-1".into(),1,Account{id:"member".into(),principals:vec![p(94)],version:7,status:AccountStatus::Active},super::super::group_inventory::RemovalInventory {groups:super::super::group_inventory::Evidence{binding,history_revision:3,snapshot},supplemental,media}).unwrap()
    }
    fn receipt(i:&Intent, target:Principal, completed:bool) -> Receipt { Receipt { request:i.request.clone(),receiver:target,completed,release_epoch:candid::Nat::from(if completed {2u8}else{1u8}) } }
    #[test] fn captures_every_group_and_supplemental_original_sink() { let i=fixture(); assert_eq!(i.targets,vec![Principal::from_slice(&[11,1]),Principal::from_slice(&[31,1]),Principal::from_slice(&[93,1])]); }
    #[test] fn every_sink_must_acknowledge_before_commit() { let mut i=fixture(); for t in i.targets.clone() { assert!(i.can_commit().is_err()); i.record(t,receipt(&i,t,false),false).unwrap(); } assert!(i.can_commit().is_ok()); }
    #[test] fn wrong_operation_generation_digest_receiver_or_phase_refuses() { let i=fixture(); let t=i.targets[0]; for n in 0..5 {let mut r=receipt(&i,t,false);match n {0=>r.request.operation_id="other".into(),1=>r.request.generation+=1,2=>r.request.inventory_digest[0]^=1,3=>r.receiver=Principal::anonymous(),_=>r.completed=true};assert!(i.verify(t,&r,false).is_err());} }
    #[test] fn completion_requires_commit_and_new_epoch() { let mut i=fixture(); let t=i.targets[0]; i.record(t,receipt(&i,t,false),false).unwrap();assert!(i.record(t,receipt(&i,t,true),true).is_err()); i.phase=Phase::Committed;let mut r=receipt(&i,t,true);r.release_epoch=1u8.into();assert!(i.record(t,r,true).is_err());i.record(t,receipt(&i,t,true),true).unwrap(); }
    #[test] fn delayed_prepare_cannot_overwrite_committed_state() {let mut i=fixture();let t=i.targets[0];i.record(t,receipt(&i,t,false),false).unwrap();i.phase=Phase::Committed;assert!(i.record(t,receipt(&i,t,false),false).is_err());}
    #[test] fn acknowledged_boundary_survives_later_global_epochs() {let mut i=fixture();let t=i.targets[0];let first=receipt(&i,t,false);i.record(t,first.clone(),false).unwrap();let mut later=first.clone();later.release_epoch=9u8.into();i.record(t,later,false).unwrap();assert_eq!(i.prepared,vec![first]);}
    #[test] fn stable_roundtrip_retains_unknown_and_completed_intents() {let mut i=fixture();let t=i.targets[0];i.record(t,receipt(&i,t,false),false).unwrap();let restored:Intent=super::super::decode(&super::super::encode(&i));assert_eq!(restored,i);assert!(restored.can_commit().is_err()); i.phase=Phase::Done;assert_eq!(super::super::decode::<Intent>(&super::super::encode(&i)),i);}
    #[test] fn overlapping_callback_merges_preserve_both_receipts() {let mut i=fixture();let a=i.targets[0];let b=i.targets[1];let ra=receipt(&i,a,false);let rb=receipt(&i,b,false);i.record(a,ra.clone(),false).unwrap();i.record(b,rb.clone(),false).unwrap();i.record(a,ra,false).unwrap();assert_eq!(i.prepared.len(),2);assert!(i.prepared.contains(&rb));}
    #[test] fn durable_recovery_keeps_reservation_until_all_completions() {
        let mut i=fixture();i.request.operation_id="stable-recovery".into();i.account.id="stable-recovery-member".into();
        save(&i);assert!(pending(&i.account.id));assert_eq!(get(&i.request.operation_id).unwrap(),i);
        for t in i.targets.clone(){i.record(t,receipt(&i,t,false),false).unwrap();save(&i);}
        i.can_commit().unwrap();i.phase=Phase::Committed;save(&i);
        for t in i.targets.clone(){i=get(&i.request.operation_id).unwrap();i.record(t,receipt(&i,t,true),true).unwrap();save(&i);assert!(pending(&i.account.id));}
        i.phase=Phase::Done;save(&i);assert!(!pending(&i.account.id));assert_eq!(get(&i.request.operation_id).unwrap().completed.len(),3);
    }
}