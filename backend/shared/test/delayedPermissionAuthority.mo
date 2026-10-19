import Principal "mo:core/Principal";

// Local PocketIC fixture only; never deployed or imported by production code.
persistent actor DelayedPermissionAuthority {
  var calls : Nat = 0;
  var holdAt : Nat = 0;
  var released : Bool = true;
  public shared func hold_on(n : Nat) : async () { calls := 0; holdAt := n; released := false };
  public shared func release() : async () { released := true };
  public query func progress() : async (Nat, Bool) { (calls, released) };
  public shared func pulse() : async () {};
  func delay() : async () {
    calls += 1;
    if (calls == holdAt) {
      while (not released) { await DelayedPermissionAuthority.pulse() };
    };
  };
  public shared func get_vault_access(_id : Text, _subject : Principal) : async { #Ok : { club_id : Text; is_member : Bool; can_manage : Bool }; #Err : Text } {
    let snapshot = { club_id = "club"; is_member = true; can_manage = true };
    await delay();
    #Ok(snapshot)
  };
  public shared func get_club_subscription(_id : Text) : async { #Ok : ?{ is_pro : Bool; admin_pro_override : Bool; is_pro_football : Bool; admin_pro_football_override : Bool; is_trial : Bool }; #Err : Text } {
    await delay();
    #Ok(?{ is_pro = false; admin_pro_override = false; is_pro_football = false; admin_pro_football_override = false; is_trial = false })
  };
  public shared func read_has_club_membership(_subject : Principal, _club : Text) : async Bool {
    await delay();
    true
  };
  public shared func read_has_club_staff_role(_subject : Principal, _club : Text) : async Bool {
    await delay();
    true
  };
}