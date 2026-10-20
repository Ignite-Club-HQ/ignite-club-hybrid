//! Narrow registry reservation, not an all-service admission/drain protocol.
use super::*;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct Ticket { pub account: Account, pub binding: group_inventory::Binding }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
struct Lock { account_id: String, revision: u64 }
fn ticket(id: &str) -> Option<Ticket> {
    DELETION_TICKETS.with(|m| m.borrow().get(&id.to_string())).map(|b| decode(&b))
}
fn authorized(id: &str, caller: Principal) -> Outcome<()> {
    let a=account_for(caller)?; let s=state();
    if a.id!=id && caller!=s.governor && !account_has_role(&s,&a.id,"app_admin",None,None,None) { return Err("Forbidden".into()); }
    Ok(())
}
async fn acquire(t: &Ticket) -> Outcome<()> {
    let response=ic_cdk::call::Call::bounded_wait(t.binding.registry,"acquire_deletion_lock")
        .with_args(&(t.account.id.clone(),t.binding.registry_revision)).await.map_err(|_| "Deletion reservation outcome uncertain; retry exact ticket")?;
    let result: Outcome<Lock>=response.candid().map_err(|_| "Invalid deletion lock reply")?;
    let lock=result?;
    if lock.account_id!=t.account.id || lock.revision!=t.binding.registry_revision { return Err("Foreign deletion lock".into()); }
    Ok(())
}
#[ic_cdk::update]
pub async fn prepare_account_deletion(account_id: String, expected_revision: u64) -> Outcome<Ticket> {
    // Keep this additive protocol unavailable until a separately approved release.
    if !bound_deletion_released() { return Err("Bound deletion not released".into()); }
    let caller=ic_cdk::api::msg_caller(); authorized(&account_id,caller)?;
    let binding=group_inventory_binding().ok_or("Deletion registry not pinned")?;
    if binding.registry_revision!=expected_revision { return Err("Deletion registry revision changed".into()); }
    let account=get_account(&account_id).ok_or("Unknown account")?;
    if account.principals.contains(&state().governor) || removal_intent(&account_id).is_some() ||
        link_lifecycle().pending.iter().any(|j|j.account_id==account_id) { return Err("Account cannot enter bound deletion".into()); }
    let t=Ticket { account,binding };
    if let Some(prior)=ticket(&account_id) {
        if prior!=t { return Err("Deletion ticket changed; reservation retained".into()); }
    } else {
        if DELETION_TICKETS.with(|m|m.borrow().len())>=MAX_ACCOUNTS as u64 { return Err("Deletion ticket capacity".into()); }
        // Persist intent BEFORE the reservation request; reply loss must not retarget it.
        DELETION_TICKETS.with(|m|m.borrow_mut().insert(account_id.clone(),encode(&t)));
    }
    acquire(&t).await?;
    authorized(&account_id,caller)?;
    if ticket(&account_id).as_ref()!=Some(&t) || get_account(&account_id).as_ref()!=Some(&t.account) || group_inventory_binding().as_ref()!=Some(&t.binding) {
        return Err("Deletion account or binding changed; reservation retained".into());
    }
    Ok(t)
}
#[ic_cdk::update]
pub async fn commit_account_deletion(account_id: String) -> Outcome<()> {
    if !bound_deletion_released() { return Err("Bound deletion not released".into()); }
    let caller=ic_cdk::api::msg_caller(); authorized(&account_id,caller)?;
    let t=ticket(&account_id).ok_or("Missing deletion ticket")?;
    acquire(&t).await?;
    authorized(&account_id,caller)?;
    if get_account(&account_id).as_ref()!=Some(&t.account) || group_inventory_binding().as_ref()!=Some(&t.binding) { return Err("Deletion account or binding changed; reservation retained".into()); }
    let snapshot = read_registry_pages(&t.binding, || {
        authorized(&account_id, caller)?;
        if ticket(&account_id).as_ref()!=Some(&t) || get_account(&account_id).as_ref()!=Some(&t.account) || group_inventory_binding().as_ref()!=Some(&t.binding) {
            return Err("Deletion account or binding changed; reservation retained".into());
        }
        Ok(())
    }).await?;
    group_inventory::validate(&snapshot,&t.binding,&link_lifecycle().authorities,&[])?;
    // Read club-local authorization for every captured alias, not browser receipts.
    for group in &snapshot.groups {
        let club=group.domains.iter().find(|d|d.domain=="club_domain").ok_or("Missing club authority")?.canister;
        let response=ic_cdk::call::Call::bounded_wait(club,"read_account_membership_erased").with_arg(&t.account.principals)
            .await.map_err(|_| "Club deletion verification unavailable; reservation retained")?;
        let removed: bool=response.candid().map_err(|_| "Invalid club deletion verification")?;
        if !removed { return Err("Club access remains; reservation retained".into()); }
    }
    // No awaits between final local validation and erasure. Remote registry is held.
    authorized(&account_id,caller)?;
    if ticket(&account_id).as_ref()!=Some(&t) || get_account(&account_id).as_ref()!=Some(&t.account) || group_inventory_binding().as_ref()!=Some(&t.binding) {
        return Err("Deletion account or binding changed; reservation retained".into());
    }
    let mut s=state(); erase_account_core(&mut s,&t.account)?; store(&s);
    // Ticket is retained until explicit post-commit settlement, including reply loss.
    Ok(())
}
async fn release(t: &Ticket) -> Outcome<()> {
    let response=ic_cdk::call::Call::bounded_wait(t.binding.registry,"release_deletion_lock")
        .with_args(&(t.account.id.clone(),t.binding.registry_revision)).await.map_err(|_| "Deletion release outcome uncertain; retry exact ticket")?;
    let result: Outcome<()>=response.candid().map_err(|_| "Invalid deletion lock release")?; result
}
fn recoverable(t: &Ticket) -> Outcome<()> {
    if account_is_erased(&t.account.id) { return Err("Deletion already committed; settle instead".into()); }
    if get_account(&t.account.id).as_ref()!=Some(&t.account) { return Err("Deletion account changed; reservation retained".into()); }
    Ok(())
}
#[ic_cdk::update]
pub async fn cancel_account_deletion(account_id: String) -> Outcome<()> {
    if !bound_deletion_released() { return Err("Bound deletion not released".into()); }
    let caller=ic_cdk::api::msg_caller(); authorized(&account_id,caller)?;
    let t=ticket(&account_id).ok_or("Missing deletion ticket")?;
    recoverable(&t)?;
    // Release is idempotent at the ticket's pinned revision; a stale ticket can never release a newer lock.
    release(&t).await?;
    // A commit interleaved after the release fails its final ticket check, so cancellation wins pre-commit.
    if account_is_erased(&account_id) { return Err("Deletion committed during cancel; settle instead".into()); }
    DELETION_TICKETS.with(|m|m.borrow_mut().remove(&account_id)); Ok(())
}
#[ic_cdk::update]
pub async fn settle_account_deletion(account_id: String) -> Outcome<()> {
    if !bound_deletion_released() { return Err("Bound deletion not released".into()); }
    let caller=ic_cdk::api::msg_caller();
    let Some(t)=ticket(&account_id) else { return Err("Missing deletion ticket".into()); };
    if caller!=state().governor && !t.account.principals.contains(&caller) { authorized(&account_id,caller)?; }
    if !account_is_erased(&account_id) { return Err("Deletion not committed; reservation retained".into()); }
    let response=ic_cdk::call::Call::bounded_wait(t.binding.registry,"release_deletion_lock")
        .with_args(&(account_id.clone(),t.binding.registry_revision)).await.map_err(|_| "Deletion settlement uncertain; retry")?;
    let result: Outcome<()>=response.candid().map_err(|_| "Invalid deletion settlement")?; result?;
    DELETION_TICKETS.with(|m|m.borrow_mut().remove(&account_id)); Ok(())
}