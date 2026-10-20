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
// Old free extents may be page-aligned but cross a buddy boundary.
let legacy : Stable.Store = { region = Region.new(); var end = 393_216; free = Map.empty() };
let holes = Map.empty<Nat64, ()>(); holes.add(Nat64.fromNat(65_536), ()); holes.add(Nat64.fromNat(196_608), ());
legacy.free.add(131_072, holes);
// Releasing an unaligned old extent must never manufacture an overlapping
// 256 KiB slot from those two extents.
Stable.release(legacy, { offset = 65_536; length = 1; slot = 131_072 });
assert not Stable.canAllocateWithin(legacy, 200_000, 393_216);
assert holes.size() == 2;
};
};