// Adds four independent, purely-additive stores (partial migration):
//  - favouriteEventTitles: per-caller shortlist of event titles for reuse
//    when creating events.
//  - savedLocations: per-caller saved addresses (label/address/lat/lng) for
//    the event location autocomplete.
//  - trainingDefaults: per (caller, club, team, child) default RSVP applied
//    to new training events in the UI.
//  - rsvpCreatedAt: first-RSVP timestamp per (event, account), preserved
//    across later status changes (set_rsvp/admin_upsert_rsvp only touch
//    updated_at_ms on the Rsvp record itself).
module {
  public func migration(_ : {}) : {
    var favouriteEventTitles : [{ account_id : Text; title : Text }];
    var savedLocations : [{ id : Text; account_id : Text; label : Text; address : Text; lat : Float; lng : Float; created_at_ms : Nat64 }];
    var trainingDefaults : [{ account_id : Text; club_id : Text; team_id : Text; child_id : ?Text; default_rsvp : Text; updated_at_ms : Nat64 }];
    var rsvpCreatedAt : [{ event_id : Text; account_id : Text; created_at_ms : Nat64 }];
  } {
    { var favouriteEventTitles = []; var savedLocations = []; var trainingDefaults = []; var rsvpCreatedAt = [] }
  };
};
