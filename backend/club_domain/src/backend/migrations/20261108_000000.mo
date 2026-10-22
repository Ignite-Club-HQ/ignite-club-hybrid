module {
  public func migration(_ : {}) : {
    var membershipDiscoveryJournal : { var revision : Nat; var acknowledged : Nat };
  } {
    // A fresh or upgraded authority requires complete discovery/backfill.
    { var membershipDiscoveryJournal = { var revision = 1; var acknowledged = 0 } }
  }
}