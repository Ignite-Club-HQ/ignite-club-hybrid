import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Fence "../PrivateNameReleaseFence";

// Disposable identity-boundary fixture, not a production authority resolver.
// Real PII/key derivation runs separately; this holds its final verifier reply.
persistent actor class Identity(owner : Principal, viewer : Principal, subject : Principal) = this {
  var pii : ?Principal = null;
  var calls : Nat = 0;
  var holdAt : Nat = 0;
  var held : Bool = false;
  var released : Bool = true;
  type Scope = { kind : Text; authority : Principal; resource : Text; profile_revision : Nat64 };
  type Row = { account_id : Text; principal : Principal; display_name : Text; avatar_ref : ?Text };
  public shared ({ caller }) func configure(id : Principal) : async () { if (caller != owner) Runtime.trap("Test owner required"); pii := ?id };
  public shared ({ caller }) func hold_on(n : Nat) : async () {
    if (caller != owner or n < 1 or n > 2) Runtime.trap("Test owner and exact reply required");
    calls := 0; holdAt := n; held := false; released := false
  };
  public query func is_held() : async Bool { held };
  public shared ({ caller }) func release() : async () { if (caller != owner) Runtime.trap("Test owner required"); released := true };
  public shared ({ caller }) func pulse() : async () { if (caller != Principal.fromActor(this)) Runtime.trap("Local test pulse required") };
  public shared ({ caller }) func read_private_profile_name_authorization(requester : Principal, subjects : [Principal], scope : Scope) : async { #Ok : [Row]; #Err : Text } {
    let id = switch (pii) { case (?id) id; case null return #Err("Test PII missing") };
    if (caller != id or requester != viewer or subjects != [subject] or scope.kind != "club" or scope.resource != "test-club") return #Err("Test audience mismatch");
    let rows = [{ account_id = subject.toText(); principal = subject; display_name = "pii-display-name:v1:" # id.toText() # ":" # subject.toText(); avatar_ref = null }];
    calls += 1;
    if (calls == holdAt and not released) { held := true; while (not released) await this.pulse() };
    #Ok(rows)
  };
  public shared ({ caller }) func fence(request : Fence.Request, complete : Bool) : async { #Ok : Fence.Receipt; #Err : Text } {
    if (caller != owner) return #Err("Test owner required");
    let id = switch (pii) { case (?id) id; case null return #Err("Test PII missing") };
    let sink : actor {
      prepare_private_name_release_fence : shared Fence.Request -> async { #Ok : Fence.Receipt; #Err : Text };
      complete_private_name_release_fence : shared Fence.Request -> async { #Ok : Fence.Receipt; #Err : Text }
    } = actor(id.toText());
    if (complete) await (with timeout = 10) sink.complete_private_name_release_fence(request)
    else await (with timeout = 10) sink.prepare_private_name_release_fence(request)
  };
  public shared ({ caller }) func fence_lost_reply(request : Fence.Request, complete : Bool) : async { #Ok : Fence.Receipt; #Err : Text } {
    if (caller != owner) return #Err("Test owner required");
    let result = await this.fence_as_owner(request, complete);
    switch (result) { case (#Err(e)) #Err(e); case (#Ok(_)) #Err("Simulated acknowledgement loss after receiver commit") }
  };
  public shared ({ caller }) func fence_as_owner(request : Fence.Request, complete : Bool) : async { #Ok : Fence.Receipt; #Err : Text } {
    if (caller != Principal.fromActor(this)) return #Err("Local test call required");
    let id = switch (pii) { case (?id) id; case null return #Err("Test PII missing") };
    let sink : actor {
      prepare_private_name_release_fence : shared Fence.Request -> async { #Ok : Fence.Receipt; #Err : Text };
      complete_private_name_release_fence : shared Fence.Request -> async { #Ok : Fence.Receipt; #Err : Text }
    } = actor(id.toText());
    if (complete) await (with timeout = 10) sink.complete_private_name_release_fence(request)
    else await (with timeout = 10) sink.prepare_private_name_release_fence(request)
  };
  public shared ({ caller }) func receipt(request : Fence.Request) : async { #Ok : Fence.Receipt; #Err : Text } {
    if (caller != owner) return #Err("Test owner required");
    let id = switch (pii) { case (?id) id; case null return #Err("Test PII missing") };
    let sink : actor { read_private_name_release_fence : shared Fence.Request -> async { #Ok : Fence.Receipt; #Err : Text } } = actor(id.toText());
    await (with timeout = 10) sink.read_private_name_release_fence(request)
  }
}