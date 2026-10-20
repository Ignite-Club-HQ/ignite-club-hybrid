// @testmode replica
import Space "../src/clubPhysicalSpace";
import Stable "../src/stableBytes";
import Region "mo:core/Region";
import Map "mo:core/Map";
import Blob "mo:core/Blob";
import Text "mo:core/Text";
import Nat "mo:core/Nat";
import Array "mo:core/Array";
persistent actor {
  let global : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
  let spaces = Space.empty(global);
  var upgradeHeld : ?Space.Allocation = null;
  public func prepareUpgrade() : async () {
    assert Space.promise(spaces, "upgrade", Space.rootBytes, Space.rootBytes);
    let ?held = Space.reserve(spaces, "upgrade", 1) else { assert false; loop {} };
    assert Space.write(spaces, "upgrade", held, Blob.fromArray([42]));
    upgradeHeld := ?held
  };
  public func verifyUpgrade() : async () {
    let ?held = upgradeHeld else { assert false; loop {} };
    assert Stable.read(global, held.slice, 0, 1) == Blob.fromArray([42]);
    assert Stable.reserveWithin(global, 1, Space.rootBytes) == null;
    Space.release(spaces, "upgrade", held);
    let ?replacement = Space.reserve(spaces, "upgrade", 1) else { assert false; loop {} };
    assert replacement.slice == held.slice and replacement.generation > held.generation;
    assert not Space.write(spaces, "upgrade", held, Blob.fromArray([99]));
    Space.release(spaces, "upgrade", held);
    assert Space.write(spaces, "upgrade", replacement, Blob.fromArray([43]))
  };
  public func runTests() : async () {
    let cap = Space.rootBytes * 3;
    assert Space.promise(spaces, "existing", Space.rootBytes * 2, cap);
    assert Space.promise(spaces, "new", Space.rootBytes, cap);
    assert not Space.promise(spaces, "oversold", 1, cap);
    assert Stable.reserveWithin(global, 1, cap) == null;
    assert Space.promise(spaces, "existing", 1, cap);
    let ?existing = spaces.arenas.get("existing") else { assert false; loop {} };
    assert existing.roots == 2;
    let ?tiny = Space.reserve(spaces, "new", 1) else { assert false; loop {} };
    let ?large = Space.reserve(spaces, "existing", Space.rootBytes) else { assert false; loop {} };
    assert tiny.slice.offset != large.slice.offset;
    assert not Space.write(spaces, "existing", tiny, Blob.fromArray([8]));
    Space.release(spaces, "existing", tiny);
    assert Space.reserve(spaces, "new", Space.rootBytes) == null;
    assert Space.write(spaces, "new", tiny, Blob.fromArray([7]));
    assert Stable.read(global, tiny.slice, 0, 1) == Blob.fromArray([7]);
    Space.release(spaces, "new", tiny);
    Space.release(spaces, "new", tiny);
    let ?sameShape = Space.reserve(spaces, "new", 1) else { assert false; loop {} };
    assert sameShape.slice == tiny.slice and sameShape.generation > tiny.generation;
    assert not Space.write(spaces, "new", tiny, Blob.fromArray([9]));
    Space.release(spaces, "new", tiny);
    assert Space.write(spaces, "new", sameShape, Blob.fromArray([8]));
    Space.release(spaces, "new", sameShape);
    let ?reused = Space.reserve(spaces, "new", Space.rootBytes) else { assert false; loop {} };
    assert reused.slice.offset == tiny.slice.offset;
    assert Space.reserve(spaces, "new", 1) == null;
    assert Space.reserve(spaces, "unknown", 1) == null;
    assert not Space.promise(spaces, "new", Space.rootBytes * 2, cap);
    let ?newClub = spaces.arenas.get("new") else { assert false; loop {} };
    assert newClub.roots == 1;
    // A club can still use its reserved second root after the other fills up.
    assert Space.reserve(spaces, "existing", Space.rootBytes) != null;
    // A payload-byte promise is NOT a file-count/fragmentation guarantee.
    // Keep this counterexample as a release blocker rather than assume it away.
    let fragmented : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
    let fragments = Space.empty(fragmented);
    assert Space.promise(fragments, "tiny", Space.rootBytes, Space.rootBytes * 2);
    var allocations : [Space.Allocation] = [];
    for (_ in Nat.range(0, 256)) {
      let ?held = Space.reserve(fragments, "tiny", 1) else { assert false; loop {} };
      allocations := allocations.concat([held])
    };
    assert Space.reserve(fragments, "tiny", 1) == null;
    assert Stable.canAllocateWithin(fragmented, 1, Space.rootBytes * 2);
    for (i in Nat.range(1, 256)) Space.release(fragments, "tiny", allocations[i]);
    assert Space.reserve(fragments, "tiny", Space.rootBytes) == null;
    assert Space.reserve(fragments, "tiny", 1) != null;
  }
}