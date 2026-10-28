import Array "mo:core/Array";
import Principal "mo:core/Principal";
import AccountAdmission "../../shared/AccountAdmission";

/// Only a freshly verified consensus reply may supply aliases. Never a stored
/// roster/account mirror; query execution and later messages remain exact-only.
module {
  public type Snapshot = { account : AccountAdmission.Account; observed : Int };
  public func aliases(subject : Principal, snapshot : ?Snapshot, replicated : Bool, now : Int, denied : Principal -> Bool) : [Principal] {
    if (Principal.isAnonymous(subject) or denied(subject)) return [];
    switch snapshot {
      case (?s) {
        if (replicated and s.observed == now and AccountAdmission.owns(subject, s.account)
            and s.account.principals.size() <= 8) {
          return s.account.principals.filter(func p = not Principal.isAnonymous(p) and not denied(p))
        }
      };
      case null {};
    };
    [subject]
  };
}