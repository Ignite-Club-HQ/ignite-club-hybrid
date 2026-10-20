import Quota "../src/mediaRetainedQuota";
import Principal "mo:core/Principal";
import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
let a = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let b = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
func ok(result : Quota.Result) : Quota.Operation { switch (result) { case (#Ok(row)) row; case (#Err(_)) { assert false; loop {} } } };
func denied(result : Quota.Result) { switch (result) { case (#Err(_)) {}; case _ assert false } };
let ledger = Quota.empty();
assert Quota.baseBytes == 5_368_709_120;
assert Quota.register(ledger, a); assert Quota.register(ledger, b);
let original : Quota.Object = { store = a; path = "clubs/c/vault/a"; club = "c"; bytes = 5_368_709_119; revision = 1 };
assert Quota.baseline(ledger, original); assert Quota.baseline(ledger, original);
assert Quota.usage(ledger, "c").finalized == 5_368_709_119;
denied(Quota.reserve(ledger, a, "missing", "c", "clubs/c/gallery/a", 1, true, 0));
assert Quota.seal(ledger, a); assert Quota.seal(ledger, b);
ignore ok(Quota.reserve(ledger, b, "one", "c", "clubs/c/chat/a", 1, true, 0));
denied(Quota.reserve(ledger, a, "two", "c", "clubs/c/gallery/b", 1, true, 0));
ignore ok(Quota.reserve(ledger, b, "one", "c", "clubs/c/chat/a", 1, true, 0));
assert Quota.usage(ledger, "c").pending == 1;
ignore ok(Quota.settle(ledger, b, "one", true)); ignore ok(Quota.settle(ledger, b, "one", true));
assert Quota.usage(ledger, "c").finalized == 5_368_709_120;
assert Quota.usage(ledger, "c").pending == 0;
denied(Quota.reserve(ledger, a, "branding", "c", "clubs/c/logos/a", 1, true, 0));
ignore ok(Quota.reserve(ledger, a, "extra", "c", "clubs/c/gallery/extra", 1, true, 1));
ignore ok(Quota.settle(ledger, a, "extra", false));
assert Quota.usage(ledger, "c").pending == 0;
ignore ok(Quota.cancel(ledger, b, "early", "c", "clubs/c/chat/early", 7));
assert ok(Quota.reserve(ledger, b, "early", "c", "clubs/c/chat/early", 7, true, 1)).state == #released;
assert Quota.usage(ledger, "c").pending == 0;
ignore ok(Quota.deleted(ledger, a, "delete", original)); ignore ok(Quota.deleted(ledger, a, "delete", original));
assert Quota.usage(ledger, "c").finalized == 1;
ignore ok(Quota.reserve(ledger, a, "replacement", "c", "clubs/c/vault/a", 9, true, 0));
ignore ok(Quota.settle(ledger, a, "replacement", true));
denied(Quota.deleted(ledger, a, "stale", original));
ignore ok(Quota.reserve(ledger, a, "replace-again", "c", "clubs/c/vault/a", 4, true, 0));
denied(Quota.reserve(ledger, a, "race", "c", "clubs/c/vault/a", 2, true, 0));
ignore ok(Quota.settle(ledger, a, "replace-again", true));
assert Quota.usage(ledger, "c").finalized == 5;
denied(Quota.reserve(ledger, a, "replace-again", "different", "clubs/c/vault/a", 4, true, 0));
assert Quota.register(ledger, Principal.fromText("r7inp-6aaaa-aaaaa-aaabq-cai"));
assert not Quota.ready(ledger);
denied(Quota.reserve(ledger, b, "incomplete", "c", "clubs/c/chat/new", 1, true, 0));
// Equal-size delete/recreate cannot reset revisions and admit a stale receipt.
let aba = Quota.empty();
let small : Quota.Object = { original with bytes = 7 };
assert Quota.register(aba, a); assert Quota.baseline(aba, small); assert Quota.seal(aba, a);
ignore ok(Quota.deleted(aba, a, "d", small));
ignore ok(Quota.reserve(aba, a, "recreate", "c", small.path, 7, true, 0));
ignore ok(Quota.settle(aba, a, "recreate", true));
denied(Quota.deleted(aba, a, "late", small));
assert Quota.usage(aba, "c").finalized == 7;
// Deletion preparation locks the exact object and reserves journal capacity
// before the store physically removes ciphertext. Credit stays idempotent.
let deletion = Quota.empty();
assert Quota.register(deletion,a); assert Quota.baseline(deletion,small); assert Quota.seal(deletion,a);
ignore ok(Quota.prepareDeleted(deletion,a,"prepared-delete",small));
denied(Quota.reserve(deletion,a,"blocked-write","c",small.path,1,true,0));
assert Quota.usage(deletion,"c").finalized == 7;
ignore ok(Quota.deleted(deletion,a,"prepared-delete",small));
ignore ok(Quota.deleted(deletion,a,"prepared-delete",small));
assert Quota.usage(deletion,"c").finalized == 0;
// Full journal denies deletion preparation before bytes are removed, while
// an already-prepared receipt can still credit deletion at the hard cap.
let full = Quota.empty();
assert Quota.register(full,a); assert Quota.baseline(full,small); assert Quota.seal(full,a);
let prepared = ok(Quota.prepareDeleted(full,a,"last-delete",small));
var index = 0;
while (full.operations.size() < Quota.maxEntries) {
  full.operations.add("fixture-" # index.toText(), { prepared with token = "fixture-" # index.toText(); state = #released });
  index += 1
};
denied(Quota.prepareDeleted(full,a,"cannot-allocate",small));
assert Quota.usage(full,"c").finalized == 7;
ignore ok(Quota.deleted(full,a,"last-delete",small));
assert Quota.usage(full,"c").finalized == 0;
