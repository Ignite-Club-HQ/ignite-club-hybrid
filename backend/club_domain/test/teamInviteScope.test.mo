import Scope "../src/teamInviteScope";

let u9 = { id = "u9"; club_id = "giddy-goat"; deleted_at_ms = null; is_active = true };
assert Scope.valid("giddy-goat", "u9", [u9], []);
assert not Scope.valid("other-club", "u9", [u9], []);
assert not Scope.valid("giddy-goat", "u9", [{ u9 with is_active = false }], [{ id = "u9"; club = "giddy-goat" }]);
assert not Scope.valid("giddy-goat", "u9", [{ u9 with deleted_at_ms = ?1 }], [{ id = "u9"; club = "giddy-goat" }]);
assert Scope.valid("giddy-goat", "u9", [], [{ id = "u9"; club = "giddy-goat" }]);
assert not Scope.valid("giddy-goat", "u9", [], []);
assert Scope.valid("giddy-goat", "u9", [u9], [{ id = "u9"; club = "other-club" }]);