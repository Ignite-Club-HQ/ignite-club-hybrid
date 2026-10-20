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
}