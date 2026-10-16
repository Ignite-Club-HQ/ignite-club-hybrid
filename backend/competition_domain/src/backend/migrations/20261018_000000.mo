import Principal "mo:core/Principal";
module {
  // Adds caller-owned clubless ("personal") competitions. club_id = "" marks
  // a personal competition; personalCompetitionOwners maps its id to the
  // creator, who gets owner/admin rights (see canManageCompetition and
  // list_my_personal_competitions in main.mo). No prior rows to backfill.
  public func migration(_ : {}) : {
    var personalCompetitionOwners : [(Text, Principal)];
  } {
    { var personalCompetitionOwners = [] }
  };
};
