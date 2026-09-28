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
  type ClubProfile = { id : Text; secondary_color : ?Text; name : Text; slug : Text; description : ?Text; created_at_ms : Nat64; logo_url : ?Text; is_active : Bool; primary_color : ?Text };
  type ClubSettings = { contact_email : ?Text; membership_open : Bool; announcement : ?Text; public_directory : Bool; club_id : Text };
  type ClubSponsor = { id : Text; website_url : ?Text; name : Text; tier : Text; sort_order : Nat32; logo_url : ?Text; is_active : Bool; club_id : Text };
  type ClubTeam = { id : Text; name : Text; division : ?Text; gender : ?Text; is_active : Bool; club_id : Text; age_group : ?Text };
  type Account = { id : Text; legacy_subject : Principal; version : Nat64; principals : [Principal] };
  type AccountExclusion = { account_id : Text; club : Text };
  type AccountRole = { account_id : Text; club : ?Text; role : Text; team : ?Text };
  type Challenge = { id : Nat64; account_id : Text; issuer : Principal; target : Principal; accepted : Bool; expires_at_ns : Nat64; expected_version : Nat64 };
  type Family = { account_id : Text; child_id : Text };
  type Mutation = { link : ?Link; revision : Nat64 };
  type OldActor = {};
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
  };
  public func migration(_old : OldActor) : NewActor {
    {
      var governor = Principal.anonymous();
      var acl = { teams = []; guardians = []; clubs = []; children = []; exclusions = []; roles = [] };
      var aclVersion = 1;
      var profiles = [];
      var settings = [];
      var teams = [];
      var sponsors = [];
      var clubListings = [];
      var frozenClubs = [];
      var accounts = [];
      var accountExclusions = [];
      var accountFamilies = [];
      var accountChallenges = [];
      var accountRoles = [];
      var nextChallengeId = 1;
      var mutationLog = [];
    }
  };
};