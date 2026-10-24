import Nat64 "mo:core/Nat64";
import Array "mo:core/Array";
import Types "types";

module {
  // The existing timestamp becomes a strictly monotonic CAS token, without
  // changing the upgrade-preserved ActiveGame shape.
  public func matches(current : ?Types.ActiveGame, expected : ?Nat64) : Bool {
    switch (current, expected) {
      case (null, null) true;
      case (?row, ?revision) row.updated_at_ms == revision;
      case _ false;
    }
  };
  public func nextRevision(current : ?Types.ActiveGame, now : Nat64) : Nat64 {
    switch (current) { case (?row) Nat64.max(now, row.updated_at_ms + 1); case null now };
  };
  public func dutyRecipients(duties : [Types.EventGroupDuty], groupId : Text) : [Text] {
    var ids : [Text] = [];
    for (duty in duties.values()) {
      if (duty.group_id == groupId and (duty.duty == "Referee" or duty.duty == "Subs Manager")) {
        switch (duty.account_id) {
          case (?id) { if (not ids.any(func(x) = x == id)) ids := ids.concat([id]) };
          case null {};
        }
      }
    };
    ids
  };
}