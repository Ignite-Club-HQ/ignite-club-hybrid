//! Governor-recorded routing approval. Replaces the build-time snapshot as the
//! live approval anchor so opening a group does not require an app release.
//! Recording never changes groups, placements, assignments or either revision;
//! clients still compare the live registry against the approved digest and
//! fail closed on any mismatch.
use candid::CandidType;
use serde::{Deserialize, Serialize};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct RoutingApproval {
    pub target_alias: String,
    /// Exact configuration revision the governor verified.
    pub configuration_revision: u64,
    /// Lowercase hex SHA-256 of the canonical approved configuration text.
    pub approved_configuration_sha256: String,
    /// Every registered group for the target, all with verified removal wiring.
    pub removal_wiring_group_ids: Vec<String>,
    pub removal_checked_at_ms: u64,
    /// Lowercase hex SHA-256 of the full off-chain evidence report.
    pub evidence_sha256: String,
}

pub fn is_sha256(v: &str) -> bool { v.len() == 64 && v.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c)) }

/// `registered` is the exact set of group ids registered for the target.
pub fn validate(a: &RoutingApproval, current_configuration_revision: u64, registered: &[String]) -> Result<(), String> {
    if a.target_alias.is_empty() || a.target_alias.len() > 64 { return Err("Invalid target alias".into()); }
    if a.configuration_revision != current_configuration_revision { return Err("Configuration revision conflict".into()); }
    if !is_sha256(&a.approved_configuration_sha256) || !is_sha256(&a.evidence_sha256) { return Err("Lowercase SHA-256 evidence required".into()); }
    if a.removal_checked_at_ms == 0 { return Err("Removal wiring check time required".into()); }
    if registered.is_empty() { return Err("No registered groups to approve".into()); }
    if a.removal_wiring_group_ids.len() > 4096 { return Err("Approval group bound exceeded".into()); }
    let mut ids = a.removal_wiring_group_ids.clone(); ids.sort(); ids.dedup();
    if ids.len() != a.removal_wiring_group_ids.len() { return Err("Duplicate approved group".into()); }
    let mut want = registered.to_vec(); want.sort();
    if ids != want { return Err("Approval must cover exactly the registered groups".into()); }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn approval(rev: u64) -> RoutingApproval {
        RoutingApproval { target_alias: "mainnet".into(), configuration_revision: rev, approved_configuration_sha256: "a".repeat(64),
            removal_wiring_group_ids: vec!["g2".into(), "g3".into()], removal_checked_at_ms: 1, evidence_sha256: "b".repeat(64) }
    }
    #[test] fn exact_revision_and_group_set_required() {
        let reg = vec!["g3".to_string(), "g2".to_string()];
        assert!(validate(&approval(5), 5, &reg).is_ok());
        assert!(validate(&approval(5), 6, &reg).is_err());
        assert!(validate(&approval(5), 5, &["g2".to_string()]).is_err());
        assert!(validate(&approval(5), 5, &[]).is_err());
        let mut dup = approval(5); dup.removal_wiring_group_ids = vec!["g2".into(), "g2".into()];
        assert!(validate(&dup, 5, &["g2".to_string()]).is_err());
    }
    #[test] fn evidence_must_be_lowercase_sha256() {
        let reg = vec!["g2".to_string(), "g3".to_string()];
        let mut a = approval(1); a.approved_configuration_sha256 = "A".repeat(64);
        assert!(validate(&a, 1, &reg).is_err());
        let mut b = approval(1); b.evidence_sha256 = "b".repeat(63);
        assert!(validate(&b, 1, &reg).is_err());
        let mut c = approval(1); c.removal_checked_at_ms = 0;
        assert!(validate(&c, 1, &reg).is_err());
    }
}
