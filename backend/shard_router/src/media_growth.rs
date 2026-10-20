//! Monotonic local-only physical commitments; no refunds or expiry.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Budget {
    pub group_id: String,
    pub target_alias: String,
    pub authority: Principal,
    pub usable: u64,
    pub fixed: u64,
    pub free_club: u64,
    pub commitments: BTreeMap<String, u64>,
}
impl Budget {
    pub fn committed(&self) -> Result<u64, String> {
        self.commitments.values().try_fold(self.fixed, |sum, n| sum.checked_add(*n).ok_or("Growth overflow".into()))
    }
    pub fn fits(&self, club: &str, bytes: u64) -> bool {
        let old = *self.commitments.get(club).unwrap_or(&0);
        bytes <= old || self.committed().ok().and_then(|n| n.checked_add(bytes - old)).is_some_and(|n| n <= self.usable)
    }
    pub fn reserve(&mut self, club: &str, bytes: u64) -> Result<u64, String> {
        if club.is_empty() || club.len() > 64 || bytes == 0 || (!self.commitments.contains_key(club) && self.commitments.len() >= 100_000) {
            return Err("Invalid growth commitment".into());
        }
        if !self.fits(club, bytes) { return Err("Group growth capacity exhausted".into()); }
        let want = bytes.max(*self.commitments.get(club).unwrap_or(&0));
        self.commitments.insert(club.into(), want);
        Ok(want)
    }
}

/// Immutable store identity and baseline. Legacy aggregate budgets are never
/// accepted as store proof implicitly. No refunds or automatic expansion.
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct StoreBudget {
    pub store: Principal,
    pub evidence_revision: u64,
    pub budget: Budget,
}
impl StoreBudget {
    pub fn matches(&self, group: &str, target: &str, authority: Principal, store: Principal) -> bool {
        self.store == store && self.budget.group_id == group &&
            self.budget.target_alias == target && self.budget.authority == authority
    }
    pub fn import(store: Principal, evidence_revision: u64, legacy: &Budget, usable: u64, fixed: u64,
        baseline: Vec<(String, u64)>) -> Result<Self, String> {
        if store == Principal::anonymous() || store == Principal::management_canister() ||
            usable == 0 || usable > 34_359_738_368 || fixed > usable || baseline.len() != legacy.commitments.len() {
            return Err("Exact verified store baseline required".into());
        }
        // Never reduce already issued promises or reserve overhead twice.
        if fixed < legacy.fixed { return Err("Store overhead cannot shrink".into()); }
        let mut budget = Budget { usable, fixed, commitments: BTreeMap::new(), ..legacy.clone() };
        for (club, bytes) in baseline {
            if budget.commitments.contains_key(&club) || legacy.commitments.get(&club).is_none_or(|old| bytes < *old) {
                return Err("Existing club promise missing or reduced".into());
            }
            budget.reserve(&club, bytes)?;
        }
        Ok(Self { store, evidence_revision, budget })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn exact_fit_retry_and_downgrade_never_refund() {
        let mut b = Budget { group_id: "g".into(), target_alias: "local".into(), authority: Principal::from_slice(&[1]), usable: 100, fixed: 20, free_club: 10, commitments: BTreeMap::new() };
        assert_eq!(b.reserve("a", 70), Ok(70));
        assert_eq!(b.reserve("a", 70), Ok(70));
        assert_eq!(b.reserve("a", 5), Ok(70));
        assert_eq!(b.reserve("b", 10), Ok(10));
        assert!(b.reserve("c", 1).is_err());
        assert_eq!(b.committed(), Ok(100));
        let saved = crate::encode(&b);
        assert_eq!(crate::decode::<Budget>(&saved), b);
    }
    fn baseline() -> Budget {
        Budget { group_id: "g".into(), target_alias: "local".into(), authority: Principal::from_slice(&[1]),
            usable: 1000, fixed: 20, free_club: 10, commitments: [("existing".into(),70)].into() }
    }
    #[test]
    fn store_protects_existing_future_promise_before_new_clubs() {
        let mut b = StoreBudget::import(Principal::from_slice(&[2]), 4, &baseline(), 100, 20, vec![("existing".into(),70)]).unwrap();
        assert_eq!(b.budget.reserve("new",10),Ok(10));
        assert!(b.budget.reserve("another",1).is_err());
        assert_eq!(b.budget.reserve("existing",70),Ok(70));
        assert_eq!(b.budget.reserve("existing",1),Ok(70));
        assert!(b.budget.reserve("new",11).is_err());
        assert_eq!(crate::decode::<StoreBudget>(&crate::encode(&b)),b);
    }
    #[test]
    fn exact_store_import_rejects_missing_reduced_duplicate_and_oversold_promises() {
        let store=Principal::from_slice(&[2]); let old=baseline();
        assert!(StoreBudget::import(store,1,&old,100,20,vec![]).is_err());
        assert!(StoreBudget::import(store,1,&old,100,20,vec![("existing".into(),69)]).is_err());
        assert!(StoreBudget::import(store,1,&old,89,20,vec![("existing".into(),70)]).is_err());
        assert!(StoreBudget::import(store,1,&old,100,19,vec![("existing".into(),70)]).is_err());
        assert!(StoreBudget::import(store,1,&old,100,20,vec![("foreign".into(),70)]).is_err());
        assert!(StoreBudget::import(Principal::anonymous(),1,&old,100,20,vec![("existing".into(),70)]).is_err());
    }
    #[test]
    fn store_binding_cannot_be_reused_for_another_group_authority_or_target() {
        let s=Principal::from_slice(&[2]);let a=Principal::from_slice(&[1]);
        let b=StoreBudget::import(s,1,&baseline(),100,20,vec![("existing".into(),70)]).unwrap();
        assert!(b.matches("g","local",a,s));
        assert!(!b.matches("other","local",a,s));
        assert!(!b.matches("g","foreign",a,s));
        assert!(!b.matches("g","local",s,s));
        assert!(!b.matches("g","local",a,a));
    }
    #[test]
    fn concurrent_promises_preserve_existing_headroom() {
        let mut b=StoreBudget::import(Principal::from_slice(&[2]),1,&baseline(),110,20,vec![("existing".into(),70)]).unwrap();
        assert_eq!(b.budget.reserve("new-a",10),Ok(10));
        assert_eq!(b.budget.reserve("new-b",10),Ok(10));
        assert!(b.budget.reserve("new-c",10).is_err());
        assert_eq!(b.budget.commitments.get("existing"),Some(&70));
        assert_eq!(b.budget.reserve("new-a",10),Ok(10));
        assert_eq!(b.budget.committed(),Ok(110));
    }
}