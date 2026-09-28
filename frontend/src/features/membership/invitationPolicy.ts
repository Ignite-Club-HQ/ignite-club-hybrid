export type TeamRole = "player" | "parent" | "coach" | "team_admin";

export type TeamType = "junior" | "senior" | "mixed";

export interface TeamRoleOption {
  value: TeamRole;
  label: string;
  description: string;
  color: string;
  icon?: string;
  juniorOnly?: boolean;
  seniorOnly?: boolean;
}

const TEAM_ROLE_OPTIONS: readonly TeamRoleOption[] = [
  {
    value: "parent",
    label: "Parent",
    description: "Add parent + child players",
    color: "bg-pink-500/20 text-pink-600 border-pink-500/30",
    icon: "👶",
    juniorOnly: true,
  },
  {
    value: "player",
    label: "Adult Player",
    description: "18+ team player",
    color: "bg-amber-500/20 text-amber-600 border-amber-500/30",
    seniorOnly: true,
  },
  {
    value: "coach",
    label: "Coach",
    description: "Team coach",
    color: "bg-emerald-500/20 text-emerald-600 border-emerald-500/30",
  },
  {
    value: "team_admin",
    label: "Team Admin",
    description: "Full admin access",
    color: "bg-blue-500/20 text-blue-600 border-blue-500/30",
  },
];

export function getTeamRoleOptions(teamType: TeamType): TeamRoleOption[] {
  return TEAM_ROLE_OPTIONS.filter((option) => {
    if (teamType === "junior") return !option.seniorOnly;
    if (teamType === "senior") return !option.juniorOnly;
    return true;
  });
}

export function getDefaultTeamRole(teamType: TeamType): TeamRole {
  return teamType === "junior" ? "parent" : "player";
}

export function getTeamRoleLabel(
  role: TeamRole,
  options: readonly TeamRoleOption[],
): string {
  return options.find((option) => option.value === role)?.label ?? role;
}

export function findExistingMemberByName<
  TMember extends { display_name?: string | null },
>(name: string, members: readonly TMember[]): TMember | null {
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName.length < 3) return null;

  return (
    members.find(
      (member) => member.display_name?.toLowerCase() === normalizedName,
    ) ?? null
  );
}

export type ConfirmedChildMatch<TChild> = TChild & { isPending: false };

export function findMatchingInvitationChildren<
  TConfirmedChild extends { name: string },
  TPendingChild extends { name: string },
>(
  name: string,
  confirmedChildren: readonly TConfirmedChild[],
  pendingChildren: readonly TPendingChild[],
): Array<ConfirmedChildMatch<TConfirmedChild> | TPendingChild> {
  const normalizedName = name.trim().toLowerCase();
  if (normalizedName.length < 2) return [];

  const confirmedMatches = confirmedChildren
    .filter((child) => child.name.toLowerCase().includes(normalizedName))
    .map((child) => ({ ...child, isPending: false as const }));
  const confirmedNames = new Set(
    confirmedMatches.map((child) => child.name.toLowerCase()),
  );
  const pendingMatches = pendingChildren.filter(
    (child) =>
      child.name.toLowerCase().includes(normalizedName) &&
      !confirmedNames.has(child.name.toLowerCase()),
  );

  return [...confirmedMatches, ...pendingMatches].slice(0, 5);
}
