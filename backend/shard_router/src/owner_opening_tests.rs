use super::*;
fn setup() -> (Principal, Principal, OwnerOpeningApproval) {
    let gov = Principal::from_slice(&[200, 1]); let owner = Principal::from_slice(&[201, 1]);
    GOVERNOR.with(|m| m.borrow_mut().set(gov.as_slice().to_vec()));
    let mut group = groups::tests::group("g2", 0); group.accepting = false;
    group.photo_store = Some(Principal::from_slice(&[202, 1]));
    save_group(&group);
    let subnet = Principal::from_slice(&[203, 1]);
    let placement = GroupPlacement { group_id: "g2".into(), deployment_id: "mainnet".into(), deployment_revision: 1,
        host: "https://icp-api.io".into(), network_kind: "public_mainnet".into(), primary_subnet: subnet,
        approved_subnets: vec![subnet], additional_subnets_enabled: false,
        domains: group.domains.iter().map(|d| discovery::DomainPlacement { domain: d.domain.clone(), canister: d.canister, subnet }).collect() };
    GROUP_PLACEMENTS.with(|m| m.borrow_mut().insert(b"g2".to_vec(), encode(&placement)));
    (gov, owner, OwnerOpeningApproval { owner, group, placement, club_ids: vec!["00000000-0000-4000-8000-000000000001".into(), "00000000-0000-4000-8000-000000000002".into()],
        expected_revision: current_revision(), evidence_sha256: "ab".repeat(32) })
}
#[test] fn only_governor_can_open_or_stop_owner_test() {
    let (gov, owner, a) = setup();
    assert!(open_owner_group_for(owner, a.clone(), 1).is_err());
    assert!(open_owner_group_for(Principal::anonymous(), a.clone(), 1).is_err());
    open_owner_group_for(gov, a, 1).unwrap();
    assert!(stop_owner_group_for(owner, "mainnet".into(), current_revision()).is_err());
}
#[test] fn exact_revision_inventory_and_health_are_mandatory() {
    let (gov, _, a) = setup();
    let mut bad = a.clone(); bad.expected_revision += 1; assert!(open_owner_group_for(gov, bad, 1).is_err());
    let mut bad = a.clone(); bad.group.photo_store = None; assert!(open_owner_group_for(gov, bad, 1).is_err());
    assert!(open_owner_group_for(gov, a.clone(), groups::MAX_READING_AGE_NS + 2).is_err());
    let mut bad = a; bad.group.id = "g1".into(); assert!(open_owner_group_for(gov, bad, 1).is_err());
}
#[test] fn bounded_owner_uuid_admission_never_opens_general_group() {
    let (gov, owner, a) = setup(); let id = a.club_ids[0].clone();
    let receipt = open_owner_group_for(gov, a.clone(), 1).unwrap();
    assert_eq!(open_owner_group_for(gov, a, 1).unwrap(), receipt);
    assert!(!group_for("g2").unwrap().accepting);
    assert!(place_new_club_for(Principal::from_slice(&[204, 1]), id.clone(), "mainnet".into(), 1).is_err());
    assert!(place_new_club_for(owner, "00000000-0000-4000-8000-000000000099".into(), "mainnet".into(), 1).is_err());
    let placed = place_new_club_for(owner, id.clone(), "mainnet".into(), 1).unwrap();
    assert_eq!(placed.group_id, "g2");
    assert_eq!(place_new_club_for(owner, id, "mainnet".into(), 1).unwrap(), placed);
    assert_eq!(group_for("g2").unwrap().assigned_clubs, 1);
}
#[test] fn stopping_preserves_existing_assignment_and_refuses_unused_uuid() {
    let (gov, owner, a) = setup(); let first = a.club_ids[0].clone(); let unused = a.club_ids[1].clone();
    open_owner_group_for(gov, a.clone(), 1).unwrap();
    let placed = place_new_club_for(owner, first.clone(), "mainnet".into(), 1).unwrap();
    assert!(stop_owner_group_for(gov, "mainnet".into(), current_revision() + 1).is_err());
    stop_owner_group_for(gov, "mainnet".into(), current_revision()).unwrap();
    assert_eq!(place_new_club_for(owner, first, "mainnet".into(), 1).unwrap(), placed);
    assert!(place_new_club_for(owner, unused, "mainnet".into(), 1).is_err());
    assert!(open_owner_group_for(gov, a, 1).is_err());
    assert!(!owner_opening("mainnet").unwrap().accepting_new);
}
#[test] fn deletion_locks_block_owner_opening_and_placement() {
    let (gov, owner, a) = setup();
    DELETION_LOCKS.with(|m| m.borrow_mut().insert("locked".into(), encode(&DeletionLock { account_id: "locked".into(), revision: current_revision() })));
    assert!(open_owner_group_for(gov, a.clone(), 1).is_err());
    DELETION_LOCKS.with(|m| m.borrow_mut().remove(&"locked".into()));
    open_owner_group_for(gov, a.clone(), 1).unwrap();
    DELETION_LOCKS.with(|m| m.borrow_mut().insert("locked".into(), encode(&DeletionLock { account_id: "locked".into(), revision: current_revision() })));
    // No mutation under deletion locks, even on the isolated path.
    assert!(place_new_club_for(owner, a.club_ids[0].clone(), "mainnet".into(), 1).is_err());
}