//! Rehearsal-only governor conversion endpoints. Never a production switch.
//! Listing is governor-only under the rehearsal flags; publishing a reference
//! additionally holds the coordinated writer-window lease, binds the exact
//! account principal and refuses to overwrite a different existing reference.
//! The canister verifies nothing about ciphertext — the caller's journal must
//! confirm encrypted readback BEFORE publishing each reference.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use super::{Outcome, Profile};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversionProfileRow {
    pub account_id: String,
    pub display_name: String,
    pub principals: Vec<Principal>,
}

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct ConversionPage {
    pub rows: Vec<ConversionProfileRow>,
    pub next: Option<String>,
}

fn access() -> Outcome<()> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != Some("1") || !super::private_name_writer_window::enabled() {
        return Err("Private-name conversion rehearsal required".into());
    }
    super::require_governor(&super::state(), ic_cdk::api::msg_caller())
}

/// Bounded governor paging over every profile, sorted by account id with an
/// exclusive cursor. Plaintext names leave the canister only through this
/// rehearsal gate; the conversion plan hash binds the exact rows seen.
#[ic_cdk::update]
fn list_profiles_for_conversion(cursor: Option<String>, limit: u16) -> Outcome<ConversionPage> {
    access()?;
    if limit == 0 || limit > 200 { return Err("Invalid conversion page size".into()); }
    if cursor.as_deref().is_some_and(|c| c.is_empty() || c.len() > 64) { return Err("Invalid conversion cursor".into()); }
    let mut rows: Vec<ConversionProfileRow> = super::all_profiles().into_iter()
        .filter(|p| cursor.as_deref().is_none_or(|c| p.account_id.as_str() > c))
        .filter_map(|p| super::get_account(&p.account_id).map(|a| ConversionProfileRow {
            account_id: p.account_id,
            display_name: p.display_name,
            principals: a.principals,
        }))
        .collect();
    rows.sort_by(|a, b| a.account_id.cmp(&b.account_id));
    let take = limit as usize;
    let next = if rows.len() > take { rows.get(take - 1).map(|r| r.account_id.clone()) } else { None };
    rows.truncate(take);
    Ok(ConversionPage { rows, next })
}

/// Pure publication decision, separated so the rules are testable without a
/// canister runtime. Returns the name to store, or None when the exact
/// reference is already published (idempotent resume).
fn conversion_target(existing: &str, reference: &str, principals: &[Principal]) -> Result<Option<String>, String> {
    if existing == reference { return Ok(None); }
    if existing.starts_with("pii-display-name:") { return Err("Profile already references a different authority".into()); }
    if !super::private_profile_reference::valid(reference, principals) { return Err("Conversion reference must bind an account principal".into()); }
    Ok(Some(reference.to_string()))
}

/// Publishes a verified PII reference over a plaintext display name. Runs only
/// inside the coordinated writer window so the privacy locks are held while
/// names move; bumps removal history so retained readbacks re-verify.
#[ic_cdk::update]
fn convert_profile_name(account_id: String, reference: String) -> Outcome<Profile> {
    access()?;
    let _private_writer_lease = super::private_name_writer_window::enter().unwrap_or_else(|reason| ic_cdk::trap(reason));
    let account = super::get_account(&account_id).ok_or("Exact conversion account required")?;
    let existing = super::get_profile_entry(&account_id).ok_or("Exact conversion profile required")?;
    let Some(target) = conversion_target(&existing.display_name, &reference, &account.principals)? else { return Ok(existing); };
    let profile = Profile { display_name: target, updated_at_ns: ic_cdk::api::time(), ..existing };
    super::put_profile_entry(&profile);
    super::bump_removal_history();
    Ok(profile)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn owner() -> Principal { Principal::from_slice(&[2; 29]) }
    fn sink() -> Principal { Principal::from_slice(&[3; 29]) }
    fn reference() -> String { format!("pii-display-name:v1:{}:{}", sink().to_text(), owner().to_text()) }

    #[test]
    fn plaintext_converts_to_exact_bound_reference() {
        assert_eq!(conversion_target("Paul Cranwell", &reference(), &[owner()]).unwrap(), Some(reference()));
    }

    #[test]
    fn same_reference_is_idempotent_resume() {
        assert_eq!(conversion_target(&reference(), &reference(), &[owner()]).unwrap(), None);
    }

    #[test]
    fn different_existing_reference_is_never_overwritten() {
        let other = format!("pii-display-name:v1:{}:{}", Principal::from_slice(&[9; 29]).to_text(), owner().to_text());
        assert!(conversion_target(&other, &reference(), &[owner()]).is_err());
    }

    #[test]
    fn reference_must_bind_an_account_principal() {
        let stranger = Principal::from_slice(&[7; 29]);
        let foreign = format!("pii-display-name:v1:{}:{}", sink().to_text(), stranger.to_text());
        assert!(conversion_target("Paul Cranwell", &foreign, &[owner()]).is_err());
        assert!(conversion_target("Paul Cranwell", "pii-display-name:v2:broken", &[owner()]).is_err());
        assert!(conversion_target("Paul Cranwell", "not-a-reference", &[owner()]).is_err());
    }
}
