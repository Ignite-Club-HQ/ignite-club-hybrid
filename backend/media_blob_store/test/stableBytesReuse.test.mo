// @testmode replica
import Region "mo:core/Region";
import Map "mo:core/Map";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Blob "mo:core/Blob";
import Array "mo:core/Array";
import Stable "../src/stableBytes";
persistent actor {
public func runTests() : async () {
let store : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
let cap = 262_144;
let large = Blob.fromArray(Array.repeat<Nat8>(9, cap));
let ?original = Stable.writeWithin(store, large, cap) else { assert false; loop {} };
Stable.release(store, original);
let small = Blob.fromArray(Array.repeat<Nat8>(7, 40_000));
var slices : [Stable.Slice] = [];
for (_ in Nat.range(0, 4)) {
  assert Stable.canAllocateWithin(store, small.size(), cap);
  let ?slice = Stable.writeWithin(store, small, cap) else { assert false; loop {} };
  slices := slices.concat([slice]);
};
assert store.end == 262_144;
assert not Stable.canAllocateWithin(store, 1, cap);
Stable.release(store, slices[0]);
Stable.release(store, slices[2]);
// Two non-buddy holes must not admit a larger contiguous object.
assert not Stable.canAllocateWithin(store, 100_000, cap);
assert Stable.read(store, slices[1], 0, small.size()) == small;
assert Stable.read(store, slices[3], 0, small.size()) == small;
Stable.release(store, slices[1]);
assert Stable.canAllocateWithin(store, 100_000, cap);
Stable.release(store, slices[3]);
assert Stable.canAllocateWithin(store, cap, cap);
let ?reused = Stable.writeWithin(store, large, cap) else { assert false; loop {} };
assert reused.offset == 0 and store.end == 262_144;
assert Stable.read(store, reused, 0, cap) == large;
assert not Stable.canAllocateWithin(store, 16_777_217, 34_359_738_368);
};
};