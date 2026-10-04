module {
  public type RoleGrant = { user : Principal; role : Text; club : ?Text; team : ?Text };
  public type Team = { id : Text; club : Text };
  public type Child = { id : Text; teams : [Text]; parent : ?Principal; club_id : ?Text };
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
    // PlayHQ integration config mirroring the Supabase `clubs.playhq_*`
    // columns; null means the club has no PlayHQ connection.
    playhq_tenant : ?Text;
    playhq_org_id : ?Text;
    // Sport this club plays, mirroring the Supabase `clubs.sport` column.
    // null means not yet set.
    sport : ?Text;
  };
  // Compact branding read for invite/email surfaces — the canister
  // counterpart of selecting name/logo_url/contact_email off the clubs row.
  public type ClubBranding = {
    name : Text;
    logo_url : ?Text;
    contact_email : ?Text;
  };
  // A club term (class/season enrolment period) — the canister counterpart
  // of the Supabase `terms` table. Dates are ISO yyyy-mm-dd text, matching
  // the Postgres date columns. status is "active" | "archived" |
  // "completed"; is_active mirrors the boolean column (true only when
  // status is "active").
  public type ClubTerm = {
    id : Text;
    club_id : Text;
    name : Text;
    start_date : Text;
    end_date : Text;
    is_active : Bool;
    status : Text;
    created_at_ms : Nat64;
  };
  // Manual "mark paid" bookkeeping for member subscription/uniform fees —
  // mirrors the Supabase member_subscription_payments table. Bookkeeping
  // only: no money moves through the canister (online payments stay
  // Stripe/Supabase-gated per the payments rule). user_id is the member's
  // account/principal text; child_id is set when the fee is per-child.
  public type MemberPayment = {
    id : Text;
    club_id : Text;
    user_id : Text;
    child_id : ?Text;
    payment_period : Text;
    payment_type : Text;
    amount : Float;
    notes : ?Text;
    marked_by : Principal;
    created_at_ms : Nat64;
  };
  // Sponsor-strip display toggles mirror the Supabase `clubs` columns of
  // the same name: whether the media gallery strip, the media header
  // strip, the events page strip, and in-chat-thread ad slots show
  // sponsors for this club. Defaults to false for clubs that predate
  // these fields, matching the Supabase column defaults.
  public type ClubSettings = {
    contact_email : ?Text;
    membership_open : Bool;
    announcement : ?Text;
    public_directory : Bool;
    club_id : Text;
    media_sponsors_enabled : Bool;
    media_header_sponsors_enabled : Bool;
    events_sponsor_strip_enabled : Bool;
    chat_thread_ads_enabled : Bool;
    theme_primary_color : ?Text;
    theme_secondary_color : ?Text;
    theme_accent_color : ?Text;
    header_logo_enabled : Bool;
    header_club_name_enabled : Bool;
    invite_email_style : ?Text;
    club_switcher_hint : ?Text;
    theme_enabled : Bool;
    logo_only_mode : Bool;
    theme_dark_primary_color : ?Text;
    theme_dark_secondary_color : ?Text;
    theme_dark_accent_color : ?Text;
  };

  // Per-club subscription/plan status, mirroring the Supabase
  // `club_subscriptions` row. Written only by the governor or an app_admin
  // (billing state is platform-managed, never club-admin editable).
  public type ClubSubscription = {
    club_id : Text;
    is_pro : Bool;
    is_pro_football : Bool;
    admin_pro_override : Bool;
    admin_pro_football_override : Bool;
    expires_at_ms : ?Nat64;
    plan : Text;
    team_limit : ?Nat32;
    trial_ends_at_ms : ?Nat64;
    is_trial : Bool;
    cancelled_at_ms : ?Nat64;
    activated_at_ms : ?Nat64;
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
  // Mirrors the Supabase team_sponsor_allocations table: which sponsors a
  // team displays under its own name in the sponsor strips (as opposed to
  // the club-level rotation). The club scope is derived from the sponsor.
  public type TeamSponsorAllocation = {
    sponsor_id : Text;
    team_id : Text;
  };
  // Mirrors the Supabase team_folders table: club-admin-managed groupings
  // for the club's teams list. Website-safe metadata only (name,
  // description, color) — reads are unauthenticated like list_teams.
  public type TeamFolder = {
    id : Text;
    club_id : Text;
    name : Text;
    description : ?Text;
    color : Text;
    sort_order : Nat32;
    created_by : Principal;
    created_at_ms : Nat64;
  };
  // Shell-team fields mirror the Supabase `teams.shell_*` columns: a
  // club admin can pre-create a "shell" team for a coach/manager who has
  // not signed up yet, mint a claim token, and the invited person claims
  // it (becoming team_admin) via `claim_shell_team`.
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
    is_shell : Bool;
    shell_claim_token : ?Text;
    shell_claimed_at_ms : ?Nat64;
    shell_claimed_by : ?Principal;
    shell_contact_email : ?Text;
    shell_contact_name : ?Text;
    shell_invited_by : ?Principal;
    archived : Bool;
    // PlayHQ link fields mirroring the Supabase `teams.playhq_*` columns:
    // which PlayHQ competition/team this team mirrors, and whether fixture
    // sync auto-creates match events. null/false means unlinked.
    playhq_team_id : ?Text;
    playhq_competition_id : ?Text;
    playhq_auto_create_events : Bool;
    // Team-folder grouping mirroring the Supabase `teams.folder_id` column;
    // null means the team is unfiled.
    folder_id : ?Text;
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
  // ---- Catalog of membership/club shapes added for the central canister
  // pass (roadmap step 2 NEEDS-CANISTER list). Email/push delivery stays
  // with a server job; these records store state + the payload a job
  // would send. ----

  // Shareable team-invite link: a single rotating token any holder can
  // redeem (role fixed at creation), distinct from the per-email
  // TeamInvite above. rotate replaces the token and keeps the record;
  // revoke disables redemption without deleting history.
  public type TeamInviteLink = {
    id : Text;
    club_id : Text;
    team_id : Text;
    role : Text;
    token : Text;
    created_by : Principal;
    created_at_ms : Nat64;
    rotated_at_ms : ?Nat64;
    revoked : Bool;
  };

  // Generalized pending invite covering team/club/guardian flows. `kind`
  // is "team" | "club" | "guardian". `payload` is the notification a
  // server job would send on create/resend (subject/body), returned to
  // the caller instead of actually emailing.
  public type InvitePayload = { to : Text; subject : Text; body : Text };
  public type PendingInvite = {
    id : Text;
    kind : Text;
    club_id : Text;
    team_id : ?Text;
    child_id : ?Text;
    email : Text;
    role : ?Text;
    invited_by : Principal;
    created_at_ms : Nat64;
    status : Text; // "pending" | "resent" | "revoked" | "accepted"
    resent_at_ms : ?Nat64;
    // Set when accept_pending_invite succeeds — backs the engagement
    // analytics "new members" / invite-acceptance surfaces.
    accepted_at_ms : ?Nat64;
    accepted_by : ?Principal;
  };

  // Compact accepted-invite view for engagement analytics —
  // invited_user_id is the accepting principal's text, "" when unaccepted
  // (should not occur for rows this query returns).
  public type AcceptedInvite = {
    id : Text;
    invited_user_id : Text;
    accepted_at_ms : Nat64;
  };

  public type InviteStats = { total : Nat; accepted : Nat };

  // A club season (draft|active|closed|archived) — distinct from ClubTerm
  // (enrolment "terms": active|archived|completed). Seasons group teams and
  // a club's "current" season is the one with status "active".
  public type Season = {
    id : Text;
    club_id : Text;
    name : Text;
    status : Text; // "draft" | "active" | "closed" | "archived"
    start_date : Text;
    end_date : Text;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
  };

  // profile_team_history join result — the canister counterpart of the
  // Supabase `profile_team_history` RPC. season_* fields are "" when no
  // active season matches the team's club (no fabricated season). joined_at_ms
  // is 0 when no membership timestamp exists (AccountRole grants carry no
  // join date) — honest placeholder, not fabricated.
  public type ProfileTeamHistoryEntry = {
    membership_id : Text;
    team_id : Text;
    team_name : Text;
    team_level_age : ?Text;
    club_id : Text;
    club_name : Text;
    season_id : Text;
    season_name : Text;
    season_status : Text;
    season_start_date : Text;
    season_end_date : Text;
    joined_at_ms : Nat64;
  };

  // A member's request to open a new team under a club, awaiting admin
  // approval (distinct from role_requests which request a role on an
  // existing team).
  public type TeamCreationRequest = {
    id : Text;
    club_id : Text;
    name : Text;
    division : ?Text;
    age_group : ?Text;
    requested_by : Principal;
    status : Text; // "pending" | "approved" | "rejected"
    created_at_ms : Nat64;
    decided_at_ms : ?Nat64;
    decided_by : ?Principal;
    team_id : ?Text;
  };

  // Per-team roster position assignment. member_id is a Principal-text or
  // child id (free-form, matching the account-id-is-text convention).
  public type TeamPlayerPosition = { team_id : Text; member_id : Text; position : Text };

  public type TeamCaptain = { team_id : Text; user : Principal };

  public type RemovedMember = { club : Text; user : Principal; removed_at_ms : Nat64; removed_by : Principal };
  public type ClubJoinRequest = {
    id : Text;
    club_id : Text;
    user : Principal;
    status : Text; // "pending" | "approved" | "rejected"
    created_at_ms : Nat64;
    decided_at_ms : ?Nat64;
    decided_by : ?Principal;
  };

  // Season analytics — canister counterpart of the Supabase
  // season_team_summary / season_player_stats RPCs. Precomputed per
  // season+team (analytics are not derivable from existing stores since
  // club_domain has no events/attendance data model), kept fresh via
  // admin-gated save calls.
  public type SeasonTeamSummary = {
    season_id : Text;
    club_id : Text;
    team_id : Text;
    team_name : Text;
    events_count : Nat32;
    avg_attendance_pct : Float;
    roster_size : Nat32;
    updated_at_ms : Nat64;
  };

  public type SeasonPlayerStat = {
    season_id : Text;
    club_id : Text;
    team_id : Text;
    club_player_id : Text;
    player_name : Text;
    events_total : Nat32;
    events_attended : Nat32;
    attendance_pct : Float;
    games_played : Nat32;
    updated_at_ms : Nat64;
  };
}
