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
  include Endpoints(gate, Principal.fromActor(this));
  var released = false;
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
    try { await this.waitForRelease() } finally { gate.leave(lease) }
  };
  public shared ({ caller }) func tryConversion(request : Release.Request) : async { #Ok; #Err : Text } {
    switch (gate.enterConversion(caller, request)) { case (#Err(e)) #Err(e); case (#Ok(k)) { gate.leave(k); #Ok } }
  };
}