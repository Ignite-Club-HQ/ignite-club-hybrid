// @testmode replica
import Space "../src/clubPhysicalSpace";
import Stable "../src/stableBytes";
import Region "mo:core/Region";
import Map "mo:core/Map";
import Blob "mo:core/Blob";
import Text "mo:core/Text";
persistent actor {
  let global : Stable.Store = { region = Region.new(); var end = 0; free = Map.empty() };
  let spaces = Space.empty();
  public func runTests() : async () {
    let cap = Space.rootBytes * 3;
    assert Space.promise(spaces, global, "existing", Space.rootBytes * 2, cap);
    assert Space.promise(spaces, global, "new", Space.rootBytes, cap);
    assert not Space.promise(spaces, global, "oversold", 1, cap);
    assert Stable.reserveWithin(global, 1, cap) == null;
    assert Space.promise(spaces, global, "existing", 1, cap);
    let ?existing = spaces.get("existing") else { assert false; loop {} };
    assert existing.roots == 2;
    let ?tiny = Space.reserve(spaces, "new", 1) else { assert false; loop {} };
    let ?large = Space.reserve(spaces, "existing", Space.rootBytes) else { assert false; loop {} };
    assert tiny.offset != large.offset;
    assert not Space.write(spaces, "existing", tiny, Blob.fromArray([8]));
    Space.release(spaces, "existing", tiny);
    assert Space.reserve(spaces, "new", Space.rootBytes) == null;
    assert Space.write(spaces, "new", tiny, Blob.fromArray([7]));
    assert Stable.read(global, tiny, 0, 1) == Blob.fromArray([7]);
    Space.release(spaces, "new", tiny);
    Space.release(spaces, "new", tiny);
    let ?reused = Space.reserve(spaces, "new", Space.rootBytes) else { assert false; loop {} };
    assert reused.offset == tiny.offset;
    assert Space.reserve(spaces, "new", 1) == null;
    assert Space.reserve(spaces, "unknown", 1) == null;
    assert not Space.promise(spaces, global, "new", Space.rootBytes * 2, cap);
    let ?newClub = spaces.get("new") else { assert false; loop {} };
    assert newClub.roots == 1;
    // A club can still use its reserved second root after the other fills up.
    assert Space.reserve(spaces, "existing", Space.rootBytes) != null;
  }
}