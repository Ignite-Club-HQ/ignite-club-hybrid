import Writer "PrivateNameWriterWindow";
import Release "PrivateNameReleaseFence";
import Principal "mo:core/Principal";

mixin (gate : Writer.Gate, self : Principal) {
  public shared ({ caller }) func freeze_private_name_preparation(request : Release.Request) : async { #Ok; #Err : Text } { gate.freeze(caller, request) };
  public shared ({ caller }) func read_private_name_preparation(request : Release.Request) : async { #Ok : Writer.Receipt; #Err : Text } { gate.preparationReceipt(caller, request, self) };
  public shared ({ caller }) func finish_private_name_preparation(request : Release.Request) : async { #Ok; #Err : Text } { gate.finishPreparation(caller, request) };
  public shared ({ caller }) func activate_private_name_preparation(request : Release.Request) : async { #Ok; #Err : Text } { gate.activatePreparation(caller, request) };
  public shared ({ caller }) func open_private_name_writer_window(request : Release.Request) : async { #Ok; #Err : Text } { gate.open(caller, request) };
  public shared ({ caller }) func seal_private_name_writer_window(request : Release.Request) : async { #Ok; #Err : Text } { gate.seal(caller, request) };
  public shared ({ caller }) func read_private_name_writer_window(request : Release.Request) : async { #Ok : Writer.Receipt; #Err : Text } { gate.receipt(caller, request, self) };
}