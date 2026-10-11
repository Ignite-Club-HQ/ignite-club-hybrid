import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Types "types";
module {
  public func replace(roles : [Types.RoleGrant], caller : Principal, club : Text, fresh : [(Text, ?Text)]) : [Types.RoleGrant] {
    roles.filter(func(item) = not (item.user.equal(caller) and item.club_id == club))
      .concat(fresh.map(func((role, team)) = { user = caller; role; club_id = club; team_id = team }));
  };
};