import Discovery "../src/membershipDiscovery";
import Source "../src/membershipSource";
import Nat "mo:core/Nat";
let journal : Discovery.Journal = { var revision = 1; var acknowledged = 0 };
assert Discovery.pending(journal);
Discovery.bump(journal);
assert journal.revision == 2;
assert not Discovery.acknowledge(journal, 1);
assert Discovery.pending(journal);
assert Discovery.acknowledge(journal, 2);
assert not Discovery.pending(journal);
Discovery.bump(journal);
assert Discovery.pending(journal);

// One child with 251 teams must span three bounded pages, not one huge row.
func width(_phase : Nat, _offset : Nat) : Nat = 251;
func edge(_phase : Nat, _offset : Nat, nested : Nat) : ?Source.Edge = ?#ChildTeam({ child = "child"; team = nested.toText() });
let first = switch (Source.read(3, null, [1], width, edge)) { case (#Ok(p)) p; case (#Err(_)) { assert false; loop {} } };
assert first.scanned == 100;
assert first.edges.size() == 100;
let second = switch (Source.read(3, first.next, [1], width, edge)) { case (#Ok(p)) p; case (#Err(_)) { assert false; loop {} } };
assert second.scanned == 100;
let third = switch (Source.read(3, second.next, [1], width, edge)) { case (#Ok(p)) p; case (#Err(_)) { assert false; loop {} } };
assert third.scanned == 51;
assert third.next == null;
assert (switch (Source.read(4, first.next, [1], width, edge)) { case (#Err(_)) true; case (_) false });
assert (switch (Source.read(3, ?{ revision = 3; phase = 0; offset = 0; nested = 252 }, [1], width, edge)) { case (#Err(_)) true; case (_) false });