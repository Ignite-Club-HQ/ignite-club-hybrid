module {
  type WelcomeJob = { token : Text; competition_id : Text; to : Text; created_at_ms : Nat64 };
  // Adds pending competition welcome-email jobs keyed by the official email
  // invite token. No prior rows to backfill.
  public func migration(_ : {}) : { var competitionWelcomeJobs : [WelcomeJob] } {
    { var competitionWelcomeJobs = [] }
  };
};
