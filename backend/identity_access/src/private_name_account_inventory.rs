//! Bounded account-first evidence under an exact, drained exclusive window.
//! This is not pre-plan freeze admission or a production activation switch.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use super::{Account, Profile, Outcome, private_name_writer_window::WriterRequest};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountInventoryCursor { pub phase: u8, pub after: Option<String>, pub revision: u64 }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum OriginalNameAuthority {
    NoName,
    Unresolved,
    Existing { sink: Principal, subject: Principal },
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountInventoryRow {
    pub account: Account, pub profile: Option<Profile>,
    pub original_authority: OriginalNameAuthority, pub source_digest: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AccountInventoryPage {
    pub request: WriterRequest, pub revision: u64, pub scanned: u16,
    pub rows: Vec<AccountInventoryRow>, pub next: Option<AccountInventoryCursor>,
}

pub(super) fn authority(profile: &Option<Profile>, aliases: &[Principal], sinks: &[Principal]) -> Outcome<OriginalNameAuthority> {
    let Some(profile) = profile else { return Ok(OriginalNameAuthority::NoName) };
    if profile.display_name.is_empty() { return Ok(OriginalNameAuthority::NoName); }
    if !profile.display_name.starts_with("pii-display-name:") { return Ok(OriginalNameAuthority::Unresolved); }
    if !super::private_profile_reference::valid(&profile.display_name, aliases) { return Err("Invalid original name reference".into()); }
    let parts: Vec<_> = profile.display_name.split(':').collect();
    let sink = Principal::from_text(parts[2]).map_err(|_| "Invalid original name authority")?;
    let subject = Principal::from_text(parts[3]).map_err(|_| "Invalid original name subject")?;
    if sink == Principal::management_canister() || !sinks.contains(&sink) { return Err("Original name authority omitted".into()); }
    Ok(OriginalNameAuthority::Existing { sink, subject })
}
fn row(account: Account, profile: Option<Profile>, sinks: &[Principal]) -> Outcome<AccountInventoryRow> {
    if account.id.is_empty() || account.id.len() > 64 || account.principals.is_empty()
        || account.principals.len() > super::MAX_PRINCIPALS
        || account.principals.iter().any(|p| *p == Principal::anonymous() || *p == Principal::management_canister())
        || account.principals.iter().collect::<std::collections::BTreeSet<_>>().len() != account.principals.len()
        || profile.as_ref().is_some_and(|p| p.account_id != account.id) { return Err("Invalid account/profile/alias inventory".into()); }
    let original_authority = authority(&profile, &account.principals, sinks)?;
    // A separate optional-profile digest; existing signed (Account, Profile)
    // source digests remain unchanged.
    let source_digest = Sha256::digest(super::encode(&(account.clone(), profile.clone()))).to_vec();
    Ok(AccountInventoryRow { account, profile, original_authority, source_digest })
}
fn require_locked(w: &super::private_name_write_coordinator::WriteWindow) -> Outcome<()> {
    use super::private_name_write_coordinator::WritePhase;
    let prep=super::private_name_writer_window::preparation(&w.request);
    let allowed=if prep{w.phase==WritePhase::Fencing}else{super::private_name_writer_window::exclusive(&w.request)&&w.phase==WritePhase::Writing};
    if !allowed
        || w.opened.len() != w.writers.len()
        || w.writers.iter().any(|target| w.opened.iter().filter(|r| r.receiver == *target && r.request == w.request && !r.closing && !r.sealed && r.active == candid::Nat::from(0u8)).count() != 1) {
        return Err("Exact drained exclusive conversion window required".into());
    }
    Ok(())
}
#[ic_cdk::update]
fn read_private_name_account_inventory(operation_id: String, expected: WriterRequest, cursor: Option<AccountInventoryCursor>, limit: u16) -> Outcome<AccountInventoryPage> {
    super::private_name_write_coordinator::access()?;
    let w = super::private_name_write_coordinator::get(&operation_id)?;
    require_locked(&w)?;
    if super::private_name_writer_window::preparation(&w.request) && super::private_name_conversion_approval::has_approval(&operation_id){return Err("Preparation inventory closed after signed admission".into());}
    if expected != w.request || limit == 0 || limit > 100 { return Err("Exact bounded account inventory required".into()); }
    if super::removal_pending() || !super::link_lifecycle().pending.is_empty() || super::DELETION_TICKETS.with(|m| !m.borrow().is_empty()) {
        return Err("Account lifecycle remains unresolved".into());
    }
    let revision = super::profile_search_revision();
    let c = cursor.unwrap_or(AccountInventoryCursor { phase: 0, after: None, revision });
    if c.revision != revision || c.phase > 1 || c.after.as_ref().is_some_and(|s| s.is_empty() || s.len() > 64) { return Err("Account inventory cursor changed".into()); }
    let bounds = c.after.clone().map(|s| (std::ops::Bound::Excluded(s), std::ops::Bound::Unbounded))
        .unwrap_or((std::ops::Bound::Unbounded, std::ops::Bound::Unbounded));
    let mut rows = vec![];
    let (scanned, after, more) = if c.phase == 0 {
        let entries: Vec<_> = super::ACCOUNTS.with(|m| m.borrow().range(bounds).take(limit as usize + 1).map(|e| (e.key().clone(), e.value())).collect());
        let more = entries.len() > limit as usize;
        let mut after = None;
        for (id, bytes) in entries.into_iter().take(limit as usize) {
            let account: Account = super::decode(&bytes);
            if account.id != id || super::account_is_erased(&id) { return Err("Account inventory integrity mismatch".into()); }
            for alias in &account.principals {
                if super::PRINCIPAL_INDEX.with(|m| m.borrow().get(&alias.to_text())) != Some(id.clone()) || super::principal_is_denied(*alias) { return Err("Account alias ownership unresolved".into()); }
            }
            rows.push(row(account, super::get_profile_entry(&id), &w.sinks)?); after = Some(id);
        }
        (rows.len() as u16, after, more)
    } else {
        // Separate bounded profile traversal catches dangling profiles instead
        // of silently dropping them from a profile/account join.
        let entries: Vec<_> = super::PROFILES.with(|m| m.borrow().range(bounds).take(limit as usize + 1).map(|e| (e.key().clone(), e.value())).collect());
        let more = entries.len() > limit as usize;
        let mut scanned = 0; let mut after = None;
        for (id, bytes) in entries.into_iter().take(limit as usize) {
            let profile: Profile = super::decode(&bytes);
            if profile.account_id != id || super::get_account(&id).is_none() { return Err("Dangling profile blocks complete inventory".into()); }
            scanned += 1; after = Some(id);
        }
        (scanned, after, more)
    };
    let next = if more { Some(AccountInventoryCursor { phase: c.phase, after, revision }) }
        else if c.phase == 0 { Some(AccountInventoryCursor { phase: 1, after: None, revision }) } else { None };
    Ok(AccountInventoryPage { request: w.request, revision, scanned, rows, next })
}

#[cfg(test)] mod tests {
    use super::*;
    fn account() -> Account { Account { id: "a".into(), principals: vec![Principal::from_slice(&[2,1]),Principal::from_slice(&[3,1])], version: 9007199254740993, status: super::super::AccountStatus::Suspended } }
    fn profile(name: String) -> Option<Profile> { Some(Profile { account_id: "a".into(), display_name: name, avatar_ref: None, updated_at_ns: 1, theme_preference: None, club_switcher_hint_seen_at: None }) }
    #[test] fn profileless_suspended_accounts_and_all_aliases_survive() {
        let a = account(); let r = row(a.clone(), None, &[]).unwrap();
        assert_eq!(r.account, a); assert_eq!(r.original_authority, OriginalNameAuthority::NoName); assert_eq!(r.source_digest.len(), 32);
    }
    #[test] fn plaintext_authority_is_never_guessed_from_first_alias() {
        assert_eq!(row(account(), profile("Paul".into()), &[]).unwrap().original_authority, OriginalNameAuthority::Unresolved);
    }
    #[test] fn original_authority_can_bind_nonfirst_alias_only_in_inventory() {
        let a = account(); let sink = Principal::from_slice(&[9,1]);
        let p = profile(format!("pii-display-name:v1:{sink}:{}",a.principals[1]));
        assert_eq!(row(a.clone(),p.clone(),&[sink]).unwrap().original_authority, OriginalNameAuthority::Existing { sink, subject:a.principals[1] });
        assert!(row(a,p,&[]).is_err());
    }
    #[test] fn source_digest_binds_aliases_status_version_and_profile_presence() {
        let a = account(); let base = row(a.clone(),None,&[]).unwrap().source_digest;
        for changed in [Account {version:a.version+1,..a.clone()},Account {status:super::super::AccountStatus::Active,..a.clone()},Account {principals:vec![a.principals[0]],..a.clone()}] { assert_ne!(row(changed,None,&[]).unwrap().source_digest,base); }
        assert_ne!(row(a,profile(String::new()),&[]).unwrap().source_digest,base);
    }
    #[test] fn duplicate_anonymous_and_foreign_profile_are_refused() {
        let a = account(); assert!(row(Account {principals:vec![a.principals[0];2],..a.clone()},None,&[]).is_err());
        assert!(row(Account {principals:vec![Principal::anonymous()],..a.clone()},None,&[]).is_err());
        let mut p = profile("Paul".into()).unwrap(); p.account_id="other".into(); assert!(row(a,Some(p),&[]).is_err());
    }
}