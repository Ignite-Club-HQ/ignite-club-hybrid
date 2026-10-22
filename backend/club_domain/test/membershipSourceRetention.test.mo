import Retention "../src/membershipSourceRetention";
import Source "../src/membershipSource";
import Directory "../src/membershipDirectorySource";
import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
import Nat "mo:core/Nat";
let identity = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let binding : Directory.Binding = { identity; router = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai"); group = "g1"; deployment = "mainnet"; generation = 1; inventory_digest = Blob.fromArray(Array.tabulate<Nat8>(32, func(_) = 1)) };
let state : Retention.State = { var snapshot = null };
var live : Retention.Data = {
  profiles = []; roles = []; guardians = []; aclTeams = []; teams = []; exclusions = []; removed = [];
  children = [{ id = "child"; parent = ?identity; club_id = null; teams = Array.tabulate<Text>(350, func n = n.toText()) }];
};
var captures = 0;
func capture() : Retention.Data { captures += 1; live };
let start : Source.Cursor = { revision = 7; phase = 0; offset = 0; nested = 0 };
let snapshot = switch (Retention.acquire(state, binding, 7, ?start, capture)) { case (#Ok(s)) s; case (_) { assert false; loop {} } };
assert not Retention.complete(state, binding, 7);
var cursor : ?Source.Cursor = ?start;
var scanned = 0; var pages = 0; var childTeams = 0; var parents = 0;
loop {
  let page = switch (Retention.read(snapshot, cursor)) { case (#Ok(p)) p; case (_) { assert false; loop {} } };
  assert page.revision == 7 and page.scanned <= 100;
  assert Retention.read(snapshot, cursor) == #Ok(page);
  for (e in page.edges.values()) {
    switch (e) {
      case (#Parent(p)) { assert p.child == "child" and p.subject == identity; parents += 1 };
      case (#ChildTeam(t)) { assert t.child == "child" and t.team == childTeams.toText(); childTeams += 1 };
      case (_) { assert false }
    }
  };
  scanned += page.scanned; pages += 1;
  // Replace and compact every live relationship between pages; retained
  // nested edges must remain the original finite 351-slot traversal.
  live := { live with children = []; exclusions = [{ club = "club"; user = identity }]; roles = [{ user = identity; role = "member"; club = ?"new"; team = null }] };
  assert (switch (Retention.acquire(state, binding, 100 + pages, page.next, capture)) { case (#Ok(s)) s.revision == 7; case (_) false });
  cursor := page.next;
  if (cursor == null) break;
};
assert captures == 1 and scanned == 351 and pages == 4;
assert parents == 1 and childTeams == 350;
assert not Retention.complete(state, { binding with generation = 2 }, 7);
assert not Retention.complete(state, binding, 8);
assert Retention.complete(state, binding, 7);
assert (switch (state.snapshot) { case null true; case (_) false });
assert (switch (Retention.acquire(state, binding, 20, ?start, capture)) { case (#Err(_)) true; case (_) false });
assert captures == 1;
let replacement = switch (Retention.acquire(state, binding, 20, null, capture)) { case (#Ok(s)) s; case (_) { assert false; loop {} } };
assert replacement.revision == 20 and captures == 2;
assert (switch (Retention.acquire(state, { binding with generation = 2 }, 21, null, capture)) { case (#Err(_)) true; case (_) false });
let final = switch (Retention.read(replacement, null)) { case (#Ok(p)) p; case (_) { assert false; loop {} } };
assert final.next == null and final.scanned == 2;
assert Retention.read(replacement, null) == #Ok(final);