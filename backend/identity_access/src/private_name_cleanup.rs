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

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct CleanupIntent { pub id: String, pub club: String, pub user: Principal, pub account: Option<CleanupAccount>, pub submitted: bool }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize)]
struct CleanupProof { intent: CleanupIntent, members: Vec<bool> }

fn verify_removed(proof: &CleanupProof, id: &str, club: &str, account: &CleanupAccount, sink: Principal, subject: Principal) -> Outcome<()> {
    if proof.intent.id != id || proof.intent.club != club || proof.intent.account.as_ref() != Some(account)
        || !proof.intent.submitted || !account.principals.contains(&proof.intent.user)
        || proof.members.len() != account.principals.len() || proof.members.iter().any(|v| *v)
        || account.original_authority != (OriginalNameAuthority::Existing { sink, subject }) {
        return Err("Exact retained nonmembership proof required".into());
    }
    Ok(())
}

/// Original PII alone requests authorization; the registered owning club supplies
/// the retained operation and atomic all-alias nonmembership, not a browser.
#[ic_cdk::update]
async fn authorize_private_name_removal(authority: Principal, club: String, subject: Principal, id: String) -> Outcome<CleanupAccount> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL") != Some("1") && option_env!("IGNITE_PRIVATE_NAME_CLEANUP_RELEASE") != Some("1") { return Err("Private-name cleanup is not released".into()); }
    let sink = ic_cdk::api::msg_caller();
    if !super::service_authorities().contains(&sink) || club.is_empty() || club.len()>128 || id.is_empty() || id.len()>256 { return Err("Exact configured cleanup service required".into()); }
    let config = super::directory_config()?;
    let source = config.sources.iter().find(|(_,p)| *p==authority).ok_or("Registered cleanup club required")?.0.clone();
    let account = cleanup_account(subject)?;
    let revision = super::profile_search_revision(); let history = super::removal_history_revision();
    let active = || -> Outcome<()> {
        if cleanup_account(subject)? != account || revision!=super::profile_search_revision() || history!=super::removal_history_revision()
            || !config.same_configuration(&super::directory_config()?) { return Err("Cleanup account or authority changed".into()); } Ok(())
    };
    let inventory = super::read_registry_pages(&config.binding, active).await?; active()?;
    let clubs=inventory.groups.iter().flat_map(|g|g.domains.iter().filter(|d|d.domain=="club_domain").map(|d|d.canister)).collect::<Vec<_>>();
    super::group_inventory::validate(&inventory,&config.binding,&clubs,&[])?;
    let sinks=inventory.groups.iter().flat_map(|g|g.domains.iter().filter(|d|d.domain=="pii_access_control").map(|d|d.canister)).collect::<Vec<_>>();
    let expected=routing(&account,super::get_profile_entry(&account.id),&sinks,revision)?;
    if !clubs.contains(&authority) || expected.original_authority != (OriginalNameAuthority::Existing{sink,subject}) { return Err("Original cleanup authority changed".into()); }
    let location=ic_cdk::call::Call::bounded_wait(config.binding.registry,"read_hosted_club_assignment")
        .with_args(&(club.clone(),config.binding.target_alias.clone(),config.binding.registry_revision)).await.map_err(|_|"Cleanup club ownership unavailable")?;
    active()?;
    let location:super::membership_transport::Reply<super::membership_locations::Assignment>=location.candid().map_err(|_|"Invalid cleanup club ownership")?;
    match location { super::membership_transport::Reply::Ok(row)=>super::membership_locations::verify(&club,&source,authority,&row,&config.sources,config.binding.registry_revision)?,
        super::membership_transport::Reply::Err(e)=>return Err(e) }
    for _ in 0..2 {
        let reply=ic_cdk::call::Call::bounded_wait(authority,"read_private_name_removal_proof").with_args(&(id.clone(),)).await.map_err(|_|"Cleanup proof unavailable")?;
        active()?;
        let proof:Outcome<CleanupProof>=reply.candid().map_err(|_|"Invalid cleanup proof")?;
        verify_removed(&proof?,&id,&club,&expected,sink,subject)?;
    }
    active()?; Ok(expected)
}

#[ic_cdk::update]
async fn read_private_name_cleanup_account(subject: Principal) -> Outcome<CleanupAccount> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL")!=Some("1") && option_env!("IGNITE_PRIVATE_NAME_CLEANUP_RELEASE")!=Some("1") { return Err("Private-name cleanup is not released".into()); }
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
    let mut result=routing(&account,super::get_profile_entry(&account.id),&sinks,revision)?;
    if !matches!(result.original_authority,OriginalNameAuthority::Existing{..}) {
        // Plaintext/profileless is not proof that no old replicas exist. Every
        // registered sink must confirm absence before releasing the club lock.
        if sinks.is_empty() || sinks.len()>99 { return Err("Complete cleanup sink inventory required".into()); }
        for sink in &sinks {
            let reply=ic_cdk::call::Call::bounded_wait(*sink,"read_private_name_cleanup_absence")
                .with_args(&(account.principals.clone(),Option::<String>::None)).await.map_err(|_|"Cleanup absence unavailable")?;
            active()?;
            let absent:Outcome<bool>=reply.candid().map_err(|_|"Invalid cleanup absence")?;
            if !absent? { return Err("Unresolved name replicas; retain cleanup".into()); }
        }
        result.original_authority=OriginalNameAuthority::NoName;
    }
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
    #[test] fn removal_requires_every_alias_absent_and_exact_saved_authority(){
        let a=account();let sink=Principal::from_slice(&[9,1]);let subject=a.principals[1];
        let saved=routing(&a,Some(profile(format!("pii-display-name:v1:{sink}:{subject}"))),&[sink],11).unwrap();
        let mut proof=CleanupProof{intent:CleanupIntent{id:"op".into(),club:"club".into(),user:a.principals[0],account:Some(saved.clone()),submitted:true},members:vec![false,false]};
        assert!(verify_removed(&proof,"op","club",&saved,sink,subject).is_ok());
        proof.members[1]=true;assert!(verify_removed(&proof,"op","club",&saved,sink,subject).is_err());
        proof.members=vec![false];assert!(verify_removed(&proof,"op","club",&saved,sink,subject).is_err());
        proof.members=vec![false,false];assert!(verify_removed(&proof,"other","club",&saved,sink,subject).is_err());
        assert!(verify_removed(&proof,"op","club",&saved,subject,subject).is_err());
        proof.intent.submitted=false;assert!(verify_removed(&proof,"op","club",&saved,sink,subject).is_err());
    }
}