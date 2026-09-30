import Array "mo:core/Array";
import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club : ?Text; team : ?Text };
  type Team = { id : Text; club : Text };
  type Child = { id : Text; teams : [Text]; parent : ?Principal };
  type Guardian = { child : Text; user : Principal };
  type Exclusion = { club : Text; user : Principal };
  type Acl = {
    teams : [Team];
    guardians : [Guardian];
    clubs : [Text];
    children : [Child];
    exclusions : [Exclusion];
    roles : [RoleGrant];
  };
  type Draft = { url : Text; title : Text; icon : Text; is_active : Bool; open_mode : Text; subtitle : ?Text };
  type Link = { id : Text; sort_order : Nat32; created_at_ms : Nat64; draft : Draft; club_id : Text };
  type Listing = { links : [Link]; revision : Nat64 };
  type OldClubProfile = { id : Text; secondary_color : ?Text; name : Text; slug : Text; description : ?Text; created_at_ms : Nat64; logo_url : ?Text; is_active : Bool; primary_color : ?Text };
  type ClubProfile = { id : Text; secondary_color : ?Text; name : Text; slug : Text; description : ?Text; created_at_ms : Nat64; logo_url : ?Text; is_active : Bool; primary_color : ?Text; deleted_at_ms : ?Nat64 };
  type ClubSettings = { contact_email : ?Text; membership_open : Bool; announcement : ?Text; public_directory : Bool; club_id : Text };
  type ClubSponsor = { id : Text; website_url : ?Text; name : Text; tier : Text; sort_order : Nat32; logo_url : ?Text; is_active : Bool; club_id : Text; description : ?Text; is_team_only : Bool; exposure_percentage : ?Nat8 };
  type OldClubTeam = { id : Text; name : Text; division : ?Text; gender : ?Text; is_active : Bool; club_id : Text; age_group : ?Text; description : ?Text; logo_url : ?Text; team_type : ?Text };
  type ClubTeam = { id : Text; name : Text; division : ?Text; gender : ?Text; is_active : Bool; club_id : Text; age_group : ?Text; description : ?Text; logo_url : ?Text; team_type : ?Text; deleted_at_ms : ?Nat64 };
  type NewsPost = { id : Text; club_id : Text; title : Text; body : Text; status : Text; created_by : Principal; created_at_ms : Nat64; updated_at_ms : Nat64; revision : Nat64 };
  type ParentInvite = { id : Text; club_id : Text; team_id : ?Text; child_id : Text; invited_by : Principal; created_at_ms : Nat64; expires_at_ms : Nat64; accepted_by : ?Principal };
  type RoleRequest = { id : Text; account_id : Text; user : Principal; club : Text; role : Text; team : ?Text; status : Text; created_at_ms : Nat64; decided_at_ms : ?Nat64; decided_by : ?Principal };
  type TeamInvite = { id : Text; club_id : Text; team_id : Text; email : Text; role : Text; invited_by : Principal; created_at_ms : Nat64; expires_at_ms : Nat64; accepted_by : ?Principal; revoked : Bool };
  type Account = { id : Text; legacy_subject : Principal; version : Nat64; principals : [Principal] };
  type AccountExclusion = { account_id : Text; club : Text };
  type AccountRole = { account_id : Text; club : ?Text; role : Text; team : ?Text };
  type Challenge = { id : Nat64; account_id : Text; issuer : Principal; target : Principal; accepted : Bool; expires_at_ns : Nat64; expected_version : Nat64 };
  type Family = { account_id : Text; child_id : Text };
  type Mutation = { link : ?Link; revision : Nat64 };
  type OldActor = {
    var governor : Principal;
    var acl : Acl;
    var aclVersion : Nat64;
    var profiles : [OldClubProfile];
    var settings : [ClubSettings];
    var teams : [OldClubTeam];
    var sponsors : [ClubSponsor];
    var clubListings : [(Text, Listing)];
    var frozenClubs : [(Text, Nat64)];
    var accounts : [Account];
    var accountExclusions : [AccountExclusion];
    var accountFamilies : [Family];
    var accountChallenges : [Challenge];
    var accountRoles : [AccountRole];
    var nextChallengeId : Nat64;
    var mutationLog : [(Text, Text, Mutation)];
    var newsPosts : [NewsPost];
    var parentInvites : [ParentInvite];
  };
  type NewActor = {
    var governor : Principal;
    var acl : Acl;
    var aclVersion : Nat64;
    var profiles : [ClubProfile];
    var settings : [ClubSettings];
    var teams : [ClubTeam];
    var sponsors : [ClubSponsor];
    var clubListings : [(Text, Listing)];
    var frozenClubs : [(Text, Nat64)];
    var accounts : [Account];
    var accountExclusions : [AccountExclusion];
    var accountFamilies : [Family];
    var accountChallenges : [Challenge];
    var accountRoles : [AccountRole];
    var nextChallengeId : Nat64;
    var mutationLog : [(Text, Text, Mutation)];
    var newsPosts : [NewsPost];
    var parentInvites : [ParentInvite];
    var roleRequests : [RoleRequest];
    var teamInvites : [TeamInvite];
  };
  // Adds soft-delete markers to clubs/teams (deleted_at_ms, null = active)
  // and introduces the role-request and team-invite stores backing the
  // ManageRolesPage / ClubDetailPage / TeamDetailPage / JoinTeamPage /
  // CreateTeamPage ICP branches. Existing clubs/teams default to
  // deleted_at_ms = null (active), matching their current implicit state.
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var acl = old.acl;
      var aclVersion = old.aclVersion;
      var profiles = Array.map<OldClubProfile, ClubProfile>(old.profiles, func(p) {
        { p with deleted_at_ms = null }
      });
      var settings = old.settings;
      var teams = Array.map<OldClubTeam, ClubTeam>(old.teams, func(t) {
        { t with deleted_at_ms = null }
      });
      var sponsors = old.sponsors;
      var clubListings = old.clubListings;
      var frozenClubs = old.frozenClubs;
      var accounts = old.accounts;
      var accountExclusions = old.accountExclusions;
      var accountFamilies = old.accountFamilies;
      var accountChallenges = old.accountChallenges;
      var accountRoles = old.accountRoles;
      var nextChallengeId = old.nextChallengeId;
      var mutationLog = old.mutationLog;
      var newsPosts = old.newsPosts;
      var parentInvites = old.parentInvites;
      var roleRequests = [];
      var teamInvites = [];
    }
  };
};
