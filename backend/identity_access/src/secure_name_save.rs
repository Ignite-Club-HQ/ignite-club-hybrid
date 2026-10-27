//! Ordinary own-name saving is released separately from private audiences and
//! bulk conversion. The original PII service is operator-pinned, never selected
//! by a browser reference.
use candid::Principal;

pub fn authority(released: bool, configured: Option<&str>, existing: Option<&str>, caller: Principal) -> Result<Principal, String> {
    if !released { return Err("Secure personal-name saving is not released".into()); }
    let authority = configured.and_then(|value| Principal::from_text(value).ok())
        .filter(|p| *p != Principal::anonymous() && *p != Principal::management_canister())
        .ok_or("Secure personal-name authority is not configured")?;
    if caller == Principal::anonymous() { return Err("Sign-in required".into()); }
    if let Some(reference) = existing.filter(|name| name.starts_with("pii-display-name:")) {
        let expected = format!("pii-display-name:v1:{authority}:{caller}");
        if reference != expected { return Err("Original private-name authority or alias requires verified recovery".into()); }
    }
    Ok(authority)
}

pub fn reference_matches(value: &str, authority: Principal, caller: Principal) -> bool {
    value == format!("pii-display-name:v1:{authority}:{caller}")
}

#[cfg(test)]
mod tests {
    use super::*;
    fn principal(n: u8) -> Principal { Principal::from_slice(&[n, 1]) }
    #[test]
    fn release_is_separate_and_closed_by_default() {
        assert!(authority(false, Some(&principal(2).to_text()), None, principal(1)).is_err());
        assert!(authority(true, None, None, principal(1)).is_err());
    }
    #[test]
    fn only_operator_pinned_original_and_owner_are_accepted() {
        let owner=principal(1); let sink=principal(2);
        let reference=format!("pii-display-name:v1:{sink}:{owner}");
        assert_eq!(authority(true, Some(&sink.to_text()), Some(&reference), owner), Ok(sink));
        assert!(authority(true, Some(&principal(3).to_text()), Some(&reference), owner).is_err());
        assert!(authority(true, Some(&sink.to_text()), Some(&reference), principal(3)).is_err());
        assert!(!reference_matches("Paul Cranwell", sink, owner));
        assert!(reference_matches(&reference, sink, owner));
    }
    #[test]
    fn explicit_ordinary_first_save_can_replace_legacy_but_never_anonymous() {
        assert!(authority(true, Some(&principal(2).to_text()), Some("Before"), principal(1)).is_ok());
        assert!(authority(true, Some("2vxsx-fae"), None, principal(1)).is_err());
        assert!(authority(true, Some("aaaaa-aa"), None, principal(1)).is_err());
        assert!(authority(true, Some(&principal(2).to_text()), None, Principal::anonymous()).is_err());
    }
}