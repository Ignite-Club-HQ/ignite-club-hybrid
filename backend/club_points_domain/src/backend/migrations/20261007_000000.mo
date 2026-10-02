import Principal "mo:core/Principal";
module {
  type RoleGrant = { user : Principal; role : Text; club_id : Text; team_id : ?Text };
  type Subject = { #User : Text; #Child : Text };
  type PointsHistoryEntry = {
    id : Text; club_id : Text; user_id : ?Text; child_id : ?Text; amount : Int32; balance_after : Int32;
    source_type : Text; source_id : ?Text; description : Text; created_at_ms : Nat64; created_by : ?Principal; season_id : ?Text;
  };
  type UserClubPoints = { user_id : Text; club_id : Text; points : Int32; updated_at_ms : Nat64 };
  type ChildClubPoints = { child_id : Text; club_id : Text; points : Int32; updated_at_ms : Nat64 };
  type ClubReward = {
    id : Text; club_id : Text; name : Text; description : ?Text; points_required : Nat32; is_default : Bool; is_active : Bool;
    logo_url : ?Text; reward_type : Text; qr_code_url : ?Text; show_qr_code : Bool; sponsor_id : ?Text;
    created_at_ms : Nat64; updated_at_ms : Nat64; team_id : ?Text;
  };
  type RewardRedemption = {
    id : Text; reward_id : Text; club_id : Text; user_id : ?Text; child_id : ?Text; points_spent : Nat32; status : Text;
    verified_by : ?Principal; verified_at_ms : ?Nat64; created_at_ms : Nat64; redeemed_at_ms : ?Nat64; idempotency_key : ?Text;
  };
  type PointsCooldown = {
    id : Text; user_id : Text; club_id : Text; action_type : Text; scope_id : Text; awarded_date : Text;
    points_awarded : Nat32; created_at_ms : Nat64;
  };
  type ClubPointsSettings = {
    club_id : Text; display_name : ?Text; disabled : Bool; updated_at_ms : Nat64;
  };
  type OldActor = {
    var governor : Principal;
    var roles : [RoleGrant];
    var pointsHistory : [PointsHistoryEntry];
    var userClubPoints : [UserClubPoints];
    var childClubPoints : [ChildClubPoints];
    var clubRewards : [ClubReward];
    var redemptions : [RewardRedemption];
    var cooldowns : [PointsCooldown];
    var bulkAccessPrincipals : [Principal];
  };
  type NewActor = {
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
  public func migration(old : OldActor) : NewActor {
    {
      var governor = old.governor;
      var roles = old.roles;
      var pointsHistory = old.pointsHistory;
      var userClubPoints = old.userClubPoints;
      var childClubPoints = old.childClubPoints;
      var clubRewards = old.clubRewards;
      var redemptions = old.redemptions;
      var cooldowns = old.cooldowns;
      var bulkAccessPrincipals = old.bulkAccessPrincipals;
      var clubPointsSettings = [];
    }
  };
};
