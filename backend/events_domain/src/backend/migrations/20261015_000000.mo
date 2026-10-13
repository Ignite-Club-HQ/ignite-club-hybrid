// Adds six independent, purely-additive stores (partial migration):
//  - favouriteEventTitles: per-caller shortlist of event titles for reuse
//    when creating events.
//  - savedLocations: per-caller saved addresses (label/address/lat/lng) for
//    the event location autocomplete.
//  - trainingDefaults: per (caller, club, team, child) default RSVP applied
//    to new training events in the UI.
//  - rsvpCreatedAt: first-RSVP timestamp per (event, account), preserved
//    across later status changes (set_rsvp/admin_upsert_rsvp only touch
//    updated_at_ms on the Rsvp record itself).
//  - matchCaptainAssignments: per-match captain/vice-captain assignment
//    (event_id, account/child ref, role).
//  - matchGoalkeeperAssignments: per-match goalkeeper assignment
//    (event_id, player ref, period/quarter).
import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : {
    var favouriteEventTitles : [{ account_id : Text; title : Text }];
    var savedLocations : [{ id : Text; account_id : Text; location_label : Text; address : Text; lat : Float; lng : Float; created_at_ms : Nat64 }];
    var trainingDefaults : [{ account_id : Text; club_id : Text; team_id : Text; child_id : ?Text; default_rsvp : Text; updated_at_ms : Nat64 }];
    var rsvpCreatedAt : [{ event_id : Text; account_id : Text; created_at_ms : Nat64 }];
    var matchCaptainAssignments : [{ event_id : Text; ref_kind : Text; ref_id : Text; role : Text; assigned_by : Principal; updated_at_ms : Nat64 }];
    var matchGoalkeeperAssignments : [{ event_id : Text; ref_kind : Text; ref_id : Text; period : Text; assigned_by : Principal; updated_at_ms : Nat64 }];
  } {
    { var favouriteEventTitles = []; var savedLocations = []; var trainingDefaults = []; var rsvpCreatedAt = []; var matchCaptainAssignments = []; var matchGoalkeeperAssignments = [] }
  };
};
