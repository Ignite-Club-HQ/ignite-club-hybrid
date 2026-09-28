module {
  public type RoleGrant = { user : Principal; role : Text; club : ?Text; team : ?Text };
  public type Team = { id : Text; club : Text };
  public type Child = { id : Text; teams : [Text]; parent : ?Principal };
  public type Guardian = { child : Text; user : Principal };
  public type Exclusion = { club : Text; user : Principal };
  public type Acl = {
    teams : [Team];
    guardians : [Guardian];
    clubs : [Text];
    children : [Child];
    exclusions : [Exclusion];
    roles : [RoleGrant];
  };
  public type Config = {
    acl : Acl;
    schema : Nat32;
    governor : Principal;
    acl_version : Nat64;
  };
  public type Draft = {
    url : Text;
    title : Text;
    icon : Text;
    is_active : Bool;
    open_mode : Text;
    subtitle : ?Text;
  };
  public type Link = {
    id : Text;
    sort_order : Nat32;
    created_at_ms : Nat64;
    draft : Draft;
    club_id : Text;
  };
  public type Listing = { links : [Link]; revision : Nat64 };
  public type Mutation = { link : ?Link; revision : Nat64 };
  public type Operation = {
    #SetActive : { id : Text; active : Bool };
    #Save : { id : ?Text; draft : Draft };
    #Remove : { id : Text };
    #Reorder : { first : Text; second : Text };
  };
  public type Request = {
    request_id : Text;
    club : Text;
    operation : Operation;
    expected_revision : Nat64;
  };
  public type Snapshot = { schema : Nat32; clubs : [(Text, Listing)] };
  public type ClubProfile = {
    id : Text;
    secondary_color : ?Text;
    name : Text;
    slug : Text;
    description : ?Text;
    created_at_ms : Nat64;
    logo_url : ?Text;
    is_active : Bool;
    primary_color : ?Text;
  };
  public type ClubSettings = {
    contact_email : ?Text;
    membership_open : Bool;
    announcement : ?Text;
    public_directory : Bool;
    club_id : Text;
  };
  public type ClubSponsor = {
    id : Text;
    website_url : ?Text;
    name : Text;
    tier : Text;
    sort_order : Nat32;
    logo_url : ?Text;
    is_active : Bool;
    club_id : Text;
  };
  public type ClubTeam = {
    id : Text;
    name : Text;
    division : ?Text;
    gender : ?Text;
    is_active : Bool;
    club_id : Text;
    age_group : ?Text;
  };
  public type Account = { id : Text; legacy_subject : Principal; version : Nat64; principals : [Principal] };
  public type AccountExclusion = { account_id : Text; club : Text };
  public type AccountRole = { account_id : Text; club : ?Text; role : Text; team : ?Text };
  public type Challenge = { id : Nat64; account_id : Text; issuer : Principal; target : Principal; accepted : Bool; expires_at_ns : Nat64; expected_version : Nat64 };
  public type Family = { account_id : Text; child_id : Text };
  public type State = { schema : Nat32; accounts : [Account]; exclusions : [AccountExclusion]; families : [Family]; challenges : [Challenge]; roles : [AccountRole]; next_challenge : Nat64 };
}