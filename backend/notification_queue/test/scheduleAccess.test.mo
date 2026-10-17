import Principal "mo:core/Principal";
import Access "../src/scheduleAccess";

let owner = Principal.fromText("aaaaa-aa");
let anonymous = Principal.fromText("2vxsx-fae");
assert Access.owns(owner, "aaaaa-aa");
assert not Access.owns(owner, "2vxsx-fae");
assert not Access.owns(anonymous, "2vxsx-fae");
assert Access.canBroadcast([("club_admin", null)], null);
assert Access.canBroadcast([("coach", ?"team-1")], ?"team-1");
assert Access.canBroadcast([("team_admin", ?"team-1")], ?"team-1");
assert not Access.canBroadcast([("coach", ?"team-1")], ?"team-2");
assert not Access.canBroadcast([("coach", ?"team-1")], null);
assert not Access.canBroadcast([("player", ?"team-1")], ?"team-1");
assert not Access.canBroadcast([], null);
assert Access.recipient([("player", ?"team-1")], ?"team-1");
assert not Access.recipient([("player", ?"team-2")], ?"team-1");
assert not Access.recipient([], null);
assert Access.recipient([("parent", null)], null);