import Map "mo:core/Map";
import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : {
    var eventSetupReceipts : [(Principal, Text, Blob, { first_event_id : Text; series_id : ?Text; event_ids : [Text] })];
    var eventNoticeAttempts : [{ event_id : Text; kind : Text; users : [Text]; key : Text; created_at_ms : Nat64; status : Text; queued : Nat16 }];
    var scheduleViewPreferences : Map.Map<Principal, Text>;
  } {
    { var eventSetupReceipts = []; var eventNoticeAttempts = []; var scheduleViewPreferences = Map.empty() }
  }
}