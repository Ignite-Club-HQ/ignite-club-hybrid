import Map "mo:core/Map";
module {
  public func migration(_ : {}) : { var backupRestoreProgress : Map.Map<Text, { next : Nat; restored : Nat; skipped : Nat; complete : Bool }> } {
    { var backupRestoreProgress = Map.empty<Text, { next : Nat; restored : Nat; skipped : Nat; complete : Bool }>() }
  }
}
