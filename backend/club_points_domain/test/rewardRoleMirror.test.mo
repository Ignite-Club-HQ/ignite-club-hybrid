import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Mirror "../src/rewardRoleMirror";
import Types "../src/types";
let caller = Principal.fromText("aaaaa-aa");
let other = Principal.fromText("2vxsx-fae");
let roles : [Types.RoleGrant] = [
  { user = caller; role = "club_admin"; club_id = "goat"; team_id = null },
  { user = other; role = "club_admin"; club_id = "goat"; team_id = null },
  { user = caller; role = "club_admin"; club_id = "cats"; team_id = null },
];
let refreshed = Mirror.replace(roles, caller, "goat", [("club_admin", null)]);
assert refreshed.any(func(r) = r.user.equal(caller) and r.club_id == "goat" and r.role == "club_admin");
let removed = Mirror.replace(roles, caller, "goat", [("player", null)]);
assert not removed.any(func(r) = r.user.equal(caller) and r.club_id == "goat" and r.role == "club_admin");
assert removed.any(func(r) = r.user.equal(other) and r.club_id == "goat" and r.role == "club_admin");
assert removed.any(func(r) = r.user.equal(caller) and r.club_id == "cats" and r.role == "club_admin");
let empty = Mirror.replace(roles, caller, "goat", []);
assert not empty.any(func(r) = r.user.equal(caller) and r.club_id == "goat");