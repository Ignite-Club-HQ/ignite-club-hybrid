use super::*;

/// Narrow directory DTO: never return challenges, verifier keys or full State.
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdminAccountRow {
    pub account_id: String,
    pub principals: Vec<Principal>,
    pub status: AccountStatus,
    pub profile: Option<Profile>,
    pub roles: Vec<RoleGrant>,
}
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct AdminAccountPage {
    pub items: Vec<AdminAccountRow>,
    pub next: Option<String>,
}

pub fn authorize(core: &CoreState, caller: Principal) -> Outcome<()> {
    authenticated(caller)?;
    if caller == core.governor { return Ok(()); }
    let account = account_for_write(caller)?;
    if DELETION_TICKETS.with(|m| m.borrow().contains_key(&account.id)) {
        return Err("Account deletion pending".into());
    }
    if !account_has_role(core, &account.id, "app_admin", None, None, None) {
        return Err("App admin required".into());
    }
    Ok(())
}

pub fn page(core: &CoreState, query: String, after: Option<String>, limit: u16) -> Outcome<AdminAccountPage> {
    if query.len() > 128 || after.as_ref().is_some_and(|id| !valid_id(id)) || limit == 0 || limit > 100 {
        return Err("Invalid directory page".into());
    }
    use std::ops::Bound::{Excluded, Unbounded};
    let accounts: Vec<Account> = ACCOUNTS.with(|m| m.borrow()
        .range((after.map(Excluded).unwrap_or(Unbounded), Unbounded))
        .take(usize::from(limit)).map(|entry| decode(&entry.value())).collect());
    let next = (accounts.len() == usize::from(limit)).then(|| accounts.last().map(|a| a.id.clone())).flatten();
    let search = query.trim().to_lowercase();
    let items = accounts.into_iter().filter_map(|account| {
        let profile = get_profile_entry(&account.id);
        let matches = search.is_empty() || account.id.to_lowercase().contains(&search)
            || account.principals.iter().any(|p| p.to_text().contains(&search))
            || profile.as_ref().is_some_and(|p| p.display_name.to_lowercase().contains(&search));
        matches.then(|| AdminAccountRow {
            roles: core.roles.iter().filter(|r| r.account_id == account.id).cloned().collect(),
            account_id: account.id, principals: account.principals, status: account.status, profile,
        })
    }).collect();
    Ok(AdminAccountPage { items, next })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn empty_core_state(governor: Principal) -> CoreState {
        CoreState { schema: SCHEMA, governor, roles: vec![], families: vec![], exclusions: vec![], challenges: vec![], external_bindings: vec![], privacy_consents: vec![], terms_acceptances: vec![], verifiers: vec![], attestation_secret: vec![], next_challenge: 0 }
    }
    #[test]
    fn admin_directory_authorizes_existing_global_roles_not_scoped_or_suspended() {
        let governor = Principal::self_authenticating(b"admin-directory-governor");
        let admin = Principal::self_authenticating(b"admin-directory-admin");
        let ordinary = Principal::self_authenticating(b"admin-directory-member");
        let id = ensure_account(admin).unwrap();
        ensure_account(ordinary).unwrap();
        let mut core = empty_core_state(governor);
        assert!(authorize(&core, governor).is_ok());
        assert!(authorize(&core, Principal::anonymous()).is_err());
        assert!(authorize(&core, ordinary).is_err());
        core.roles.push(RoleGrant { account_id: id.clone(), role: "app_admin".into(), site_id: None, club: Some("club-a".into()), team: None });
        assert!(authorize(&core, admin).is_err());
        core.roles[0].club = None;
        assert!(authorize(&core, admin).is_ok());
        let mut account = get_account(&id).unwrap();
        account.status = AccountStatus::Suspended;
        put_account(&account);
        assert!(authorize(&core, admin).is_err());
    }
    #[test]
    fn admin_directory_pages_actual_status_and_only_target_roles() {
        let core = empty_core_state(Principal::self_authenticating(b"directory-test-governor"));
        for n in 0..3 {
            put_account(&Account { id: format!("directory-test-{n}"), principals: vec![Principal::self_authenticating([n])], version: 1, status: if n == 1 { AccountStatus::Suspended } else { AccountStatus::Active } });
        }
        let first = page(&core, "".into(), Some("directory-test-".into()), 2).unwrap();
        assert_eq!(first.items.len(), 2);
        assert_eq!(first.items[1].status, AccountStatus::Suspended);
        let second = page(&core, "directory-test".into(), first.next, 2).unwrap();
        assert_eq!(second.items[0].account_id, "directory-test-2");
        assert!(page(&core, "".into(), None, 101).is_err());
        assert!(page(&core, "".into(), None, 0).is_err());
    }
}