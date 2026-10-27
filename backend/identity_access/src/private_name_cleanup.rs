//! Narrow rehearsal-only cleanup routing. No names, ciphertext, grants or
//! browser-chosen aliases leave this reader; a registered club caller receives
//! only identity-owned account aliases and the verified original PII reference.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use super::{Account, Outcome, private_name_account_inventory::OriginalNameAuthority};

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct CleanupAccount {
    pub account_id: String,
    pub principals: Vec<Principal>,
    pub account_version: u64,
    pub revision: u64,
    pub original_authority: OriginalNameAuthority,
}

fn routing(account: &Account, profile: Option<super::Profile>, sinks: &[Principal], revision: u64) -> Outcome<CleanupAccount> {
    if account.id.is_empty() || account.id.len()>64 || account.principals.is_empty() || account.principals.len()>super::MAX_PRINCIPALS
        || account.principals.iter().any(|p| *p==Principal::anonymous() || *p==Principal::management_canister())
        || account.principals.iter().collect::<std::collections::BTreeSet<_>>().len()!=account.principals.len()
        || profile.as_ref().is_some_and(|p|p.account_id!=account.id) { return Err("Exact cleanup account aliases required".into()); }
    let original_authority=super::private_name_account_inventory::authority(&profile,&account.principals,sinks)?;
    Ok(CleanupAccount{account_id:account.id.clone(),principals:account.principals.clone(),account_version:account.version,revision,original_authority})
}

fn cleanup_account(subject: Principal) -> Outcome<Account> {
    let account=super::account_for(subject)?;
    if super::removal_pending() || !super::link_lifecycle().pending.is_empty()
        || super::DELETION_TICKETS.with(|m|m.borrow().contains_key(&account.id)) { return Err("Account lifecycle unresolved; retain cleanup".into()); }
    for alias in &account.principals {
        if super::principal_is_denied(*alias) || super::PRINCIPAL_INDEX.with(|m|m.borrow().get(&alias.to_text()))!=Some(account.id.clone()) { return Err("Cleanup alias ownership unresolved".into()); }
    }
    Ok(account)
}

#[ic_cdk::update]
async fn read_private_name_cleanup_account(subject: Principal) -> Outcome<CleanupAccount> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL")!=Some("1") { return Err("Private-name cleanup is not released".into()); }
    let caller=ic_cdk::api::msg_caller();
    let config=super::directory_config()?;
    if caller==Principal::anonymous() || !config.sources.iter().any(|(_,p)|*p==caller) { return Err("Registered cleanup club required".into()); }
    let account=cleanup_account(subject)?;
    let revision=super::profile_search_revision();
    let history=super::removal_history_revision();
    let active=||->Outcome<()>{
        if cleanup_account(subject)?!=account || revision!=super::profile_search_revision() || history!=super::removal_history_revision()
            || !config.same_configuration(&super::directory_config()?) { return Err("Cleanup account or authority changed".into()); }
        Ok(())
    };
    let inventory=super::read_registry_pages(&config.binding,active).await?;
    active()?;
    let clubs=inventory.groups.iter().flat_map(|g|g.domains.iter().filter(|d|d.domain=="club_domain").map(|d|d.canister)).collect::<Vec<_>>();
    super::group_inventory::validate(&inventory,&config.binding,&clubs,&[])?;
    if !clubs.contains(&caller) { return Err("Cleanup club is not registered".into()); }
    let sinks=inventory.groups.iter().flat_map(|g|g.domains.iter().filter(|d|d.domain=="pii_access_control").map(|d|d.canister)).collect::<Vec<_>>();
    let result=routing(&account,super::get_profile_entry(&account.id),&sinks,revision)?;
    active()?; // No await after exact aliases/original reference readback.
    Ok(result)
}

#[cfg(test)] mod tests {
    use super::*;
    fn account()->Account{Account{id:"account".into(),principals:vec![Principal::from_slice(&[2,1]),Principal::from_slice(&[3,1])],version:7,status:super::super::AccountStatus::Suspended}}
    fn profile(name:String)->super::super::Profile{super::super::Profile{account_id:"account".into(),display_name:name,avatar_ref:None,updated_at_ns:0,theme_preference:None,club_switcher_hint_seen_at:None}}
    #[test] fn suspended_accounts_retain_all_aliases_and_nonfirst_original(){
        let a=account();let sink=Principal::from_slice(&[9,1]);
        let r=routing(&a,Some(profile(format!("pii-display-name:v1:{sink}:{}",a.principals[1]))),&[sink],11).unwrap();
        assert_eq!(r.principals,a.principals);assert_eq!(r.account_version,7);assert_eq!(r.revision,11);
        assert_eq!(r.original_authority,OriginalNameAuthority::Existing{sink,subject:a.principals[1]});
    }
    #[test] fn plaintext_and_profileless_accounts_never_infer_a_sink(){
        assert_eq!(routing(&account(),None,&[],0).unwrap().original_authority,OriginalNameAuthority::NoName);
        assert_eq!(routing(&account(),Some(profile("Private Person".into())),&[],0).unwrap().original_authority,OriginalNameAuthority::Unresolved);
    }
    #[test] fn foreign_reference_and_unregistered_original_refuse(){
        let a=account();let sink=Principal::from_slice(&[9,1]);
        assert!(routing(&a,Some(profile(format!("pii-display-name:v1:{sink}:{}",a.principals[1]))),&[],0).is_err());
        assert!(routing(&a,Some(profile(format!("pii-display-name:v1:{sink}:{sink}"))),&[sink],0).is_err());
    }
    #[test] fn ambiguous_aliases_and_foreign_profiles_refuse(){
        let a=account();assert!(routing(&Account{principals:vec![a.principals[0];2],..a.clone()},None,&[],0).is_err());
        let mut p=profile(String::new());p.account_id="foreign".into();assert!(routing(&a,Some(p),&[],0).is_err());
    }
}