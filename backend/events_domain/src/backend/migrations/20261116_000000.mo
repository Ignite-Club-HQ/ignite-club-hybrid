module {
  // Match officials preservation: captain/goalkeeper/player-of-the-match
  // assignments per event. References only (claimed principal text or
  // migrated child id); private names stay in pii_access_control.
  type EventCaptain = { event_id : Text; team_id : Text; user_id : ?Text; child_id : ?Text };
  type EventGoalkeeper = { event_id : Text; team_id : Text; user_id : ?Text; child_id : ?Text };
  type EventPotm = { event_id : Text; team_id : ?Text; user_id : ?Text; child_id : ?Text };
  // Stat sidecar: assists and source-unit position minutes, correlated to a
  // GamePlayerStat row by (event_id, team_id, subject).
  type GamePlayerStatExtra = { event_id : Text; team_id : Text; user_id : ?Text; child_id : ?Text; assists : ?Nat16; position_minutes : ?[(Text, Nat16)] };
  public func migration(_ : {}) : {
    var eventCaptains : [EventCaptain];
    var eventGoalkeepers : [EventGoalkeeper];
    var eventPotm : [EventPotm];
    var gamePlayerStatExtras : [GamePlayerStatExtra];
  } {
    { var eventCaptains = []; var eventGoalkeepers = []; var eventPotm = []; var gamePlayerStatExtras = [] }
  };
}
