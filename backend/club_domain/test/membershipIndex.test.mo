import Ix "../src/membershipIndex";
import Nat "mo:core/Nat";
let ix = Ix.empty();
var i = 0;
while (i < 250) { Ix.add(ix, "alice", "club-" # (if (i < 10) "00" else if (i < 100) "0" else "") # Nat.toText(i)); i += 1 };
Ix.add(ix, "bob", "club-x");
Ix.add(ix, "alice", "club-000"); // duplicate add is a no-op
let p1 = Ix.page(ix, "alice", null, 100);
assert p1.clubs.size() == 100 and p1.clubs[0] == "club-000" and p1.next == ?"club-099";
let p2 = Ix.page(ix, "alice", p1.next, 100);
assert p2.clubs[0] == "club-100" and p2.next == ?"club-199";
let p3 = Ix.page(ix, "alice", p2.next, 100);
assert p3.clubs.size() == 50 and p3.next == null;
assert Ix.page(ix, "alice", null, 1000).clubs.size() == 100;
assert Ix.page(ix, "nobody", null, 10).clubs.size() == 0;
assert Ix.has(ix, "bob", "club-x") and not Ix.has(ix, "alice", "club-x");
Ix.remove(ix, "bob", "club-x");
assert not Ix.has(ix, "bob", "club-x") and Ix.page(ix, "bob", null, 10).clubs.size() == 0;
