// @testmode replica
// Verify virtual addresses near 500 GiB using a sparse ~52 GiB last bank.
// This is NOT proof of 500 GiB aggregate physical growth on Motoko 1.16.1.
import Multi "../src/multiRegionBytes";
import Stable "../src/stableBytes";
import Region "mo:core/Region";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
persistent actor {
  public func runTests() : async () {
    let legacy : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
    let high : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
    let store : Multi.Store = { legacy; regions = Map.empty() };
    store.regions.add(7, high);
    let near = Multi.bankCapacity(7, Multi.targetBytes) - 65_536;
    assert Region.grow(high.region, (near / 65_536).toNat64()) != 18_446_744_073_709_551_615;
    high.end := near.toNat64();
    let ?local = Stable.reserveWithin(high, 7, Multi.bankCapacity(7, Multi.targetBytes)) else { assert false; loop {} };
    let pointer = { local with offset = (7 * Multi.bankBytes + local.offset.toNat()).toNat64() };
    assert pointer.offset == 536_870_846_464;
    assert Multi.writeReserved(store, pointer, "near500");
    assert Multi.read(store, pointer, 0, 100) == "near500";
    assert Multi.read(store, pointer, 3, 2) == "r5";
    assert Multi.read(store, pointer, 7, 1) == "";
    let past : Stable.Slice = { pointer with offset = 536_870_912_000 };
    assert not Multi.writeReserved(store, past, "invalid");
    assert Multi.read(store, past, 0, 100) == "";
    Multi.release(store, past);
    assert Multi.read(store, pointer, 0, 100) == "near500";
    Multi.release(store, pointer);
    let ?again = Stable.reserveFreeWithin(high, 7, high.end.toNat()) else { assert false; loop {} };
    assert again.offset == local.offset;
    let next = { again with offset = (7 * Multi.bankBytes + again.offset.toNat()).toNat64() };
    assert Multi.writeReserved(store, next, "reuse!!");
    assert Multi.read(store, next, 0, 100) == "reuse!!";
    // The production-capacity gate refuses the 500 GiB target before growth.
    let physical = Multi.physicalBytes(store);
    assert Multi.reserveWithin(store, 1, Multi.targetBytes, true) == null;
    assert Multi.physicalBytes(store) == physical
  }
}