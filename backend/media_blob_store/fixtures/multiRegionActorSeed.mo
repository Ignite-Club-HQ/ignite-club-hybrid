// LOCAL TEST ONLY. Copy after the real chain when building the disposable
// actor fixture. Never include this migration in a deployment recipe.
import Map "mo:core/Map";
import Region "mo:core/Region";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
module {
  type Store = { region : Region.Region; var end : Nat64; free : Map.Map<Nat, Map.Map<Nat64, ()>> };
  public func migration(old : { var stable_bytes : Store }) : { var stable_bytes : Store } {
    assert old.stable_bytes.end == 0;
    let end = 68_652_367_872;
    assert Region.grow(old.stable_bytes.region, (end / 65_536).toNat64()) != 18_446_744_073_709_551_615;
    old.stable_bytes.end := end.toNat64();
    { var stable_bytes = old.stable_bytes }
  }
}