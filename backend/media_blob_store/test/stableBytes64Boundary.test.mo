// @testmode replica
// Sparse local boundary probe of the real allocator, not a full-volume fill.
// The production policy remains 32 GiB; cap is supplied directly to the allocator.
import Region "mo:core/Region";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Stable "../src/stableBytes";
persistent actor {
  public func runTests() : async () {
    let gib = 1_073_741_824;
    let cap = 64 * gib;
    let page = 65_536;
    let store : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
    // Sparse growth maps pages; only two payload pages are touched.
    let start = 32 * gib - page;
    assert Region.grow(store.region, (start / page).toNat64()) != 18_446_744_073_709_551_615;
    store.end := start.toNat64();
    let ?below = Stable.writeWithin(store, "below-32", cap) else { assert false; loop {} };
    let ?above = Stable.writeWithin(store, "above-32", cap) else { assert false; loop {} };
    assert below.offset.toNat() == start;
    assert above.offset.toNat() == 32 * gib;
    assert Stable.read(store, below, 0, 100) == "below-32";
    assert Stable.read(store, above, 0, 100) == "above-32";
    Stable.release(store, above);
    let ?reused = Stable.writeWithin(store, "reused-32", cap) else { assert false; loop {} };
    assert reused.offset == above.offset;
    assert Stable.read(store, below, 0, 100) == "below-32";
    assert Stable.read(store, reused, 0, 100) == "reused-32";

    // Leave 64 MiB for runtime/Region metadata: 64 GiB payload is not promised.
    let near = cap - 67_108_864;
    let high : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
    assert Region.grow(high.region, (near / page).toNat64()) != 18_446_744_073_709_551_615;
    high.end := near.toNat64();
    let boundedCap = near + page;
    let ?held = Stable.reserveWithin(high, 8, boundedCap) else { assert false; loop {} };
    assert held.offset.toNat() == near;
    assert Stable.writeReserved(high, held, "near-64!");
    assert Stable.read(high, held, 0, 100) == "near-64!";
    let end = high.end;
    assert not Stable.canAllocateWithin(high, 1, boundedCap);
    assert Stable.reserveWithin(high, 1, boundedCap) == null;
    assert high.end == end;
    assert Stable.read(high, held, 0, 100) == "near-64!";
    Stable.release(high, held);
    let ?again = Stable.writeWithin(high, "reupload", boundedCap) else { assert false; loop {} };
    assert again.offset == held.offset and high.end == end;
    assert Stable.read(high, again, 0, 100) == "reupload";
    assert not Stable.canAllocateWithin(high, 1, near);
    assert not Stable.validSlice(cap, { offset = cap.toNat64(); length = 1; slot = page });
  };
};