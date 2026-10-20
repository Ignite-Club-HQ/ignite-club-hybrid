import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : {
    var playhqMatchMetadata : [{ match_id : Text; competition_id : Text; tenant : Text; grade_id : Text; game_id : Text; home_id : Text; away_id : Text; home_name : Text; away_name : Text; synced_revision : Nat64 }];
    var playhqStats : [{ competition_id : Text; match_id : Text; tenant : Text; game_id : Text; team_id : Text; player_id : Text; player_name : Text; stats_json : Text }];
    var playhqClaims : [{ tenant : Text; player_id : Text; user : Principal }]
  } {
    { var playhqMatchMetadata = []; var playhqStats = []; var playhqClaims = [] }
  };
}