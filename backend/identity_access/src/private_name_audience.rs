//! Request-scoped selectors; no persisted reader grants or readable name index.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq, Eq)]
pub struct Scope {
    pub kind: String,
    pub authority: Principal,
    pub resource: String,
    pub profile_revision: u64,
}
pub fn validate(viewer: Principal, subjects: &[Principal], scope: &Scope) -> Result<(), String> {
    if viewer == Principal::anonymous() || viewer == Principal::management_canister()
        || scope.authority == Principal::anonymous() || scope.authority == Principal::management_canister()
        || scope.resource.trim().is_empty() || scope.resource.trim() != scope.resource || scope.resource.len() > 128
        || !["club", "family", "competition", "league", "guardian_search", "direct", "broadcast", "competition_admin"].contains(&scope.kind.as_str())
        || (scope.kind == "competition_admin" && subjects.is_empty())
        || (scope.kind == "broadcast" && (!scope.resource.starts_with("msg-broadcast-") || subjects.is_empty()))
        || (scope.kind == "direct" && subjects.len() > 2)
        || subjects.len() > 25 || subjects.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister())
        || subjects.iter().collect::<std::collections::BTreeSet<_>>().len() != subjects.len() {
        return Err("Exact bounded private-name audience required".into());
    }
    Ok(())
}
#[cfg(test)] mod tests {
    use super::*;
    fn p(n: u8) -> Principal { Principal::from_slice(&[n, 1]) }
    fn scope(kind: &str) -> Scope { Scope { kind: kind.into(), authority: p(1), resource: "child-1".into(), profile_revision: 7 } }
    #[test] fn only_the_five_name_audiences_are_accepted() {
        for kind in ["club", "family", "competition", "league", "guardian_search"] { assert!(validate(p(2), &[p(3)], &scope(kind)).is_ok()); }
        assert!(validate(p(2), &[p(3)], &scope("email")).is_err());
        assert!(validate(p(2), &[p(3)], &scope("media")).is_err());
    }
    #[test] fn exact_child_and_distinct_bounded_humans_are_required() {
        let mut s = scope("guardian_search"); s.resource.clear(); assert!(validate(p(2), &[p(3)], &s).is_err());
        let s = scope("family");
        assert!(validate(Principal::anonymous(), &[p(3)], &s).is_err());
        assert!(validate(p(2), &[p(3), p(3)], &s).is_err());
        assert!(validate(p(2), &(0..26).map(p).collect::<Vec<_>>(), &s).is_err());
        assert!(validate(p(2), &[Principal::anonymous()], &s).is_err());
    }
    #[test] fn direct_names_are_exact_two_person_requests_not_broadcasts() {
        assert!(validate(p(2), &[p(3)], &scope("direct")).is_ok());
        assert!(validate(p(2), &[p(2), p(3)], &scope("direct")).is_ok());
        assert!(validate(p(2), &[p(2), p(3), p(4)], &scope("direct")).is_err());
        assert!(validate(p(2), &[p(3)], &scope("broadcast")).is_err());
        assert!(validate(p(2), &[p(3)], &scope("competition_admin")).is_ok());
        assert!(validate(p(2), &[], &scope("competition_admin")).is_err());
    }
    #[test] fn broadcast_names_require_the_canonical_resource_and_bounded_subjects() {
        let mut s=scope("broadcast"); s.resource="msg-broadcast-1".into();
        assert!(validate(p(2), &[p(3)], &s).is_ok());
        assert!(validate(p(2), &[], &s).is_err());
        assert!(validate(p(2), &(0..26).map(p).collect::<Vec<_>>(), &s).is_err());
        assert!(validate(p(2), &[p(3), p(3)], &s).is_err());
        s.resource="other".into(); assert!(validate(p(2), &[p(3)], &s).is_err());
    }
}