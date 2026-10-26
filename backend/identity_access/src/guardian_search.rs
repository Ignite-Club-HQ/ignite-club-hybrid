//! Guardian linking is the sole ordinary-user full-directory search purpose.
//! The authority is checked against configured sources before any remote call.
use candid::Principal;

pub fn permit_disclosure(guardian: bool, account_unchanged: bool, authority_unchanged: bool) -> Result<(), String> {
    if !guardian || !account_unchanged || !authority_unchanged {
        return Err("Guardian relationship, account or child authority changed".into());
    }
    Ok(())
}

pub fn validate_request(authority: Principal, sources: &[Principal], child: &str, query: &str, limit: u16) -> Result<(String, usize), String> {
    if authority == Principal::anonymous() || !sources.contains(&authority) {
        return Err("Registered child authority required".into());
    }
    if child.trim().is_empty() || child.len() > 128 {
        return Err("Specific child required".into());
    }
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
    fn_account_or_authority_drift_refuses_disclosure() {
        assert!(permit_disclosure(true, false, true).is_err());
        assert!(permit_disclosure(true, true, false).is_err());
    }
}