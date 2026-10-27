import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Release "PrivateNameReleaseFence";

// A whole-authority rehearsal write window, never a permission grant. Owning
// methods keep their existing authorization. Identity opens only after every
// original PII sink is fenced, and may reopen PII only after every writer seals.
module {
  public type Intent = { request : Release.Request; closing : Bool; sealed : Bool; active : Nat };
  public type Receipt = { request : Release.Request; receiver : Principal; closing : Bool; sealed : Bool; active : Nat };
  public class Gate(enabled : Bool, authority : ?Principal, intents : Map.Map<Text, Intent>, capacity : Nat) {
    func authorized(caller : Principal) : Bool = enabled and authority == ?caller and not Principal.isAnonymous(caller) and caller != Principal.fromText("aaaaa-aa");
    func current() : ?Intent {
      for ((_, intent) in intents.entries()) { if (not intent.sealed) return ?intent };
      null
    };
    public func open(caller : Principal, request : Release.Request) : { #Ok; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      if (request.operation_id == "" or request.operation_id.size() > 128 or request.generation == 0 or request.inventory_digest.size() != 32) return #Err("Invalid private-name writer request");
      switch (intents.get(request.operation_id)) {
        case (?prior) {
          if (prior.request != request) return #Err("Immutable private-name writer conflict");
          if (prior.closing or prior.sealed) return #Err("Private-name writer window already closing or sealed");
          return #Ok
        };
        case null {}
      };
      if (current() != null) return #Err("Another private-name writer window remains open");
      if (intents.size() >= capacity) return #Err("Private-name writer capacity reached");
      intents.add(request.operation_id, { request; closing = false; sealed = false; active = 0 });
      #Ok
    };
    public func enter() : { #Ok : ?Release.Request; #Err : Text } {
      if (not enabled) return #Ok(null);
      switch (current()) {
        case (?intent) {
          if (intent.closing or intent.active >= 4096) return #Err("Private-name writer closing or busy");
          intents.add(intent.request.operation_id, { intent with active = intent.active + 1 });
          #Ok(?intent.request)
        };
        case null #Err("Coordinated private-name write window required")
      }
    };
    public func leave(request : ?Release.Request) {
      switch (request) {
        case null {};
        case (?key) { switch (intents.get(key.operation_id)) {
          case (?intent) { if (intent.request == key and intent.active > 0) intents.add(key.operation_id, { intent with active = intent.active - 1 }) };
          case null {}
        } }
      }
    };
    public func seal(caller : Principal, request : Release.Request) : { #Ok; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      switch (intents.get(request.operation_id)) {
        case null #Err("Exact private-name writer intent required");
        case (?intent) {
          if (intent.request != request) return #Err("Immutable private-name writer conflict");
          // Closing commits even with outstanding work. No new writes enter;
          // existing callbacks retain their lease until finally cleanup.
          intents.add(request.operation_id, { intent with closing = true; sealed = intent.active == 0 });
          #Ok
        }
      }
    };
    public func receipt(caller : Principal, request : Release.Request, receiver : Principal) : { #Ok : Receipt; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      switch (intents.get(request.operation_id)) {
        case null #Err("Exact private-name writer intent required");
        case (?intent) {
          if (intent.request != request) return #Err("Immutable private-name writer conflict");
          #Ok({ request; receiver; closing = intent.closing; sealed = intent.sealed; active = intent.active })
        }
      }
    }
  }
}