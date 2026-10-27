import Receiver "RemovalReceiver";
import Principal "mo:core/Principal";

// State belongs to the host actor and its immutable migration chain.
mixin (gate : Receiver.Gate, self : Principal, pending : Receiver.Request -> Nat) {
  public shared ({ caller }) func prepare_account_removal(request : Receiver.Request) : async { #Ok; #Err : Text } {
    gate.prepare(caller, request)
  };
  public shared ({ caller }) func read_account_removal_drain(request : Receiver.Request) : async { #Ok : Receiver.Receipt; #Err : Text } {
    gate.receipt(caller, request, self, pending(request))
  };
  public shared ({ caller }) func seal_account_removal(request : Receiver.Request) : async { #Ok : Receiver.Receipt; #Err : Text } {
    gate.seal(caller, request, self, pending(request))
  };
}