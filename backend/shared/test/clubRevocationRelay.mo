import Principal "mo:core/Principal";
// Local test relay only. Permission comes from the real club canister;
// the first reply can be held while actual membership is revoked.
persistent actor class ClubRevocationRelay(authority : Principal) = this {
  var calls : Nat = 0;
  var held : Bool = false;
  var released : Bool = true;
  public shared func hold() : async () { calls := 0; held := false; released := false };
  public shared func release() : async () { released := true };
  public query func progress() : async Bool { held and not released };
  public shared func pulse() : async () {};
  public shared func read_has_club_membership(user : Principal, club : Text) : async Bool {
    let actual : actor { read_has_club_membership : shared (Principal, Text) -> async Bool } = actor(authority.toText());
    let snapshot = await actual.read_has_club_membership(user, club);
    calls += 1;
    if (calls == 1 and not released) {
      held := true;
      while (not released) { await this.pulse() }
    };
    snapshot
  };
}