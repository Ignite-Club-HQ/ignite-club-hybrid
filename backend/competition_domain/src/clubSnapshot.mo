import Principal "mo:core/Principal";
import Types "types";
import Welcome "welcomeSettings";
import ScorePrivacy "scorePrivacy";
import EmailOutbox "../../shared/EmailOutbox";
import FixtureOperations "fixtureOperations";
import BroadcastPlan "broadcastPlan";
import Text "mo:core/Text";
import Array "mo:core/Array";
module {
  public func duplicateKeys(keys : [Text]) : Bool {
    var seen : [Text] = [];
    for (key in keys.values()) { if (seen.any(func old = old == key)) return true; seen := seen.concat([key]) }; false
  };
  public type Delivery = { sender : Principal; competition : Text; divisions : [Text]; title : Text; body : Text; broadcast_id : Text; completed : [(Text, Nat16)]; unknown : ?Text };
  public type Recovery = { email_jobs : [(Text, EmailOutbox.Job)]; fixture_receipts : [(Text, FixtureOperations.Receipt)]; broadcast_deliveries : [(Text, Delivery)]; broadcast_plans : [(Text, [BroadcastPlan.Target])] };
  public type FenceSnapshot = { recovery : ?Recovery; playhq_links : ?[Types.PlayHQCompetitionLink]; playhq_metadata : ?[Types.PlayHQMatchMeta]; playhq_stats : ?[Types.PlayHQStat]; score_privacy : ?[ScorePrivacy.Setting]; competitions : [Types.Competition]; roles : [Types.RoleGrant]; entries : [Types.TeamEntry]; tokens : [Types.JoinToken]; seasons : [Types.Season]; matches : [Types.Match]; chat_settings : [Types.ChatSettings]; welcome : [Welcome.Settings]; invites : [Types.CompetitionInvite]; join_links : [Types.CompetitionJoinLink]; official_invites : [Types.CompetitionOfficialEmailInvite]; welcome_jobs : [Types.CompetitionWelcomeJob]; member_welcome_jobs : ?[Types.CompetitionMemberWelcomeJob]; eoi : [Types.EoiSubmission]; divisions : [Types.DivisionSetting]; ladders : [Types.CompetitionLadderSetting]; broadcasts : [Types.Broadcast]; owners : [(Text, Principal)]; role_links : [Types.RoleLink]; official_chats : [Types.OfficialChat] };
};
