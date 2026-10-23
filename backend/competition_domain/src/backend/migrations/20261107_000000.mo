import Principal "mo:core/Principal";
module {
  // Frozen inline (never Types.X): pending welcome emails self-registered by
  // existing members (e.g. after their team accepts a competition entry).
  type CompetitionMemberWelcomeJob = {
    token : Text;
    competition_id : Text;
    member : Principal;
    to : Text;
    created_at_ms : Nat64;
  };
  public func migration(_ : {}) : {
    var competitionMemberWelcomeJobs : [CompetitionMemberWelcomeJob];
  } {
    { var competitionMemberWelcomeJobs = [] }
  };
}
