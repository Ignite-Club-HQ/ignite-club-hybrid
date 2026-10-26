module {
  // Match officials preservation: captain/goalkeeper/player-of-the-match
  // assignments per event. References only (claimed principal text or
  // migrated child id); private names stay in pii_access_control.
  type EventCaptain = { event_id : Text; team_id : Text; user_id : ?Text; child_id : ?Text };
  type EventGoalkeeper = { event_id : Text; team_id : Text; user_id : ?Text; child_id : ?Text };
  type EventPotm = { event_id : Text; team_id : ?Text; user_id : ?Text; child_id : ?Text };
  public func migration(_ : {}) : {
    var eventCaptains : [EventCaptain];
    var eventGoalkeepers : [EventGoalkeeper];
    var eventPotm : [EventPotm];
  } {
    { var eventCaptains = []; var eventGoalkeepers = []; var eventPotm = [] }
  };
}
