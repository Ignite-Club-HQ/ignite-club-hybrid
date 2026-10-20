// @testmode replica
import Packed "../src/packedClubBytes";
import Space "../src/clubPhysicalSpace";
import Stable "../src/stableBytes";
import Map "mo:core/Map";
import Region "mo:core/Region";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Array "mo:core/Array";
import Blob "mo:core/Blob";
persistent actor {
  let global : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
  let spaces = Space.empty(global);
  let packed = Packed.empty(spaces, "c");
  var saved : ?Packed.Handle = null;
  public func prepareUpgrade() : async () {
    assert Space.promise(spaces, "c", Space.rootBytes, Space.rootBytes);
    let ?handle = Packed.reserve(packed, 3) else { assert false; loop {} };
    assert Packed.write(packed, handle, Blob.fromArray([42, 43, 44]));
    saved := ?handle
  };
  public func verifyUpgrade() : async () {
    let ?handle = saved else { assert false; loop {} };
    assert Packed.read(packed, handle, 0, 3) == Blob.fromArray([42, 43, 44]);
    Packed.release(packed, handle);
    let ?next = Packed.reserve(packed, 3) else { assert false; loop {} };
    assert next.generation > handle.generation;
    assert not Packed.write(packed, handle, Blob.fromArray([1, 1, 1]));
    Packed.release(packed, handle);
    assert Packed.write(packed, next, Blob.fromArray([7, 8, 9]))
  };
  public func runTests() : async () {
    assert Space.promise(spaces, "c", Space.rootBytes, Space.rootBytes);
    var handles : [Packed.Handle] = [];
    for (_ in Nat.range(0, 1024)) {
      let ?handle = Packed.reserve(packed, 1) else { assert false; loop {} };
      assert Packed.write(packed, handle, Blob.fromArray([7]));
      handles := handles.concat([handle])
    };
    // Same actual 1,024 bytes, one physical page rather than 1,024 pages.
    assert packed.pages.size() == 1;
    assert Packed.read(packed, handles[0], 0, 1) == Blob.fromArray([7]);
    assert Packed.read(packed, handles[1023], 0, 1) == Blob.fromArray([7]);
    assert not Packed.write(packed, handles[0], Blob.fromArray([1, 2]));
    let foreign = Packed.empty(spaces, "other");
    assert not Packed.write(foreign, handles[0], Blob.fromArray([9]));
    assert Packed.reserve(foreign, 1) == null;
    Packed.release(packed, handles[0]);
    let ?same = Packed.reserve(packed, 1) else { assert false; loop {} };
    assert same.page == handles[0].page and same.offset == handles[0].offset;
    assert same.generation > handles[0].generation;
    assert Packed.read(packed, same, 0, 1) == Blob.fromArray([]);
    Packed.release(packed, handles[0]);
    assert not Packed.write(packed, handles[0], Blob.fromArray([9]));
    assert Packed.write(packed, same, Blob.fromArray([8]));
    for (i in Nat.range(1, 1024)) Packed.release(packed, handles[i]);
    Packed.release(packed, same);
    assert packed.pages.size() == 0;
    let reopened = Packed.empty(spaces, "c");
    let ?newHandle = Packed.reserve(reopened, 1) else { assert false; loop {} };
    assert newHandle.generation > same.generation;
    assert not Packed.write(reopened, same, Blob.fromArray([9]));
    Packed.release(reopened, same);
    assert Packed.read(reopened, newHandle, 0, 1) == Blob.fromArray([]);
    assert Packed.write(reopened, newHandle, Blob.fromArray([6]));
    Packed.release(reopened, newHandle);
    let ?whole = Packed.reserve(packed, Packed.pageBytes) else { assert false; loop {} };
    let bytes = Blob.fromArray(Array.repeat<Nat8>(3, Packed.pageBytes));
    assert Packed.write(packed, whole, bytes);
    assert Packed.read(packed, whole, Packed.pageBytes - 1, 100) == Blob.fromArray([3]);
    assert Packed.read(packed, whole, Packed.pageBytes, 1) == Blob.fromArray([]);
    assert Packed.reserve(packed, 0) == null;
    assert Packed.reserve(packed, Packed.pageBytes + 1) == null;
    assert whole.length == 65_536 and whole.slot == 65_536;
    Packed.release(packed, whole);
    assert packed.pages.size() == 0;
    // The enclosing root remains promised to this club after page deletion.
    assert Stable.reserveWithin(global, 1, Space.rootBytes) == null;
    // Adjacent small buddies merge, but a pinned neighbour never moves.
    let ?left = Packed.reserve(packed, 32_768) else { assert false; loop {} };
    let ?right = Packed.reserve(packed, 32_768) else { assert false; loop {} };
    assert left.page == right.page and left.offset != right.offset;
    assert Packed.write(packed, right, Blob.fromArray(Array.repeat<Nat8>(5, 32_768)));
    Packed.release(packed, left);
    let ?quarterA = Packed.reserve(packed, 16_384) else { assert false; loop {} };
    let ?quarterB = Packed.reserve(packed, 16_384) else { assert false; loop {} };
    assert quarterA.page == right.page and quarterB.page == right.page;
    assert Packed.read(packed, right, 0, 1) == Blob.fromArray([5]);
    Packed.release(packed, quarterA); Packed.release(packed, quarterB);
    let ?merged = Packed.reserve(packed, 32_768) else { assert false; loop {} };
    assert merged.page == left.page and merged.offset == left.offset;
    Packed.release(packed, merged); Packed.release(packed, right);
    assert packed.pages.size() == 0;
  }
}