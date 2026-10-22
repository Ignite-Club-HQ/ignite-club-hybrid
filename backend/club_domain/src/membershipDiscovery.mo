import Nat "mo:core/Nat";
module {
  // Coalesced durable invalidation outbox, not a resource permission grant.
  // pending remains until an exact revision acknowledgement. Intermediate
  // revisions may be superseded only by a complete newer source snapshot.
  public type Journal = { var revision : Nat; var acknowledged : Nat };
  public type Cursor = { revision : Nat; offset : Nat };
  public func bump(journal : Journal) { journal.revision += 1 };
  public func acknowledge(journal : Journal, revision : Nat) : Bool {
    if (revision != journal.revision) return false;
    journal.acknowledged := revision;
    true
  };
  public func pending(journal : Journal) : Bool = journal.acknowledged != journal.revision;
}