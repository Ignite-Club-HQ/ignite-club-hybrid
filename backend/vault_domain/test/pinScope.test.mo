import Scope "../src/pinScope";
assert Scope.sameClub(null, "club-1");
assert Scope.sameClub(?"club-1", "club-1");
assert not Scope.sameClub(?"club-2", "club-1");
assert Scope.targetClub(?("club-1", false), "club-1");
assert not Scope.targetClub(?("club-2", false), "club-1");
assert not Scope.targetClub(?("club-1", true), "club-1");
assert not Scope.targetClub(null, "club-1");