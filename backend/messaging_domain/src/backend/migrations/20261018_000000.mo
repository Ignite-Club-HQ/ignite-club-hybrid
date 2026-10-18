module {
  public func migration(_ : {}) : {
    var chatPhotoReminderSettings : { enabled : Bool; window_start_hours : Nat32; window_end_hours : Nat32; cooldown_days : Nat32 }
  } {
    { var chatPhotoReminderSettings = { enabled = true; window_start_hours = 24; window_end_hours = 48; cooldown_days = 7 } }
  };
};