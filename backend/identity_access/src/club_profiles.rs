//! Scope validation for additive authorized candidate reads; no name index,
//! cached role grant or browser-supplied candidate list authorizes disclosure.
use candid::Principal;

pub fn validate(authority: Principal, sources: &[Principal], club: &str, subjects: &[Principal]) -> Result<Vec<Principal>, String> {
    if authority == Principal::anonymous() || !sources.contains(&authority) {
        return Err("Registered club authority required".into());
    }
    if club.trim().is_empty() || club.len() > 128 || club.trim() != club {
        return Err("Specific club required".into());
    }
    if subjects.len() > 25 { return Err("At most 25 profile candidates per request".into()); }
    if subjects.iter().any(|p| *p == Principal::anonymous()) {
        return Err("Active profile principals required".into());
    }
    let mut unique = Vec::new();
    for subject in subjects { if !unique.contains(subject) { unique.push(*subject); } }
    Ok(unique)
}

pub fn permit(member: bool, account_unchanged: bool, config_unchanged: bool) -> Result<(), String> {
    if !member || !account_unchanged || !config_unchanged {
        return Err("Club membership, account or authority changed".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn p(n: u8) -> Principal { Principal::from_slice(&[n, 1]) }
    #[test]
    fn authority_location_never_substitutes_for_registered_scope() {
        assert!(validate(p(1), &[p(2)], "club-a", &[p(3)]).is_err());
        assert!(validate(Principal::anonymous(), &[p(1)], "club-a", &[p(3)]).is_err());
        assert!(validate(p(1), &[p(1)], "", &[p(3)]).is_err());
    }
    #[test]
    fn candidate_lists_are_bounded_and_deduplicated() {
        assert_eq!(validate(p(1), &[p(1)], "club-a", &[p(3),p(3)]).unwrap(), vec![p(3)]);
        assert!(validate(p(1), &[p(1)], "club-a", &vec![p(3);26]).is_err());
        assert!(validate(p(1), &[p(1)], "club-a", &[Principal::anonymous()]).is_err());
    }
    #[test]
    fn both_caller_and_subject_membership_are_required() {
        assert!(permit(false,true,true).is_err());
        assert!(permit(true,true,true).is_ok());
    }
    #[test]
    fn_identity_or_configuration_drift_denies_disclosure() {
        assert!(permit(true,false,true).is_err());
        assert!(permit(true,true,false).is_err());
    }
}