import Release "PrivateNameReleaseFence";
import Receiver "RemovalReceiver";
import Principal "mo:core/Principal";

// State belongs to the host actor and its immutable migration chain.
mixin (gate : Receiver.Gate, self : Principal, pending : Receiver.Request -> Nat, enter : () -> ?Release.Request, leave : (?Release.Request) -> ()) {
  public shared ({ caller }) func prepare_account_removal(request : Receiver.Request) : async { #Ok; #Err : Text } {
    let lease = enter();
    try { gate.prepare(caller, request) } finally { leave(lease) }
  };
  public shared ({ caller }) func read_account_removal_drain(request : Receiver.Request) : async { #Ok : Receiver.Receipt; #Err : Text } {
    let lease = enter();
    try { gate.receipt(caller, request, self, pending(request)) } finally { leave(lease) }
  };
  public shared ({ caller }) func seal_account_removal(request : Receiver.Request) : async { #Ok : Receiver.Receipt; #Err : Text } {
    let lease = enter();
    try { gate.seal(caller, request, self, pending(request)) } finally { leave(lease) }
  };
}