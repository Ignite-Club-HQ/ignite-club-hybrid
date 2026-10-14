module {
  type FreeUsageRow = { club_id : Text; cycle : Nat; category : Text; count : Nat; bytes : Nat64 };
  // Free-plan media caps: per-club per-cycle upload counters start empty.
  public func migration(_ : {}) : { var free_media_usage : [FreeUsageRow] } {
    { var free_media_usage = [] }
  };
};
