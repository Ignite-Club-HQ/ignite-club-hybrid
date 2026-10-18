// Additive preparation only. Existing store quotas/uploads remain unchanged.
// Freeze persisted records here; never import the mutable mediaQuota module.
import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  type Usage = { count : Nat; bytes : Nat; pending_count : Nat; pending_bytes : Nat };
  type Reservation = {
    store : Principal; token : Text; club_id : Text; category : Text;
    cycle : Nat; bytes : Nat; status : { #reserved; #committed; #released };
  };
  public func migration(_ : {}) : {
    var mediaQuotaLedger : { usage : Map.Map<Text, Usage>; reservations : Map.Map<Text, Reservation> };
    var mediaQuotaStores : [Principal];
  } {
    {
      var mediaQuotaLedger = { usage = Map.empty<Text, Usage>(); reservations = Map.empty<Text, Reservation>() };
      var mediaQuotaStores = [];
    }
  };
}