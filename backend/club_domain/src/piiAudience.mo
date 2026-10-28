import Text "mo:core/Text";
import Iter "mo:core/Iter";

// Pure decision for shared-key private-detail audiences (see main.mo
// read_has_pii_audience). Kept pure so it can be unit tested.
module {
  public type Checks = {
    isMember : Text -> Bool;
    teamClub : Text -> ?Text;
    excluded : Text -> Bool;
    onTeam : Text -> Bool;
    hasRole : (Text, Text, ?Text) -> Bool;
  };

  // Roles that see every team's restricted Vault files in their club.
  let clubWide = ["club_admin", "committee"];

  public func decide(kind : Text, scope : Text, c : Checks) : Bool {
    if (kind == "clubchildren") return c.isMember(scope);
    if (kind == "teamnames") {
      return switch (c.teamClub(scope)) {
        case (?club) not c.excluded(club) and c.onTeam(scope);
        case null false;
      };
    };
    if (kind == "vaultrole") {
      let parts = Iter.toArray(Text.split(scope, #char '|'));
      if (parts.size() != 3 or parts[0] == "" or parts[2] == "") return false;
      let club = parts[0];
      if (c.excluded(club)) return false;
      let team : ?Text = if (parts[1] == "") null else ?parts[1];
      switch (team) {
        case (?t) { if (c.teamClub(t) != ?club) return false };
        case null {};
      };
      for (r in clubWide.values()) { if (c.hasRole(r, club, null)) return true };
      for (role in Text.split(parts[2], #char ',')) {
        if (role != "" and c.hasRole(role, club, team)) return true;
      };
      return false;
    };
    false
  };
};
