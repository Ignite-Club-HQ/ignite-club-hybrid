import Principal "mo:core/Principal";

module {
  public type Status = {
    #Pending;
    #Processing;
    #Delivered;
    #Failed;
  };

  public type Notification = {
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

  public type Lease = {
    id : Text;
    owner : Principal;
  };

  public type Result = { #Ok : Notification; #Err : Text };
  public type Results = { #Ok : [Notification]; #Err : Text };
  public type ResultNat16 = { #Ok : Nat16; #Err : Text };
}
