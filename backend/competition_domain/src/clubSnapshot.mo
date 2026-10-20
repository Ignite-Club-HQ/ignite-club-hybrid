import Principal "mo:core/Principal";
import Types "types";
import Welcome "welcomeSettings";
import ScorePrivacy "scorePrivacy";
module {
  public type FenceSnapshot = { playhq_metadata : ?[Types.PlayHQMatchMeta]; playhq_stats : ?[Types.PlayHQStat]; score_privacy : ?[ScorePrivacy.Setting]; competitions : [Types.Competition]; roles : [Types.RoleGrant]; entries : [Types.TeamEntry]; tokens : [Types.JoinToken]; seasons : [Types.Season]; matches : [Types.Match]; chat_settings : [Types.ChatSettings]; welcome : [Welcome.Settings]; invites : [Types.CompetitionInvite]; join_links : [Types.CompetitionJoinLink]; official_invites : [Types.CompetitionOfficialEmailInvite]; welcome_jobs : [Types.CompetitionWelcomeJob]; eoi : [Types.EoiSubmission]; divisions : [Types.DivisionSetting]; ladders : [Types.CompetitionLadderSetting]; broadcasts : [Types.Broadcast]; owners : [(Text, Principal)]; role_links : [Types.RoleLink]; official_chats : [Types.OfficialChat] };
};
