// Adds: pending-invite labels, season EOI config blobs, season team
// assignments (draft membership per season), a club association/kind flag,
// class/term enrolment records, per-club theme JSON blobs, and per-club
// general settings (class mode, guest defaults, sponsor strip toggle).
// Stored as separate arrays/maps so existing records — and every migration
// that mentions them — stay untouched.
import Types "../../types";

module {
  public type SeasonTeamAssignment = { season_id : Text; team_id : Text; member_id : Text; added_at_ms : Nat64 };
  public type ClassEnrolment = { id : Text; club_id : Text; term_id : Text; class_id : Text; member_id : Text; status : Text; created_at_ms : Nat64; updated_at_ms : Nat64 };
  public func migration(_ : {}) : {
    var pendingInviteLabels : [(Text, Text)];
    var seasonEoiConfig : [(Text, Text)];
    var seasonTeamAssignments : [SeasonTeamAssignment];
    var clubKinds : [(Text, Text)];
    var classEnrolments : [ClassEnrolment];
    var clubThemeJson : [(Text, Text)];
    var guardianMeta : [Types.GuardianMeta];
    var teamPlayerPositionAssignments : [Types.TeamPlayerPositionAssignment];
    var pendingInviteEmailHashes : [Types.PendingInviteEmailHash];
    var clubGeneralSettings : [Types.ClubGeneralSettings];
  } {
    {
      var pendingInviteLabels = [];
      var seasonEoiConfig = [];
      var seasonTeamAssignments = [];
      var clubKinds = [];
      var classEnrolments = [];
      var clubThemeJson = [];
      var guardianMeta = [];
      var teamPlayerPositionAssignments = [];
      var pendingInviteEmailHashes = [];
      var clubGeneralSettings = [];
    }
  };
};
