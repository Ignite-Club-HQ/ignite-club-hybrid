import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Text "mo:core/Text";
import Blob "mo:core/Blob";
import Release "PrivateNameReleaseFence";

// A whole-authority rehearsal write window, never a permission grant. Owning
// methods keep their existing authorization. Identity opens only after every
// original PII sink is fenced, and may reopen PII only after every writer seals.
module {
  // Always counted even while rehearsal authorization is disabled. A fresh
  // record is instrumentation only, NEVER proof of pre-upgrade quiescence.
  func ordinaryRequest() : Release.Request { { operation_id = "ordinary:private-name-accounting-v1"; generation = 1; inventory_digest = Blob.fromArray([0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0]) } };
  public func exclusive(request : Release.Request) : Bool { Text.startsWith(request.operation_id, #text "names:club-name-conversion-") };
  public func preparation(request : Release.Request) : Bool { Text.startsWith(request.operation_id, #text "names:club-name-preparation-") };
  public type Intent = { request : Release.Request; closing : Bool; sealed : Bool; active : Nat };
  public type Receipt = { request : Release.Request; receiver : Principal; closing : Bool; sealed : Bool; active : Nat };
  public class Gate(enabled : Bool, authority : ?Principal, intents : Map.Map<Text, Intent>, capacity : Nat) {
    func authorized(caller : Principal) : Bool = enabled and authority == ?caller and not Principal.isAnonymous(caller) and caller != Principal.fromText("aaaaa-aa");
    func current() : ?Intent {
      for ((_, intent) in intents.entries()) { if (not intent.sealed) return ?intent };
      null
    };
    func preparationPending() : Bool { for ((_, i) in intents.entries()) { if (preparation(i.request) and not i.sealed) return true }; false };
    public func freeze(caller : Principal, request : Release.Request) : { #Ok; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      if (not preparation(request) or request.operation_id.size() > 128 or request.generation == 0 or request.inventory_digest.size() != 32) return #Err("Exact preparation request required");
      switch (intents.get(request.operation_id)) { case (?i) { if (i.request != request or i.closing or i.sealed) return #Err("Immutable preparation conflict"); return #Ok }; case null {} };
      if (preparationPending() or intents.size() >= capacity) return #Err("Preparation remains unresolved or capacity reached");
      for ((_, i) in intents.entries()) { if (not i.sealed and exclusive(i.request)) return #Err("Conversion remains unresolved") };
      for ((id, i) in intents.entries()) { if (not i.sealed) intents.add(id, { i with closing = true; sealed = i.active == 0 }) };
      intents.add(request.operation_id, { request; closing = false; sealed = false; active = 0 }); #Ok
    };
    public func preparationReceipt(caller : Principal, request : Release.Request, receiver : Principal) : { #Ok : Receipt; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      switch (intents.get(request.operation_id)) {
        case null #Err("Exact preparation receipt required");
        case (?i) {
          if (not preparation(request) or i.request != request) return #Err("Exact preparation receipt required");
          var active = i.active;
          for ((_, prior) in intents.entries()) { if (prior.request != request and (not prior.sealed or prior.request == ordinaryRequest())) active += prior.active };
          #Ok({ request; receiver; closing = i.closing; sealed = i.sealed; active })
        }
      }
    };
    public func open(caller : Principal, request : Release.Request) : { #Ok; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      if (preparation(request)) return #Err("Use preparation admission");
      if (request.operation_id == ordinaryRequest().operation_id) return #Err("Reserved ordinary accounting identity");
      if (preparationPending()) return #Err("Preparation lock remains held");
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
    public func finishPreparation(caller : Principal, request : Release.Request) : { #Ok; #Err : Text } {
      if (intents.get("approved:" # request.operation_id) == null) return #Err("Signed preparation activation required");
      switch (preparationReceipt(caller, request, caller)) { case (#Err(e)) return #Err(e); case (#Ok(r)) { if (r.active != 0) return #Err("Preparation work remains unresolved") } };
      switch (intents.get(request.operation_id)) { case null #Err("Exact preparation receipt required"); case (?i) { intents.add(request.operation_id, { i with closing = true; sealed = true }); #Ok } }
    };
    public func activatePreparation(caller : Principal, request : Release.Request) : { #Ok; #Err : Text } {
      switch (preparationReceipt(caller, request, caller)) { case (#Err(e)) return #Err(e); case (#Ok(r)) { if (r.active != 0 or r.closing or r.sealed) return #Err("Exact drained preparation required") } };
      if (intents.get("approved:" # request.operation_id) == null and intents.size() >= capacity) return #Err("Preparation activation capacity reached");
      intents.add("approved:" # request.operation_id, { request; active = 0; closing = true; sealed = true }); #Ok
    };
    public func enter() : { #Ok : ?Release.Request; #Err : Text } {
      if (preparationPending()) return #Err("Edits locked for private-name preparation");
      if (not enabled) {
        for ((_, i) in intents.entries()) { if (exclusive(i.request) and not i.sealed) return #Err("Edits locked for private-name conversion") };
        let request = ordinaryRequest();
        let prior = intents.get(request.operation_id) ?? ({ request; closing = false; sealed = true; active = 0 });
        if (prior.request != request or prior.closing or prior.active >= 4096) return #Err("Ordinary accounting conflict or busy");
        if (intents.get(request.operation_id) == null and intents.size() >= capacity) return #Err("Ordinary accounting capacity reached");
        intents.add(request.operation_id, { prior with active = prior.active + 1 });
        return #Ok(?request)
      };
      switch (current()) {
        case (?intent) {
          if (exclusive(intent.request)) return #Err("Edits locked for private-name conversion");
          if (intent.closing or intent.active >= 4096) return #Err("Private-name writer closing or busy");
          intents.add(intent.request.operation_id, { intent with active = intent.active + 1 });
          #Ok(?intent.request)
        };
        case null #Err("Coordinated private-name write window required")
      }
    };
    // Only the configured coordinator can submit exact approved conversion
    // mutations. Ordinary governor/owner methods never receive this lease.
    public func enterConversion(caller : Principal, request : Release.Request) : { #Ok : ?Release.Request; #Err : Text } {
      if (not authorized(caller) or not (exclusive(request) or preparation(request))) return #Err("Approved conversion coordinator required");
      if (preparation(request) and intents.get("approved:" # request.operation_id) == null) return #Err("Signed preparation activation required");
      switch (if (preparation(request)) intents.get(request.operation_id) else current()) {
        case (?intent) {
          if (intent.request != request or intent.closing or intent.active >= 4096) return #Err("Exact open conversion window required");
          intents.add(request.operation_id, { intent with active = intent.active + 1 });
          #Ok(?request)
        };
        case null #Err("Exact open conversion window required")
      }
    };
    public func leave(request : ?Release.Request) {
      switch (request) {
        case null {};
        case (?key) { switch (intents.get(key.operation_id)) {
          case (?intent) {
            if (intent.request == key and intent.active > 0) {
              let active = intent.active - 1;
              // A window interrupted while closing still seals once its last
              // retained callback finishes; the lock is never stranded.
              intents.add(key.operation_id, { intent with active; sealed = intent.sealed or (intent.closing and active == 0) })
            }
          };
          case null {}
        } }
      }
    };
    public func seal(caller : Principal, request : Release.Request) : { #Ok; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      if (request.operation_id == ordinaryRequest().operation_id) return #Err("Reserved ordinary accounting identity");
      if (preparation(request)) return #Err("Preparation releases only through approved completion");
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