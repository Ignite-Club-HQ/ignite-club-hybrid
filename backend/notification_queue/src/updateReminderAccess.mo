import Principal "mo:core/Principal";
import Text "mo:core/Text";

module {
  public func protectedKind(kind : Text) : Bool {
    Text.startsWith(kind, #text "update_reminder")
  };

  // Validate the entire audience before the caller writes any queue records.
  public func authorize(
    caller : Principal,
    users : [Text],
    club : Text,
    adminCheck : Principal -> async Bool,
    memberCheck : (Principal, Text) -> async Bool,
  ) : async { #Ok; #Err : Text } {
    if (Principal.isAnonymous(caller)) { return #Err("App admin required") };
    let admin = try { await adminCheck(caller) } catch (_) { false };
    if (not admin) { return #Err("App admin required") };
    for (user in users.values()) {
      let principal = Principal.fromText(user);
      if (Principal.isAnonymous(principal)) { return #Err("Invalid recipient") };
      let member = try { await memberCheck(principal, club) }
        catch (_) { return #Err("Could not verify update reminder recipient") };
      if (not member) { return #Err("Recipient is not in the reminder club") };
    };
    #Ok
  };
}