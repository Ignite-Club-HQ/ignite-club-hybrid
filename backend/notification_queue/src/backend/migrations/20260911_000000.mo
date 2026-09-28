import Principal "mo:core/Principal";

module {
  type OldActor = {};

  type Status = { #Pending; #Processing; #Delivered; #Failed };
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
  };

  type Lease = {
    id : Text;
    owner : Principal;
  };

  type NewActor = {
    var items : [Notification];
    var leases : [Lease];
    var governor : ?Principal;
    var workers : [Principal];
  };

  public func migration(_old : OldActor) : NewActor {
    { var items = []; var leases = []; var governor = null; var workers = [] }
  };
};
