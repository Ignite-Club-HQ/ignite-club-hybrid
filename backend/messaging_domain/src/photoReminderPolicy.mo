import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";

module {
  public type Settings = { enabled : Bool; window_start_hours : Nat32; window_end_hours : Nat32; cooldown_days : Nat32 };
  public func valid(s : Settings) : Bool {
    s.window_start_hours >= 1 and s.window_end_hours > s.window_start_hours and
    s.window_end_hours <= 168 and s.cooldown_days >= 1 and s.cooldown_days <= 90
  };
  public func eligible(s : Settings, stamp : Nat64, now : Nat64, last : ?Nat64) : Bool {
    if (not s.enabled or not valid(s) or stamp > now) return false;
    let age = now - stamp;
    if (age < Nat64.fromNat(Nat32.toNat(s.window_start_hours)) * 3_600_000 or
        age > Nat64.fromNat(Nat32.toNat(s.window_end_hours)) * 3_600_000) return false;
    switch (last) {
      case null { true };
      case (?t) { now >= t and now - t >= Nat64.fromNat(Nat32.toNat(s.cooldown_days)) * 86_400_000 };
    }
  };
};