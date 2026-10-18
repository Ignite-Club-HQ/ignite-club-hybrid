// Catch-up migration for the event/series fields that were added by EDITING
// the already-applied 20261015_000000 (mainnet skipped that edit, so the
// upgrade was rejected as memory-incompatible). 20261015 is restored to the
// content mainnet actually ran; this step adds rsvp_audience, adults_only,
// restricted_to_roles and target_team_ids with neutral defaults. The two
// out-of-order steps that followed (formerly 20261013/20261014) now run as
// 20261024/20261025. Types are frozen inline — never reference live Types.
import Array "mo:core/Array";
import Principal "mo:core/Principal";

module {
  type OldEvent = {
    id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text;
    event_type : Text; location : ?Text; cancelled : Bool; creator : Principal;
    starts_at_ms : Nat64; ends_at_ms : Nat64; series_id : ?Text; revision : Nat64;
    deleted : Bool; opponent : ?Text; address : ?Text; mini_league_id : ?Text;
    updated_at_ms : Nat64;
  };
  type NewEvent = {
    id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text;
    event_type : Text; location : ?Text; cancelled : Bool; creator : Principal;
    starts_at_ms : Nat64; ends_at_ms : Nat64; series_id : ?Text; revision : Nat64;
    deleted : Bool; opponent : ?Text; address : ?Text; mini_league_id : ?Text;
    updated_at_ms : Nat64;
    rsvp_audience : ?Text; adults_only : Bool; restricted_to_roles : ?[Text]; target_team_ids : ?[Text];
  };
  type OldSeries = {
    id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text;
    event_type : Text; location : ?Text; frequency : Text; first_starts_at_ms : Nat64;
    first_ends_at_ms : Nat64; until_ms : Nat64; creator : Principal; revision : Nat64;
    deleted : Bool;
  };
  type NewSeries = {
    id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text;
    event_type : Text; location : ?Text; frequency : Text; first_starts_at_ms : Nat64;
    first_ends_at_ms : Nat64; until_ms : Nat64; creator : Principal; revision : Nat64;
    deleted : Bool;
    rsvp_audience : ?Text; adults_only : Bool; restricted_to_roles : ?[Text]; target_team_ids : ?[Text];
  };

  public func migration(old : { var events : [OldEvent]; var series : [OldSeries] }) : {
    var events : [NewEvent];
    var series : [NewSeries];
  } {
    {
      var events = Array.map<OldEvent, NewEvent>(old.events, func(e) {
        { e with rsvp_audience = null; adults_only = false; restricted_to_roles = null; target_team_ids = null }
      });
      var series = Array.map<OldSeries, NewSeries>(old.series, func(s) {
        { s with rsvp_audience = null; adults_only = false; restricted_to_roles = null; target_team_ids = null }
      });
    }
  };
};
