// Per-team welcome-email settings.
module {
  type TeamWelcomeEmail = { team_id : Text; club_id : Text; enabled : Bool; subject : Text; message : Text };
  public func migration(_ : {}) : {
    var teamWelcomeEmails : [TeamWelcomeEmail];
    var newsTargets : [(Text, Text, Text)];
  } {
    {
      var teamWelcomeEmails = [];
      var newsTargets = [];
    }
  };
};
