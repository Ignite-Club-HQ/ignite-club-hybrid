//! Opaque profile references must bind the authenticated subject and original
//! PII authority. This validates preparation, not release or audience grants.
use candid::Principal;

pub fn valid(value: &str, owners: &[Principal]) -> bool {
    let Some(rest) = value.strip_prefix("pii-display-name:v1:") else { return false; };
    let Some((authority, subject)) = rest.split_once(':') else { return false; };
    let Ok(authority_id) = Principal::from_text(authority) else { return false; };
    let Ok(subject_id) = Principal::from_text(subject) else { return false; };
    authority_id != Principal::anonymous() && subject_id != Principal::anonymous()
        && authority_id.to_text() == authority && subject_id.to_text() == subject
        && owners.contains(&subject_id)
}

/// Ordinary saves must never downgrade encrypted storage or silently move its
/// immutable PII authority. Alias/authority changes belong to their governed
/// lifecycle operations, not an older browser's profile form.
pub fn preserves_private_name(existing: Option<&str>, replacement: &str) -> bool {
    match existing {
        Some(name) if name.starts_with("pii-display-name:") => replacement.trim() == name,
        _ => true,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn long_references_bind_original_authority_and_owner() {
        let owner = Principal::from_slice(&[2; 29]);
        let authority = Principal::from_slice(&[3; 29]);
        let reference = format!("pii-display-name:v1:{authority}:{owner}");
        assert!(reference.len() > 80);
        assert!(valid(&reference, &[owner]));
        assert!(!valid(&reference, &[authority]));
    }
    #[test]
    fn malformed_anonymous_and_future_references_are_refused() {
        let owner = Principal::from_slice(&[2, 1]);
        for reference in [format!("pii-display-name:v1:2vxsx-fae:{owner}"), format!("pii-display-name:v1:{owner}:2vxsx-fae"), format!("pii-display-name:v2:{owner}:{owner}"), format!("pii-display-name:v1:{owner}:{owner}:extra")] {
            assert!(!valid(&reference, &[owner]));
        }
    }

    #[test]
    fn ordinary_save_cannot_put_an_encrypted_name_back_in_plaintext() {
        let owner = Principal::from_slice(&[2, 1]);
        let reference = format!("pii-display-name:v1:{owner}:{owner}");
        assert!(!preserves_private_name(Some(&reference), "Paul Cranwell"));
        assert!(preserves_private_name(Some(&reference), &reference));
    }

    #[test]
    fn ordinary_save_cannot_redirect_original_pii_authority() {
        let owner = Principal::from_slice(&[2, 1]);
        let other = Principal::from_slice(&[3, 1]);
        let original = format!("pii-display-name:v1:{owner}:{owner}");
        let redirected = format!("pii-display-name:v1:{other}:{owner}");
        assert!(valid(&redirected, &[owner]));
        assert!(!preserves_private_name(Some(&original), &redirected));
    }

    #[test]
    fn first_private_save_and_legacy_names_are_not_bulk_conversion() {
        let owner = Principal::from_slice(&[2, 1]);
        let reference = format!("pii-display-name:v1:{owner}:{owner}");
        assert!(preserves_private_name(None, &reference));
        assert!(preserves_private_name(Some("Before"), "After"));
        assert!(preserves_private_name(Some("Before"), &reference));
    }
}