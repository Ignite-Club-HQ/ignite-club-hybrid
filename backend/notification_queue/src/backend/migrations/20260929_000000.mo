import Principal "mo:core/Principal";

module {
  type Status = { #Pending; #Processing; #Delivered; #Failed };

  type OldNotification = {
    id : Text;
    user : Text;
    club : Text;
    kind : Text;
    body : Text;
    idempotency_key : Text;
    status : Status;
    attempts : Nat32;
    next_attempt_ms : Nat64;
  };

  type Notification = {
    id : Text;
    user : Text;
    club : Text;
    kind : Text;
    body : Text;
    idempotency_key : Text;
    status : Status;
    attempts : Nat32;
    next_attempt_ms : Nat64;
    read : Bool;
    related_id : ?Text;
    created_at_ms : Nat64;
  };

  type Lease = {
    id : Text;
    owner : Principal;
  };

  type OldActor = {
    var items : [OldNotification];
    var leases : [Lease];
    var governor : ?Principal;
    var workers : [Principal];
  };

  type NewActor = {
    var items : [Notification];
    var leases : [Lease];
    var governor : ?Principal;
    var workers : [Principal];
  };

  public func migration(old : OldActor) : NewActor {
    {
      var items = old.items.map(func(item : OldNotification) : Notification {
        { item with read = false; related_id = null; created_at_ms = 0 }
      });
      var leases = old.leases;
      var governor = old.governor;
      var workers = old.workers;
    }
  };
};
