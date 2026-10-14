import Principal "mo:core/Principal";
import Array "mo:core/Array";
module {
  type InviteMessageDefault = { club_id : Text; message : Text };
  type NewsAudienceRecipient = { news_id : Text; user : Principal };
  type OldNewsPost = {
    id : Text;
    club_id : Text;
    title : Text;
    body : Text;
    status : Text;
    created_by : Principal;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
    revision : Nat64;
    target_team_ids : ?[Text];
    is_important : Bool;
    image_url : ?Text;
    attachments : [{ kind : Text; url : Text; name : Text; size : Nat64; mime_type : ?Text; anchor : ?Text }];
  };
  type NewsPost = {
    id : Text;
    club_id : Text;
    title : Text;
    body : Text;
    status : Text;
    created_by : Principal;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
    revision : Nat64;
    target_team_ids : ?[Text];
    target_mini_league_id : ?Text;
    target_competition_id : ?Text;
    is_important : Bool;
    image_url : ?Text;
    attachments : [{ kind : Text; url : Text; name : Text; size : Nat64; mime_type : ?Text; anchor : ?Text }];
  };
  type OldActor = { var newsPosts : [OldNewsPost] };
  type NewActor = {
    var newsPosts : [NewsPost];
    var inviteMessageDefaults : [InviteMessageDefault];
    var miniLeagueDomainCanister : ?Principal;
    var newsAudienceRecipients : [NewsAudienceRecipient];
    var competitionDomainCanister : ?Principal;
  };

  public func migration(old : OldActor) : NewActor {
    {
      var newsPosts = old.newsPosts.map(func(post : OldNewsPost) : NewsPost {
        { post with target_mini_league_id = null; target_competition_id = null }
      });
      var inviteMessageDefaults = [];
      var miniLeagueDomainCanister = null;
      var newsAudienceRecipients = [];
      var competitionDomainCanister = null;
    }
  };
};