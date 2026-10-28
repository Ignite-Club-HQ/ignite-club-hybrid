import PiiAudience "../src/piiAudience";
import Debug "mo:core/Debug";

// Member of club-1, on team-a as "coach"; team-b belongs to club-1, team-x to club-2.
let checks : PiiAudience.Checks = {
  isMember = func(c : Text) : Bool = c == "club-1";
  teamClub = func(t : Text) : ?Text = if (t == "team-a" or t == "team-b") ?"club-1" else if (t == "team-x") ?"club-2" else null;
  excluded = func(_ : Text) : Bool = false;
  onTeam = func(t : Text) : Bool = t == "team-a";
  hasRole = func(r : Text, c : Text, t : ?Text) : Bool = r == "coach" and c == "club-1" and (t == null or t == ?"team-a");
};

assert PiiAudience.decide("clubchildren", "club-1", checks);
assert not PiiAudience.decide("clubchildren", "club-2", checks);
assert PiiAudience.decide("teamnames", "team-a", checks);
assert not PiiAudience.decide("teamnames", "team-b", checks); // same club, other team
assert PiiAudience.decide("vaultrole", "club-1|team-a|coach,manager", checks);
assert not PiiAudience.decide("vaultrole", "club-1|team-a|treasurer", checks);
assert not PiiAudience.decide("vaultrole", "club-1|team-x|coach", checks); // team not in club
assert not PiiAudience.decide("other", "club-1", checks);
let committee = { checks with hasRole = func(r : Text, c : Text, _ : ?Text) : Bool = r == "committee" and c == "club-1" };
assert PiiAudience.decide("vaultrole", "club-1|team-b|coach", committee);
Debug.print("piiAudience ok");
