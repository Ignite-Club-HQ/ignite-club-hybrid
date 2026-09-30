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
    // Soft-delete marker mirroring the Supabase `clubs.deleted_at` column;
    // null means active. Permanent delete removes the record outright.
    deleted_at_ms : ?Nat64;
  };
  public type ClubSettings = {
    contact_email : ?Text;
    membership_open : Bool;
    announcement : ?Text;
    public_directory : Bool;
    club_id : Text;
  };
  // is_team_only mirrors the Supabase "team sponsors only" strip toggle;
  // exposure_percentage is the strip rotation share (0-100).
  public type ClubSponsor = {
    id : Text;
    website_url : ?Text;
    name : Text;
    tier : Text;
    sort_order : Nat32;
    logo_url : ?Text;
    is_active : Bool;
    club_id : Text;
    description : ?Text;
    is_team_only : Bool;
    exposure_percentage : ?Nat8;
  };
  public type ClubTeam = {
    id : Text;
    name : Text;
    division : ?Text;
    gender : ?Text;
    is_active : Bool;
    club_id : Text;
    age_group : ?Text;
    description : ?Text;
    logo_url : ?Text;
    team_type : ?Text;
    // Soft-delete marker mirroring the Supabase `teams.deleted_at` column.
    deleted_at_ms : ?Nat64;
  };
  // Rich news posts replace the single announcement string on ClubSettings
  // for the news feed. status is "draft" or "published"; members only ever
  // see published posts.
  public type NewsPost = {
    id : Text;
    club_id : Text;
    title : Text;
    body : Text;
    status : Text;
    created_by : Principal;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
    revision : Nat64;
  };
  // A parent invite links a second parent/guardian to a child (and
  // optionally a team) in one atomic accept — the canister equivalent of
  // the Supabase parent-invite RPCs. id doubles as the share token.
  public type ParentInvite = {
    id : Text;
    club_id : Text;
    team_id : ?Text;
    child_id : Text;
    invited_by : Principal;
    created_at_ms : Nat64;
    expires_at_ms : Nat64;
    accepted_by : ?Principal;
  };
  // A member's own request for a role, awaiting admin approval — the
  // canister equivalent of the Supabase `role_requests` table. account_id
  // is best-effort: the linked account id when the caller has one, else a
  // `principal:<text>` fallback (provisional, matching the account-id=
  // principal-text stance used elsewhere until every caller has a linked
  // account).
  public type RoleRequest = {
    id : Text;
    account_id : Text;
    user : Principal;
    club : Text;
    role : Text;
    team : ?Text;
    status : Text; // "pending" | "approved" | "rejected"
    created_at_ms : Nat64;
    decided_at_ms : ?Nat64;
    decided_by : ?Principal;
  };
  // A club/team admin's invite for a specific email to join a team with a
  // given role — the canister equivalent of the Supabase `team_invites`
  // table. Email delivery itself stays with Supabase; this only stores the
  // invite record and its accept/revoke state.
  public type TeamInvite = {
    id : Text;
    club_id : Text;
    team_id : Text;
    email : Text;
    role : Text;
    invited_by : Principal;
    created_at_ms : Nat64;
    expires_at_ms : Nat64;
    accepted_by : ?Principal;
    revoked : Bool;
  };
  public type Account = { id : Text; legacy_subject : Principal; version : Nat64; principals : [Principal] };
  public type AccountExclusion = { account_id : Text; club : Text };
  public type AccountRole = { account_id : Text; club : ?Text; role : Text; team : ?Text };
  public type Challenge = { id : Nat64; account_id : Text; issuer : Principal; target : Principal; accepted : Bool; expires_at_ns : Nat64; expected_version : Nat64 };
  public type Family = { account_id : Text; child_id : Text };
  public type State = { schema : Nat32; accounts : [Account]; exclusions : [AccountExclusion]; families : [Family]; challenges : [Challenge]; roles : [AccountRole]; next_challenge : Nat64 };
}