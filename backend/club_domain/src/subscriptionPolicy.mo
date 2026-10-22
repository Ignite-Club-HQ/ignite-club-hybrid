import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Types "types";
module {
  public func paid(s : Types.ClubSubscription, now : Nat64) : Bool {
    s.admin_pro_override or s.admin_pro_football_override or
    ((s.is_pro or s.is_pro_football) and (switch (s.expires_at_ms) { case null true; case (?expires) expires > now }))
  };
  public func premium(sub : ?Types.ClubSubscription, now : Nat64) : Bool {
    switch (sub) { case null false; case (?s) paid(s, now) or (s.is_trial and (switch (s.trial_ends_at_ms) { case (?end) end > now; case null false })) }
  };
  public func mediaBase(sub : ?Types.ClubSubscription, now : Nat64) : Nat {
    if (not premium(sub, now)) return 262_144_000;
    switch (sub) { case (?s) { if (s.plan == "unlimited") 5_368_709_120 else 3_221_225_472 }; case null 262_144_000 }
  };
  public func limit(sub : ?Types.ClubSubscription, now : Nat64) : Nat {
    switch (sub) {
      case null 20;
      case (?s) {
        let trial = s.is_trial and (switch (s.trial_ends_at_ms) { case (?expires) expires > now; case null false });
        if (not paid(s, now) and not trial) return 20;
        if (paid(s, now) and s.plan == "unlimited" and s.team_limit == null) return 100_000; // Existing platform-authorized Unlimited grants.
        let count = switch (s.team_limit) { case (?n) n.toNat(); case null 20 };
        if (count == 0) return 20;
        if (trial and not paid(s, now) and count > 20) 20 else count
      }
    }
  };
}