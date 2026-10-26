import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Profile "../../club_domain/src/profileMembership";
// Disposable PocketIC fixture only; never imported by a production actor.
// Forwards real membership decisions and delays replies, not their evaluation.
persistent actor class ProfileMembershipBatchRelay(owner : Principal, authority : Principal, identity : Principal) = this {
  var calls : Nat = 0;
  var holdAt : Nat = 0;
  var held : Nat = 0;
  var released : Bool = true;
  public shared ({ caller }) func hold_on(n : Nat) : async () {
    if (caller != owner or (n != 1 and n != 2)) Runtime.trap("Test owner and exact reply required");
    calls := 0; holdAt := n; held := 0; released := false;
  };
  public shared ({ caller }) func release() : async () {
    if (caller != owner) Runtime.trap("Test owner required");
    released := true;
  };
  public query func progress() : async (Nat, Nat, Bool) { (calls, held, released) };
  public shared ({ caller }) func pulse() : async () {
    if (caller != Principal.fromActor(this)) Runtime.trap("Local test pulse required");
  };
  public shared ({ caller }) func read_profile_membership_batch(requester : Principal, club : Text, subjects : [Principal], expected : ?Nat) : async { #Ok : Profile.Batch; #Err : Text } {
    if (caller != identity) return #Err("Test identity authority required");
    let actual : actor { read_profile_membership_batch : shared (Principal, Text, [Principal], ?Nat) -> async { #Ok : Profile.Batch; #Err : Text } } = actor(authority.toText());
    let snapshot = await actual.read_profile_membership_batch(requester, club, subjects, expected);
    calls += 1;
    if (calls == holdAt and not released) {
      held := calls;
      while (not released) { await this.pulse() };
    };
    snapshot
  };
}