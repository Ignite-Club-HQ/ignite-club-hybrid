import Writer "PrivateNameWriterWindow";
import Release "PrivateNameReleaseFence";
import Principal "mo:core/Principal";

mixin (gate : Writer.Gate, self : Principal) {
  public shared ({ caller }) func open_private_name_writer_window(request : Release.Request) : async { #Ok; #Err : Text } { gate.open(caller, request) };
  public shared ({ caller }) func seal_private_name_writer_window(request : Release.Request) : async { #Ok; #Err : Text } { gate.seal(caller, request) };
  public shared ({ caller }) func read_private_name_writer_window(request : Release.Request) : async { #Ok : Writer.Receipt; #Err : Text } { gate.receipt(caller, request, self) };
}