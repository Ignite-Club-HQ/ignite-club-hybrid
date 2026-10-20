import Principal "mo:core/Principal";

/// Local rehearsal admission only. Evidence is never a resource grant or a
/// global fencing token; callers still enforce their own current permissions.
module {
  public type Evidence = { subject : Principal; decision : { #Eligible; #Denied }; account_version : ?Nat64; denied_through_version : ?Nat64 };
  public type Account = { id : Text; principals : [Principal]; version : Nat64; status : { #Active; #Suspended } };
  public func matches(subject : Principal, evidence : Evidence) : Bool {
    not Principal.isAnonymous(subject) and subject != Principal.fromText("aaaaa-aa") and
    evidence.subject == subject and evidence.decision == #Eligible and
    (switch (evidence.account_version) {
      case null false;
      case (?version) switch (evidence.denied_through_version) { case null true; case (?denied) version > denied }
    })
  };
  public func owns(subject : Principal, account : Account) : Bool {
    if (Principal.isAnonymous(subject) or subject == Principal.fromText("aaaaa-aa") or account.status != #Active or account.id == "") return false;
    for (p in account.principals.values()) { if (p == subject) return true };
    false
  };
  public class Gate(enabled : Bool, authority : ?Principal) {
    public func active() : Bool { enabled };
    public func eligible(subject : Principal) : async Bool {
      if (not enabled) return true;
      if (Principal.isAnonymous(subject)) return false;
      let id = switch (authority) { case null return false; case (?id) id };
      let service : actor { read_principal_eligibility : shared (Principal) -> async { #Ok : Evidence; #Err : Text } } = actor(id.toText());
      try {
        switch (await (with timeout = 10) service.read_principal_eligibility(subject)) {
          case (#Ok(e)) matches(subject, e); case (#Err(_)) false
        }
      } catch (_) { false }
    };
    public func account(subject : Principal) : async ?Account {
      if (Principal.isAnonymous(subject)) return null;
      let id = switch (authority) { case null return null; case (?id) id };
      let service : actor { read_service_account : shared (Principal) -> async { #Ok : Account; #Err : Text } } = actor(id.toText());
      try {
        switch (await (with timeout = 10) service.read_service_account(subject)) {
          case (#Ok(a)) { if (owns(subject, a)) ?a else null }; case (#Err(_)) null
        }
      } catch (_) { null }
    };
  };
}