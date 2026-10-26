import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  // One-time Supabase -> Internet Identity account claims (club migration tool).
  public func migration(_ : {}) : {
    var accountClaims : Map.Map<Text, { club_id : Text; source_user : Text; email_hint : Text; expires_ms : Nat64; claimed_by : ?Principal; claimed_ms : ?Nat64 }>;
    var claimsByPrincipal : Map.Map<Text, Text>;
  } {
    { var accountClaims = Map.empty(); var claimsByPrincipal = Map.empty() }
  }
}
