export type AppRole =
  | "basic_user"
  | "club_admin"
  | "team_admin"
  | "coach"
  | "player"
  | "parent"
  | "app_admin"
  | "committee_member"
  | "league_admin"
  | "association_admin"
  | "competition_admin";

export const roleLabels: Record<AppRole, string> = {
  basic_user: "Member",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
  committee_member: "Committee Member",
  league_admin: "League Admin",
  association_admin: "Association Admin",
  competition_admin: "Competition Admin",
};
