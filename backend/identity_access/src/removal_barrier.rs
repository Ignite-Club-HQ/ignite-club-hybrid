//! Durable local-only removal intents. No receiver drain acceptance exists yet.
//! Never interpret a frozen target inventory as an acknowledgement.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Request {
    pub account_id: String,
    pub generation: u64,
    pub inventory_digest: Vec<u8>,
    pub subjects: Vec<Principal>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Receipt {
    pub request: Request,
    pub receiver: Principal,
    pub outstanding: candid::Nat,
}
impl Intent {
    pub fn request(&self) -> Request {
        Request { account_id: self.account_id.clone(), generation: self.generation,
            inventory_digest: self.inventory_digest.clone(), subjects: self.subjects.clone() }
    }
    pub fn validate_receipt(&self, target: Principal, receipt: &Receipt) -> Result<(), String> {
        if !self.targets.contains(&target) || receipt.receiver != target || receipt.request != self.request() {
            return Err("Removal receipt binding mismatch".into());
        }
        Ok(())
    }
    pub fn validate_seal(&self, target: Principal, receipt: &Receipt) -> Result<(), String> {
        self.validate_receipt(target, receipt)?;
        if receipt.outstanding != candid::Nat::from(0u8) { return Err("Removal receiver not drained".into()); }
        Ok(())
    }
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Intent {
    pub account_id: String,
    pub subjects: Vec<Principal>,
    pub account_version: u64,
    pub generation: u64,
    pub inventory_digest: Vec<u8>,
    pub inventory: super::group_inventory::RemovalInventory,
    pub targets: Vec<Principal>,
}

pub fn create(account: &super::Account, generation: u64, inventory: super::group_inventory::RemovalInventory,
    digest: Vec<u8>, identity: Principal) -> Result<Intent, String> {
    let subjects: BTreeSet<_> = account.principals.iter().copied().collect();
    if generation == 0 || account.id.is_empty() || account.id.len() > 128 || account.version == u64::MAX ||
        subjects.is_empty() || subjects.len() > 8 || subjects.len() != account.principals.len() || digest.len() != 32 ||
        subjects.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister()) {
        return Err("Invalid removal intent".into());
    }
    super::group_inventory::validate_complete(&inventory.groups.snapshot, &inventory.groups.binding,
        &inventory.media.iter().map(|m| m.club_authority).collect::<Vec<_>>(), &[], &inventory.supplemental, &inventory.media)?;
    let mut targets: BTreeSet<_> = inventory.groups.snapshot.groups.iter()
        .flat_map(|g| g.domains.iter().map(|d| d.canister)).collect();
    targets.extend(inventory.supplemental.iter().map(|s| s.canister));
    // The coordinator fences locally before the first remote call.
    targets.remove(&identity);
    if targets.is_empty() || targets.len() > 1088 { return Err("Invalid removal targets".into()); }
    Ok(Intent { account_id: account.id.clone(), subjects: account.principals.clone(), account_version: account.version,
        generation, inventory_digest: digest, inventory, targets: targets.into_iter().collect() })
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn receiver_receipts_require_exact_generation_subjects_digest_and_target() {
        let p = Principal::from_slice(&[1, 1]);
        let q = Principal::from_slice(&[2, 1]);
        let (snapshot, binding, clubs) = super::super::group_inventory::tests::fixture();
        let inventory = super::super::group_inventory::RemovalInventory {
            groups: super::super::group_inventory::Evidence { binding, history_revision: 0, snapshot },
            supplemental: vec![], media: clubs.iter().map(|c| super::super::group_inventory::MediaEvidence {
                club_authority: *c, registry: super::super::group_inventory::MediaRegistry { active: false, stores: vec![] }
            }).collect()
        };
        let intent = Intent { account_id:"removed".into(), subjects:vec![p], generation:7, account_version:4,
            inventory_digest:vec![1;32], inventory, targets:vec![q] };
        let receipt = Receipt { request:intent.request(), receiver:q, outstanding:0u8.into() };
        assert_eq!(intent.validate_receipt(q, &receipt), Ok(()));
        assert_eq!(intent.validate_seal(q, &receipt), Ok(()));
        let mut pending = receipt.clone(); pending.outstanding = 1u8.into();
        assert!(intent.validate_receipt(q, &pending).is_ok());
        assert_eq!(intent.validate_seal(q, &pending), Err("Removal receiver not drained".into()));
        let mut bad = receipt.clone(); bad.request.generation = 6;
        assert!(intent.validate_receipt(q, &bad).is_err());
        bad = receipt.clone(); bad.request.subjects = vec![q];
        assert!(intent.validate_receipt(q, &bad).is_err());
        bad = receipt.clone(); bad.request.inventory_digest[0] = 2;
        assert!(intent.validate_receipt(q, &bad).is_err());
        bad = receipt; bad.receiver = p;
        assert!(intent.validate_receipt(q, &bad).is_err());
        assert!(intent.validate_receipt(p, &bad).is_err());
    }
    #[test]
    fn invalid_generation_subjects_and_digest_cannot_create_a_fence() {
        let account = super::super::Account { id: "removed".into(), principals: vec![Principal::anonymous()],
            version: 1, status: super::super::AccountStatus::Active };
        // Validation occurs before any stable mutation; invalid inputs never
        // require a registry call or allocate a generation.
        let p = Principal::from_slice(&[1, 1]);
        let b = super::super::group_inventory::Binding { registry:p,registry_revision:1,target_alias:"local".into(),
            deployment_id:"local".into(),deployment_revision:1,host:"https://isolated.invalid".into(),network_kind:"public_mainnet".into() };
        let inventory = super::super::group_inventory::RemovalInventory {
            groups:super::super::group_inventory::Evidence {binding:b,history_revision:1,
                snapshot:super::super::group_inventory::Snapshot {revision:1,groups:vec![],placements:vec![]}},
            supplemental:vec![],media:vec![] };
        assert_eq!(create(&account, 0, inventory.clone(), vec![0;32], p), Err("Invalid removal intent".into()));
        let mut valid_subject = account; valid_subject.principals=vec![Principal::from_slice(&[2,1])];
        assert_eq!(create(&valid_subject, 1, inventory.clone(), vec![0;31], p), Err("Invalid removal intent".into()));
        valid_subject.principals.push(valid_subject.principals[0]);
        assert_eq!(create(&valid_subject, 1, inventory, vec![0;32], p), Err("Invalid removal intent".into()));
    }
}