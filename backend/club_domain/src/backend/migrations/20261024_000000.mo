// Catch-up migration for state that was added by EDITING the already-applied
// 20261012_000000 / 20261013_000000 files (mainnet skipped those edits, so the
// upgrade was rejected as memory-incompatible). Those two files are restored
// to the content mainnet actually ran; this migration carries the edits:
//  - newsPosts gain target_mini_league_id / target_competition_id (null)
//  - inviteMessageDefaults, newsAudienceRecipients, teamWelcomeEmails (empty)
//  - miniLeagueDomainCanister, competitionDomainCanister (unset; deploy wires)
// Types are frozen inline — never reference the live Types module here.
import Array "mo:core/Array";
import Principal "mo:core/Principal";

module {
  type Attachment = { kind : Text; url : Text; name : Text; size : Nat64; mime_type : ?Text; anchor : ?Text };
  type OldNewsPost = {
    id : Text; club_id : Text; title : Text; body : Text; status : Text;
    created_by : Principal; created_at_ms : Nat64; updated_at_ms : Nat64;
    revision : Nat64; target_team_ids : ?[Text]; is_important : Bool;
    image_url : ?Text; attachments : [Attachment];
  };
  type NewsPost = {
    id : Text; club_id : Text; title : Text; body : Text; status : Text;
    created_by : Principal; created_at_ms : Nat64; updated_at_ms : Nat64;
    revision : Nat64; target_team_ids : ?[Text];
    target_mini_league_id : ?Text; target_competition_id : ?Text;
    is_important : Bool; image_url : ?Text; attachments : [Attachment];
  };
  type InviteMessageDefault = { club_id : Text; message : Text };
  type NewsAudienceRecipient = { news_id : Text; user : Principal };
  type TeamWelcomeEmail = { team_id : Text; club_id : Text; enabled : Bool; subject : Text; message : Text };

  public func migration(old : { var newsPosts : [OldNewsPost] }) : {
    var newsPosts : [NewsPost];
    var inviteMessageDefaults : [InviteMessageDefault];
    var newsAudienceRecipients : [NewsAudienceRecipient];
    var teamWelcomeEmails : [TeamWelcomeEmail];
    var miniLeagueDomainCanister : ?Principal;
    var competitionDomainCanister : ?Principal;
  } {
    {
      var newsPosts = Array.map<OldNewsPost, NewsPost>(old.newsPosts, func(p) {
        { p with target_mini_league_id = null; target_competition_id = null }
      });
      var inviteMessageDefaults = [];
      var newsAudienceRecipients = [];
      var teamWelcomeEmails = [];
      var miniLeagueDomainCanister = null;
      var competitionDomainCanister = null;
    }
  };
};
