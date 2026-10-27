import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Blob "mo:core/Blob";
import Text "mo:core/Text";

// Receiver-local release-commit fence, NOT a complete revocation receipt.
// Completed operation tombstones remain durable: delayed prepare must never
// reopen a completed operation. Capacity exhaustion refuses before mutation.
module {
  public type Request = { operation_id : Text; generation : Nat64; inventory_digest : Blob };
  public type Intent = { request : Request; completed : Bool };
  public type Receipt = { request : Request; receiver : Principal; completed : Bool; release_epoch : Nat };
  public class Gate(enabled : Bool, authority : ?Principal, intents : Map.Map<Text, Intent>, capacity : Nat) {
    func authorized(caller : Principal) : Bool {
      enabled and authority == ?caller and not Principal.isAnonymous(caller) and caller != Principal.fromText("aaaaa-aa")
    };
    func valid(request : Request) : Bool {
      request.operation_id != "" and request.operation_id.size() <= 128 and request.generation > 0 and request.inventory_digest.size() == 32
    };
    public func blocked() : Bool {
      for ((_, intent) in intents.entries()) { if (not intent.completed) return true };
      false
    };
    public func prepare(caller : Principal, request : Request) : { #Ok : Bool; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      if (not valid(request)) return #Err("Invalid private-name fence");
      switch (intents.get(request.operation_id)) {
        case (?prior) {
          if (prior.request != request) return #Err("Immutable private-name fence conflict");
          if (prior.completed) return #Err("Private-name fence already completed");
          return #Ok(false)
        };
        case null {}
      };
      if (intents.size() >= capacity) return #Err("Private-name fence capacity reached");
      intents.add(request.operation_id, { request; completed = false });
      #Ok(true)
    };
    public func complete(caller : Principal, request : Request) : { #Ok : Bool; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      switch (intents.get(request.operation_id)) {
        case (?prior) {
          if (prior.request != request) return #Err("Immutable private-name fence conflict");
          if (prior.completed) return #Ok(false);
          intents.add(request.operation_id, { request; completed = true });
          #Ok(true)
        };
        case null #Err("Exact persistent private-name fence required")
      }
    };
    public func receipt(caller : Principal, request : Request, receiver : Principal, epoch : Nat) : { #Ok : Receipt; #Err : Text } {
      if (not authorized(caller)) return #Err("Configured rehearsal identity required");
      switch (intents.get(request.operation_id)) {
        case (?intent) {
          if (intent.request != request) return #Err("Immutable private-name fence conflict");
          #Ok({ request; receiver; completed = intent.completed; release_epoch = epoch })
        };
        case null #Err("Exact persistent private-name fence required")
      }
    };
    public func canRelease(captured : Nat, current : Nat) : Bool { enabled and captured == current and not blocked() }
  }
}