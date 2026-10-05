// Adds scheduled ("auto") RSVP reminders: per-event hours-before setting
// plus a sent flag, swept by a recurring timer in main.mo.
module {
  public func migration(_ : {}) : {
    var autoReminders : [{ event_id : Text; hours_before : Nat16; sent : Bool }];
  } {
    { var autoReminders = [] }
  };
};
