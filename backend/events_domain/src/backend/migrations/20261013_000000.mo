module {
  type EventDutyTeam = { event_id : Text; team_id : Text };

  public func migration(_ : {}) : {
    var eventDutyTeams : [EventDutyTeam];
    var dutyTeamReminderSent : [Text];
    var pointsReminderSent : [Text];
    var individualDutyReminderSent : [Text];
  } {
    { var eventDutyTeams = []; var dutyTeamReminderSent = []; var pointsReminderSent = []; var individualDutyReminderSent = [] }
  };
};