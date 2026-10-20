// @testmode replica
import Segments "../src/segmentedClubBytes";
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
  let store : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
  let spaces = Space.empty(store);
  let pool = Packed.empty(spaces, "club");
  let files = Segments.empty(pool);
  var saved : ?Segments.Handle = null;
  public func prepareUpgrade() : async () {
    assert Space.promise(spaces, "club", Space.rootBytes, Space.rootBytes);
    let ?file = Segments.reserve(files, 65_539) else { assert false; loop {} };
    assert Segments.writeSegment(files, file, 0, Array.repeat<Nat8>(7, 65_536).toBlob());
    saved := ?file
  };
  public func verifyUpgrade() : async () {
    let ?file = saved else { assert false; loop {} };
    assert not Segments.complete(files, file);
    assert Segments.read(files, file, 65_535, 4) == "";
    assert Segments.writeSegment(files, file, 1, ([8, 9, 10] : [Nat8]).toBlob());
    assert Segments.complete(files, file);
    assert Segments.read(files, file, 65_535, 4) == ([7, 8, 9, 10] : [Nat8]).toBlob();
    Segments.release(files, file);
    let ?next = Segments.reserve(files, 65_539) else { assert false; loop {} };
    assert next.generation > file.generation;
    assert not Segments.writeSegment(files, file, 1, ([1, 1, 1] : [Nat8]).toBlob());
    Segments.release(files, file);
    assert Segments.writeSegment(files, next, 1, ([2, 2, 2] : [Nat8]).toBlob())
  };
  public func runTests() : async () {
    assert Space.promise(spaces, "club", Space.rootBytes * 3, Space.rootBytes * 3);
    for (length in [1, 65_535, 65_536, 65_537, 25 * 1_048_576, Segments.maxSegments * 65_536].values()) {
      let ?file = Segments.reserve(files, length) else { assert false; loop {} };
      assert file.length == length;
      assert not Segments.complete(files, file);
      assert Segments.read(files, file, 0, 1) == "";
      for (i in Nat.range(0, file.segments)) {
        let size = Nat.min(65_536, length - i * 65_536);
        assert Segments.writeSegment(files, file, i, Array.repeat<Nat8>(7, size).toBlob())
      };
      assert Segments.complete(files, file);
      assert Segments.read(files, file, length - 1, 10) == ([7] : [Nat8]).toBlob();
      assert Segments.read(files, file, length, 1) == "";
      assert not Segments.writeSegment(files, file, file.segments, "");
      assert not Segments.writeSegment(files, file, 0, "");
      Segments.release(files, file); Segments.release(files, file);
      assert files.files.size() == 0 and pool.pages.size() == 0;
    };
    assert Segments.reserve(files, 0) == null;
    assert Segments.reserve(files, Segments.maxSegments * 65_536 + 1) == null;
    let priorGeneration = spaces.nextGeneration;
    spaces.nextGeneration := 18_446_744_073_709_551_614;
    assert Segments.reserve(files, 1) == null;
    assert pool.pages.size() == 0 and files.files.size() == 0;
    spaces.nextGeneration := priorGeneration;
    let ?stale = Segments.reserve(files, 1) else { assert false; loop {} };
    Segments.release(files, stale);
    let ?replacement = Segments.reserve(files, 1) else { assert false; loop {} };
    assert not Segments.writeSegment(files, stale, 0, ([9] : [Nat8]).toBlob());
    Segments.release(files, stale);
    assert Segments.writeSegment(files, replacement, 0, ([8] : [Nat8]).toBlob());
    assert Segments.writeSegment(files, replacement, 0, ([8] : [Nat8]).toBlob());
    assert not Segments.writeSegment(files, replacement, 0, ([9] : [Nat8]).toBlob());
    let foreign = Segments.empty(Packed.empty(spaces, "foreign"));
    assert not Segments.writeSegment(foreign, replacement, 0, ([8] : [Nat8]).toBlob());
    Segments.release(foreign, replacement);
    assert Segments.read(files, replacement, 0, 1) == ([8] : [Nat8]).toBlob();
    Segments.release(files, replacement);
    // Descriptor records themselves share pages with tiny ciphertexts.
    var tinyFiles : [Segments.Handle] = [];
    for (_ in Nat.range(0, 512)) {
      let ?file = Segments.reserve(files, 1) else { assert false; loop {} };
      tinyFiles := tinyFiles.concat([file])
    };
    assert pool.pages.size() == 1;
    for (file in tinyFiles.values()) Segments.release(files, file);
    assert pool.pages.size() == 0;
    // Malformed descriptors are refused without partially releasing pages.
    let ?damaged = Segments.reserve(files, 65_537) else { assert false; loop {} };
    let at = damaged.table.page + damaged.table.offset.toNat64() + 24;
    Region.storeNat64(store.region, at, 0);
    assert not Segments.writeSegment(files, damaged, 0, Array.repeat<Nat8>(7, 65_536).toBlob());
    let before = pool.pages.size();
    Segments.release(files, damaged);
    assert pool.pages.size() == before and files.files.size() == 1;
    Region.storeNat64(store.region, at, 65_536);
    Segments.release(files, damaged);
    assert pool.pages.size() == 0 and files.files.size() == 0;
    // Fail after acquiring a descriptor and many payload pages. Roll back
    // all physical reservations without refunding the club's promised roots.
    let smallStore : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
    let smallSpace = Space.empty(smallStore);
    assert Space.promise(smallSpace, "s", Space.rootBytes, Space.rootBytes);
    let smallPool = Packed.empty(smallSpace, "s");
    let smallFiles = Segments.empty(smallPool);
    assert Segments.reserve(smallFiles, Space.rootBytes) == null;
    assert smallPool.pages.size() == 0 and smallFiles.files.size() == 0;
    assert Space.reserve(smallSpace, "s", Space.rootBytes) != null;
    assert Stable.reserveWithin(smallStore, 1, Space.rootBytes) == null;
  }
}