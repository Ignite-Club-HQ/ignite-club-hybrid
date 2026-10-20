// @testmode replica
// REAL sparse Region growth; never a 500 GiB physical allocation on this RTS.
// Run with --max-stable-pages 3276800 (200 GiB physical ceiling).
import Multi "../src/multiRegionBytes";
import Stable "../src/stableBytes";
import Region "mo:core/Region";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Blob "mo:core/Blob";
persistent actor {
  let legacy : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
  let store : Multi.Store = { legacy; regions = Map.empty() };
  var saved : [Stable.Slice] = [];
  func sparse(bank : Stable.Store, end : Nat) {
    let pages = end / 65_536;
    let old = Region.size(bank.region).toNat();
    assert pages >= old;
    assert Region.grow(bank.region, (pages - old).toNat64()) != 18_446_744_073_709_551_615;
    bank.end := end.toNat64()
  };
  public func runTests() : async () {
    let cap = Multi.runtimeBytes;
    let ?old = Multi.writeWithin(store, "legacy!", 1_073_741_824, false) else { assert false; loop {} };
    assert old.offset == 0;
    sparse(legacy, Stable.physicalLimit - 65_536);
    let ?edge0 = Multi.writeWithin(store, "edge-0!", cap, true) else { assert false; loop {} };
    let ?edge1 = Multi.reserveWithin(store, 7, cap, true) else { assert false; loop {} };
    assert edge1.offset == 68_719_476_736;
    assert Multi.writeReserved(store, edge1, "edge-1!");
    assert Multi.read(store, old, 0, 100) == "legacy!";
    assert Multi.read(store, edge0, 0, 100) == "edge-0!";
    assert Multi.read(store, edge1, 2, 100) == "ge-1!";
    assert Multi.read(store, edge1, 7, 1) == "";
    assert not Multi.writeReserved(store, edge1, "wrong-size");
    let ?bank1 = store.regions.get(1) else { assert false; loop {} };
    sparse(bank1, Stable.physicalLimit);
    let ?edge2 = Multi.writeWithin(store, "edge-2!", cap, true) else { assert false; loop {} };
    assert edge2.offset == 137_438_953_472;
    assert Multi.read(store, edge2, 0, 100) == "edge-2!";
    let ?bank2 = store.regions.get(2) else { assert false; loop {} };
    sparse(bank2, Stable.physicalLimit);
    let ?edge3 = Multi.writeWithin(store, "edge-3!", cap, true) else { assert false; loop {} };
    assert edge3.offset == 206_158_430_208;
    let count = store.regions.size();
    let physical = Multi.physicalBytes(store);
    assert not Multi.canAllocateWithin(store, 1, Multi.targetBytes, true);
    assert Multi.reserveWithin(store, 1, Multi.targetBytes, true) == null;
    assert store.regions.size() == count and Multi.physicalBytes(store) == physical;
    assert Multi.reserveWithin(store, 1, 0, true) == null;
    let invalid : Stable.Slice = { offset = 68_719_411_200; length = 1; slot = 131_072 };
    assert not Multi.writeReserved(store, invalid, "x");
    Multi.release(store, invalid);
    assert Multi.read(store, invalid, 0, 1) == "";
    Multi.release(store, edge1);
    let ?reused = Multi.writeWithin(store, "reuse-1", cap, true) else { assert false; loop {} };
    assert reused.offset == edge1.offset;
    assert Multi.read(store, edge2, 0, 100) == "edge-2!";
    assert Multi.read(store, old, 0, 100) == "legacy!";
    saved := [old, edge0, reused, edge2, edge3];
    assert Multi.physicalBytes(store) <= Multi.runtimeBytes - Multi.runtimeReserve;
    // Exhaust the bounded fourth bank's configured tail, then observe a
    // real refusal without creating bank five or modifying any file.
    let ?bank3 = store.regions.get(3) else { assert false; loop {} };
    sparse(bank3, Multi.bankCapacity(3, cap));
    let before = Multi.physicalBytes(store);
    assert not Multi.canAllocateWithin(store, 1, cap, true);
    assert Multi.reserveWithin(store, 1, cap, true) == null;
    assert Multi.physicalBytes(store) == before and store.regions.size() == 3
  };
  public func verifyUpgrade() : async () {
    assert saved.size() == 5;
    for (i in Nat.range(0, saved.size())) {
      assert Multi.read(store, saved[i], 0, 100) == (["legacy!", "edge-0!", "reuse-1", "edge-2!", "edge-3!"] : [Blob])[i]
    };
    Multi.release(store, saved[4]);
    let ?held = Multi.reserveWithin(store, 7, Multi.runtimeBytes, true) else { assert false; loop {} };
    assert held.offset == saved[4].offset;
    assert Multi.writeReserved(store, held, "upgrade");
    assert Multi.read(store, held, 0, 100) == "upgrade"
  }
}