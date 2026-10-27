import Array "mo:core/Array";

module {
  public type Record = { id : Text; club_id : Text; deleted_at_ms : ?Nat64; is_active : Bool };
  public type Legacy = { id : Text; club : Text };

  public func valid(club : Text, team : Text, records : [Record], legacy : [Legacy]) : Bool {
    // An existing record is authoritative, including deletion/inactivity.
    // Only record absence permits the historical ACL-only fallback.
    switch (records.find(func row = row.id == team)) {
      case (?row) row.club_id == club and row.deleted_at_ms == null and row.is_active;
      case null legacy.any(func row = row.id == team and row.club == club);
    }
  };
}