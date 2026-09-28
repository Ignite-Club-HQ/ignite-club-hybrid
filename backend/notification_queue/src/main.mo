import Array "mo:core/Array";
import Nat16 "mo:core/Nat16";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Types "types";

persistent actor {
  var items : [Types.Notification];
  var leases : [Types.Lease];
  var governor : ?Principal;
  var workers : [Principal];

  func authenticated(caller : Principal) {
    if (caller.equal(Principal.anonymous())) { Runtime.trap("Forbidden") };
  };

  func worker(caller : Principal) {
    authenticated(caller);
    let allowed = switch (governor) {
      case (?owner) { owner.equal(caller) or workers.any(func(principal) = principal.equal(caller)) };
      case null { false };
    };
    if (not allowed) { Runtime.trap("Worker capability required") };
  };

  func valid(value : Text) : Bool { value != "" };

  func findIndex(id : Text) : ?Nat {
    var index = 0;
    for (item in items.values()) {
      if (item.id == id) { return ?index };
      index += 1;
    };
    null
  };

  func get(id : Text) : ?Types.Notification {
    switch (findIndex(id)) {
      case (?index) { ?items[index] };
      case null { null };
    }
  };

  func findLeaseIndex(id : Text) : ?Nat {
    var index = 0;
    for (lease in leases.values()) {
      if (lease.id == id) { return ?index };
      index += 1;
    };
    null
  };

  func leaseOwner(id : Text) : ?Principal {
    switch (findLeaseIndex(id)) {
      case (?index) { ?leases[index].owner };
      case null { null };
    }
  };

  func setLease(id : Text, owner : Principal) {
    let lease : Types.Lease = { id; owner };
    switch (findLeaseIndex(id)) {
      case (?index) {
        leases := Array.tabulate<Types.Lease>(leases.size(), func(position) {
          if (position == index) { lease } else { leases[position] }
        });
      };
      case null { leases := leases.concat([lease]) };
    };
  };

  func clearLease(id : Text) {
    switch (findLeaseIndex(id)) {
      case (?index) {
        leases := Array.tabulate<Types.Lease>(leases.size() - 1, func(position) {
          if (position < index) { leases[position] } else { leases[position + 1] }
        });
      };
      case null {};
    };
  };

  func ownsLease(id : Text, caller : Principal) : Bool {
    switch (leaseOwner(id)) {
      case (?owner) { owner.equal(caller) };
      case null { false };
    }
  };

  func replace(index : Nat, item : Types.Notification) {
    items := Array.tabulate<Types.Notification>(items.size(), func(position) {
      if (position == index) { item } else { items[position] }
    });
  };

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    authenticated(caller);
    switch (governor) {
      case (?_) { #Err("Already initialized") };
      case null { governor := ?caller; #Ok };
    };
  };

  public shared ({ caller }) func grant_worker(principal : Principal) : async { #Ok; #Err : Text } {
    authenticated(caller);
    switch (governor) {
      case (?owner) {
        if (not owner.equal(caller)) { return #Err("Governor required") };
        if (principal.equal(Principal.anonymous())) { return #Err("Invalid worker") };
        if (not workers.any(func(candidate) = candidate.equal(principal))) { workers := workers.concat([principal]) };
        #Ok
      };
      case null { #Err("Governor required") };
    };
  };

  public shared ({ caller }) func enqueue(
    id : Text,
    user : Text,
    club : Text,
    kind : Text,
    body : Text,
    key : Text,
  ) : async Types.Result {
    authenticated(caller);
    if (not valid(id) or not valid(user) or not valid(club) or not valid(kind) or not valid(key)) {
      return #Err("Invalid notification fields");
    };
    switch (get(id)) {
      case (?existing) {
        if (existing.idempotency_key != key) return #Err("Notification id already exists with a different idempotency key");
        #Ok(existing)
      };
      case null {
        let notification : Types.Notification = {
          id;
          user;
          club;
          kind;
          body;
          idempotency_key = key;
          status = #Pending;
          attempts = 0;
          next_attempt_ms = 0;
        };
        items := items.concat([notification]);
        #Ok(notification)
      };
    }
  };

  public shared ({ caller }) func claim(now_ms : Nat64, limit : Nat16) : async Types.Results {
    worker(caller);
    if (limit == 0 or limit > 100) { return #Err("Invalid batch size") };
    var claimed : [Types.Notification] = [];
    var index = 0;
    for (item in items.values()) {
      if (claimed.size() < Nat16.toNat(limit) and item.status == #Pending and item.next_attempt_ms <= now_ms) {
        let processing : Types.Notification = { item with status = #Processing; attempts = item.attempts + 1 };
        replace(index, processing);
        setLease(item.id, caller);
        claimed := claimed.concat([processing]);
      };
      index += 1;
    };
    #Ok(claimed)
  };

  public shared ({ caller }) func acknowledge(id : Text, key : Text) : async Types.Result {
    worker(caller);
    switch (findIndex(id)) {
      case null { #Err("Unknown notification") };
      case (?index) {
        let item = items[index];
        if (item.idempotency_key != key) { return #Err("Idempotency key mismatch") };
        if (item.status == #Delivered) { return #Ok(item) };
        if (item.status != #Processing) { return #Err("Notification is not processing") };
        if (not ownsLease(id, caller)) { return #Err("Notification lease owner required") };
        let delivered : Types.Notification = { item with status = #Delivered };
        replace(index, delivered);
        clearLease(id);
        #Ok(delivered)
      };
    }
  };

  public shared ({ caller }) func fail(id : Text, error : Text, retry_at_ms : ?Nat64) : async Types.Result {
    worker(caller);
    switch (findIndex(id)) {
      case null { #Err("Unknown notification") };
      case (?index) {
        let item = items[index];
        if (item.status != #Processing) { return #Err("Notification is not processing") };
        if (not ownsLease(id, caller)) { return #Err("Notification lease owner required") };
        let failed : Types.Notification = {
          item with
          body = error;
          status = switch (retry_at_ms) { case (?_) { #Pending }; case null { #Failed } };
          next_attempt_ms = switch (retry_at_ms) { case (?time) { time }; case null { item.next_attempt_ms } };
        };
        replace(index, failed);
        clearLease(id);
        #Ok(failed)
      };
    }
  };

  public query ({ caller }) func get_notification(id : Text) : async ?Types.Notification {
    if (caller.equal(Principal.anonymous())) { return null };
    get(id)
  };

  public shared ({ caller }) func recover() : async Types.ResultNat16 {
    worker(caller);
    var recovered : Nat16 = 0;
    var index = 0;
    for (item in items.values()) {
      if (item.status == #Processing) {
        replace(index, { item with status = #Pending });
        clearLease(item.id);
        recovered += 1;
      };
      index += 1;
    };
    #Ok(recovered)
  };
};
