// Adds the live match timer: one server-anchored timer per event (purely
// additive). Mirrors the Supabase pitch-timer-event payload shape (see
// frontend/src/lib/serverTimer.ts ServerTimer) but with canister-native
// Nat64 ms timestamps instead of ISO strings.
import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : {
    var eventTimers : [{
      event_id : Text;
      schema_version : Nat8;
      current_half : Nat8;
      minutes_per_half : Nat16;
      half_started_at_ms : ?Nat64;
      half_paused_at_ms : ?Nat64;
      accumulated_pause_ms : Nat64;
      is_running : Bool;
      is_game_finished : Bool;
      half_ended_at_ms : ?Nat64;
      last_event_at_ms : Nat64;
      updated_by : Principal;
    }];
  } {
    { var eventTimers = [] }
  };
};
