import Array "mo:core/Array";
import Principal "mo:core/Principal";

module {
  type OldEvent = {
    id : Text;
    club_id : Text;
    team_id : ?Text;
    title : Text;
    description : Text;
    event_type : Text;
    location : ?Text;
    cancelled : Bool;
    creator : Principal;
    starts_at_ms : Nat64;
    ends_at_ms : Nat64;
    series_id : ?Text;
    revision : Nat64;
    deleted : Bool;
    opponent : ?Text;
    address : ?Text;
    mini_league_id : ?Text;
    updated_at_ms : Nat64;
  };
  type NewEvent = {
    id : Text;
    club_id : Text;
    team_id : ?Text;
    title : Text;
    description : Text;
    event_type : Text;
    location : ?Text;
    cancelled : Bool;
    creator : Principal;
    starts_at_ms : Nat64;
    ends_at_ms : Nat64;
    series_id : ?Text;
    revision : Nat64;
    deleted : Bool;
    opponent : ?Text;
    address : ?Text;
    mini_league_id : ?Text;
    updated_at_ms : Nat64;
    rsvp_audience : ?Text;
    adults_only : Bool;
    restricted_to_roles : ?[Text];
    target_team_ids : ?[Text];
  };
  type OldSeries = {
    id : Text;
    club_id : Text;
    team_id : ?Text;
    title : Text;
    description : Text;
    event_type : Text;
    location : ?Text;
    frequency : Text;
    first_starts_at_ms : Nat64;
    first_ends_at_ms : Nat64;
    until_ms : Nat64;
    creator : Principal;
    revision : Nat64;
    deleted : Bool;
  };
  type NewSeries = {
    id : Text;
    club_id : Text;
    team_id : ?Text;
    title : Text;
    description : Text;
    event_type : Text;
    location : ?Text;
    frequency : Text;
    first_starts_at_ms : Nat64;
    first_ends_at_ms : Nat64;
    until_ms : Nat64;
    creator : Principal;
    revision : Nat64;
    deleted : Bool;
    rsvp_audience : ?Text;
    adults_only : Bool;
    restricted_to_roles : ?[Text];
    target_team_ids : ?[Text];
  };
  type OldActor = { var events : [OldEvent]; var series : [OldSeries] };
  type NewActor = {
    var events : [NewEvent];
    var series : [NewSeries];
    var favouriteEventTitles : [{ account_id : Text; title : Text }];
    var savedLocations : [{ id : Text; account_id : Text; location_label : Text; address : Text; lat : Float; lng : Float; created_at_ms : Nat64 }];
    var trainingDefaults : [{ account_id : Text; club_id : Text; team_id : Text; child_id : ?Text; default_rsvp : Text; updated_at_ms : Nat64 }];
    var rsvpCreatedAt : [{ event_id : Text; account_id : Text; created_at_ms : Nat64 }];
    var matchCaptainAssignments : [{ event_id : Text; ref_kind : Text; ref_id : Text; role : Text; assigned_by : Principal; updated_at_ms : Nat64 }];
    var matchGoalkeeperAssignments : [{ event_id : Text; ref_kind : Text; ref_id : Text; period : Text; assigned_by : Principal; updated_at_ms : Nat64 }];
  };

  public func migration(old : OldActor) : NewActor {
    {
      var events = old.events.map<OldEvent, NewEvent>(func(event) {
        { event with rsvp_audience = null; adults_only = false; restricted_to_roles = null; target_team_ids = null }
      });
      var series = old.series.map<OldSeries, NewSeries>(func(item) {
        { item with rsvp_audience = null; adults_only = false; restricted_to_roles = null; target_team_ids = null }
      });
      var favouriteEventTitles = [];
      var savedLocations = [];
      var trainingDefaults = [];
      var rsvpCreatedAt = [];
      var matchCaptainAssignments = [];
      var matchGoalkeeperAssignments = [];
    }
  };
};
