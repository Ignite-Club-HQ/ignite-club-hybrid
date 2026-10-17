import Principal "mo:core/Principal";
import Array "mo:core/Array";

module {
  public func owns(caller : Principal, author : Text) : Bool {
    not Principal.isAnonymous(caller) and Principal.toText(caller) == author
  };

  public func canBroadcast(roles : [(Text, ?Text)], team : ?Text) : Bool {
    roles.any(func(grant) {
      let (role, scope) = grant;
      role == "club_admin" or role == "app_admin" or role == "league_admin" or
      (team != null and scope == team and (role == "team_admin" or role == "coach"))
    })
  };
  public func recipient(roles : [(Text, ?Text)], team : ?Text) : Bool {
    switch (team) {
      case null { roles.size() > 0 };
      case (?id) { roles.any(func(grant) = grant.1 == ?id) };
    }
  };
}