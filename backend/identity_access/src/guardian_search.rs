//! Guardian linking is the sole ordinary-user full-directory search purpose.
//! The authority is checked against configured sources before any remote call.
use candid::Principal;
use candid::CandidType;
use serde::{Deserialize, Serialize};

pub const SCAN_LIMIT: usize = 100;
pub const RESULT_LIMIT: usize = 25;

#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq, Eq)]
pub struct Cursor {
    pub after: String,
    pub revision: u64,
    pub binding: Vec<u8>,
    pub expires_at_ns: u64,
}

pub fn validate_cursor(cursor: &Cursor, revision: u64, binding: &[u8], now: u64) -> Result<(), String> {
    if cursor.after.is_empty() || cursor.after.len() > 128 || cursor.revision != revision || cursor.binding != binding || cursor.expires_at_ns <= now || cursor.expires_at_ns.saturating_sub(now)>300_000_000_000 {
        return Err("Guardian search continuation changed or expired".into());
    }
    Ok(())
}

pub fn validate_scope(authority: Principal, sources: &[Principal], child: &str) -> Result<(), String> {
    if authority == Principal::anonymous() || authority == Principal::management_canister() || !sources.contains(&authority) {
        return Err("Registered child authority required".into());
    }
    if child.trim().is_empty() || child != child.trim() || child.len() > 128 { return Err("Specific child required".into()); }
    Ok(())
}

pub fn permit_disclosure(guardian: bool, account_unchanged: bool, authority_unchanged: bool) -> Result<(), String> {
    if !guardian || !account_unchanged || !authority_unchanged {
        return Err("Guardian relationship, account or child authority changed".into());
    }
    Ok(())
}
pub fn permit_profile_revision(retained: u64, current: u64) -> Result<(), String> {
    if retained != current { return Err("Guardian search profiles changed; please try again".into()); }
    Ok(())
}

pub fn validate_request(authority: Principal, sources: &[Principal], child: &str, query: &str, limit: u16) -> Result<(String, usize), String> {
    validate_scope(authority, sources, child)?;
    let needle = query.trim().to_lowercase();
    if needle.chars().count() < 2 || needle.len() > 80 {
        return Err("Search text must be 2-80 characters".into());
    }
    Ok((needle, limit.clamp(1, 25) as usize))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn only_registered_child_authorities_can_be_called() {
        let authority = Principal::from_slice(&[10, 1]);
        let foreign = Principal::from_slice(&[11, 1]);
        assert!(validate_request(foreign, &[authority], "child-1", "Paul", 6).is_err());
        assert!(validate_request(Principal::anonymous(), &[authority], "child-1", "Paul", 6).is_err());
        assert_eq!(validate_request(authority, &[authority], "child-1", " Paul ", 6), Ok(("paul".into(), 6)));
    }
    #[test]
    fn full_search_requires_a_specific_child_and_bounded_term() {
        let authority = Principal::from_slice(&[10, 1]);
        assert!(validate_request(authority, &[authority], "", "Paul", 6).is_err());
        assert!(validate_request(authority, &[authority], "child-1", "P", 6).is_err());
        assert!(validate_request(authority, &[authority], "child-1", &"p".repeat(81), 6).is_err());
        assert_eq!(validate_request(authority, &[authority], "child-1", "Paul", 100).unwrap().1, 25);
    }
    #[test]
    fn non_guardians_never_receive_full_search_results() {
        assert!(permit_disclosure(false, true, true).is_err());
        assert!(permit_disclosure(true, true, true).is_ok());
    }
    #[test]
    fn account_or_authority_drift_refuses_disclosure() {
        assert!(permit_disclosure(true, false, true).is_err());
        assert!(permit_disclosure(true, true, false).is_err());
    }
    #[test]
    fn retained_legacy_names_refuse_profile_or_subject_link_mutation_during_final_await() {
        assert!(permit_profile_revision(7,7).is_ok());
        assert!(permit_profile_revision(7,8).is_err());
        assert!(permit_profile_revision(8,7).is_err());
    }
    #[test]
    fn cursors_bind_exact_revision_viewer_child_authority_and_expiry() {
        let c = Cursor { after: "account-1".into(), revision: 7, binding: vec![1;32], expires_at_ns: 100 };
        assert!(validate_cursor(&c,7,&[1;32],99).is_ok());
        assert!(validate_cursor(&c,8,&[1;32],99).is_err());
        assert!(validate_cursor(&c,7,&[2;32],99).is_err());
        assert!(validate_cursor(&c,7,&[1;32],100).is_err());
        let mut invalid=c; invalid.after="x".repeat(129);
        assert!(validate_cursor(&invalid,7,&[1;32],99).is_err());
    }
}