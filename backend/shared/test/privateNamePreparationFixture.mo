// Disposable callback-counting fixture. Never install on production.
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Writer "../PrivateNameWriterWindow";
import Endpoints "../PrivateNameWriterEndpoints";
import Release "../PrivateNameReleaseFence";
import Runtime "mo:core/Runtime";

persistent actor class Fixture(authority : Principal) = this {
  let intents = Map.empty<Text, Writer.Intent>();
  transient let gate = Writer.Gate(true, ?authority, intents, 20);
  transient let ordinaryGate = Writer.Gate(false, ?authority, intents, 20);
  include Endpoints(gate, Principal.fromActor(this));
  var released = false;
  var entered = false;
  public query func observedHold() : async Bool { entered and not released };
  public shared func waitForRelease() : async () {
    while (not released) { await async {} }
  };
  public shared ({ caller }) func releaseHeld() : async () {
    if (caller != authority) Runtime.trap("Fixture authority required");
    released := true
  };
  public shared ({ caller }) func holdOrdinary() : async () {
    if (caller != authority) Runtime.trap("Fixture authority required");
    let lease = switch (gate.enter()) { case (#Ok(k)) k; case (#Err(e)) Runtime.trap(e) };
    entered := true;
    try { await this.waitForRelease() } finally { gate.leave(lease) }
  };
  public shared ({ caller }) func holdUnrehearsedOrdinary() : async () {
    if (caller != authority) Runtime.trap("Fixture authority required");
    let lease = switch (ordinaryGate.enter()) { case (#Ok(k)) k; case (#Err(e)) Runtime.trap(e) };
    entered := true;
    try { await this.waitForRelease() } finally { ordinaryGate.leave(lease) }
  };
  public shared ({ caller }) func tryConversion(request : Release.Request) : async { #Ok; #Err : Text } {
    switch (gate.enterConversion(caller, request)) { case (#Err(e)) #Err(e); case (#Ok(k)) { gate.leave(k); #Ok } }
  };
}