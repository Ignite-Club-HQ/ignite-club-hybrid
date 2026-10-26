import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Policy "../../messaging_domain/src/privateDirectNames";

// Disposable PocketIC transport only. Forwards the real messaging decision,
// then holds its reply to exercise identity/original-PII closing checks.
persistent actor class PrivateDirectNameRelay(owner : Principal, authority : Principal, identity : Principal) = this {
  var calls : Nat = 0;
  var holdAt : Nat = 0;
  var held : Nat = 0;
  var released : Bool = true;
  public shared ({ caller }) func hold_on(n : Nat) : async () {
    if (caller != owner or n < 1 or n > 4) Runtime.trap("Owner and exact private-name reply required");
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
  public shared ({ caller }) func read_profile_direct_batch(requester : Principal, conversation : Text, subjects : [Principal], expected : ?Nat) : async { #Ok : Policy.Batch; #Err : Text } {
    if (caller != identity) return #Err("Exact test identity required");
    let actual : actor { read_profile_direct_batch : shared (Principal, Text, [Principal], ?Nat) -> async { #Ok : Policy.Batch; #Err : Text } } = actor(authority.toText());
    let snapshot = await (with timeout = 10) actual.read_profile_direct_batch(requester, conversation, subjects, expected);
    calls += 1;
    if (calls == holdAt and not released) {
      held := calls;
      while (not released) { await this.pulse() };
    };
    snapshot
  };
};