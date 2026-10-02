import Principal "mo:core/Principal";
module {
  // Mirrors events_domain's role grant model so the same admin/coach
  // relationships (granted via the same governance flow) gate points and
  // reward administration here.
  public type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };

  // A points subject is either a member (user_id, Supabase profiles.id) or a
  // child (child_id, Supabase children.id) — mirrors the nullable
  // user_id/child_id pair on points_history / *_club_points / reward_redemptions.
  public type Subject = { #User : Text; #Child : Text };

  // Mirrors points_history (12 cols): id, user_id, child_id, club_id, amount,
  // balance_after, source_type, source_id, description, created_at,
  // created_by, season_id.
  public type PointsHistoryEntry = {
    id : Text;
    club_id : Text;
    user_id : ?Text;
    child_id : ?Text;
    amount : Int32;
    balance_after : Int32;
    source_type : Text;
    source_id : ?Text;
    description : Text;
    created_at_ms : Nat64;
    created_by : ?Principal;
    season_id : ?Text;
  };

  // Mirrors user_club_points (4 cols): user_id, club_id, points, updated_at.
  public type UserClubPoints = { user_id : Text; club_id : Text; points : Int32; updated_at_ms : Nat64 };

  // Mirrors child_club_points (4 cols): child_id, club_id, points, updated_at.
  public type ChildClubPoints = { child_id : Text; club_id : Text; points : Int32; updated_at_ms : Nat64 };

  // Mirrors club_rewards (15 cols): id, club_id, name, description,
  // points_required, is_default, is_active, logo_url, reward_type,
  // qr_code_url, show_qr_code, sponsor_id, created_at, updated_at, team_id.
  public type ClubReward = {
    id : Text;
    club_id : Text;
    name : Text;
    description : ?Text;
    points_required : Nat32;
    is_default : Bool;
    is_active : Bool;
    logo_url : ?Text;
    reward_type : Text;
    qr_code_url : ?Text;
    show_qr_code : Bool;
    sponsor_id : ?Text;
    created_at_ms : Nat64;
    updated_at_ms : Nat64;
    team_id : ?Text;
  };

  // Mirrors reward_redemptions (12 cols): id, reward_id, user_id, child_id,
  // points_spent, verified_by, verified_at, created_at, status, club_id,
  // redeemed_at, idempotency_key.
  public type RewardRedemption = {
    id : Text;
    reward_id : Text;
    club_id : Text;
    user_id : ?Text;
    child_id : ?Text;
    points_spent : Nat32;
    status : Text; // "pending" | "approved" | "fulfilled" | "cancelled"
    verified_by : ?Principal;
    verified_at_ms : ?Nat64;
    created_at_ms : Nat64;
    redeemed_at_ms : ?Nat64;
    idempotency_key : ?Text;
  };

  // Mirrors points_cooldowns (8 cols): id, user_id, action_type, scope_id,
  // awarded_date, points_awarded, club_id, created_at. Counterpart of the
  // Supabase try_insert_points_cooldown RPC: one row per (user, action_type,
  // scope_id, club, day) award, used to sum today's awarded points for that
  // action against a daily cap.
  public type PointsCooldown = {
    id : Text;
    user_id : Text;
    club_id : Text;
    action_type : Text;
    scope_id : Text;
    awarded_date : Text; // "YYYY-MM-DD" (UTC), mirrors Postgres `date`
    points_awarded : Nat32;
    created_at_ms : Nat64;
  };

  // Per-club points-module settings — mirrors the points columns on
  // club_subscriptions (disable_points_system) and clubs
  // (points_display_name). Absent row = system enabled, default name.
  public type ClubPointsSettings = {
    club_id : Text;
    display_name : ?Text;
    disabled : Bool;
    updated_at_ms : Nat64;
  };

  public type State = {
    var governor : Principal;
    var roles : [RoleGrant];
    var pointsHistory : [PointsHistoryEntry];
    var userClubPoints : [UserClubPoints];
    var childClubPoints : [ChildClubPoints];
    var clubRewards : [ClubReward];
    var redemptions : [RewardRedemption];
    var cooldowns : [PointsCooldown];
    var bulkAccessPrincipals : [Principal];
    var clubPointsSettings : [ClubPointsSettings];
  };
}
