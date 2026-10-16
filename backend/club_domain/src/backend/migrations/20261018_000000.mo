import Principal "mo:core/Principal";
module {
  // Adds caller-owned clubless ("personal") teams, mirroring the personal
  // competitions migration on competition_domain. club_id = "" marks a
  // personal team; personalTeamOwners maps its id to the creator, who gets
  // the same edit rights a club_admin would have for that team (see
  // isAdmin/save_team and list_my_personal_teams in main.mo).
  public func migration(_ : {}) : {
    var personalTeamOwners : [(Text, Principal)];
  } {
    { var personalTeamOwners = [] }
  };
};
