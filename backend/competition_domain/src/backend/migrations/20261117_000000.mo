module {
  public func migration(_ : {}) : { var playhqCompetitionLinks : [{ competition_id : Text; club_id : Text; tenant : Text; grade_id : Text; sport : ?Text; last_synced_at_ms : ?Nat64 }] } {
    { var playhqCompetitionLinks = [] }
  }
}