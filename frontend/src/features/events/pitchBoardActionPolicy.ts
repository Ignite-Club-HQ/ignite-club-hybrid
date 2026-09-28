export type PitchBoardPrimaryAction = "prepare" | "start" | "open" | null;

export function resolvePitchBoardActions(input: {
  eventType: string;
  hasTeam: boolean;
  supportedSport: boolean;
  accessLoading: boolean;
  canAccess: boolean;
  membersLoading: boolean;
  hasTeamMembers: boolean;
  canViewReadOnly: boolean;
  eventTimeMs: number;
  nowMs: number;
}): { showLoading: boolean; primary: PitchBoardPrimaryAction; showReadOnly: boolean } {
  const eligibleGame = input.eventType === "game" && input.hasTeam && input.supportedSport;
  const showLoading = eligibleGame && (input.accessLoading || (input.canAccess && input.membersLoading));
  let primary: PitchBoardPrimaryAction = null;
  if (!input.accessLoading && input.canAccess && input.hasTeamMembers) {
    const minutesUntilKickoff = (input.eventTimeMs - input.nowMs) / 60_000;
    const hasStarted = minutesUntilKickoff <= 0;
    const isPastGame = hasStarted && minutesUntilKickoff < -180;
    if (!isPastGame) {
      primary = hasStarted ? "open" : minutesUntilKickoff <= 120 ? "start" : "prepare";
    }
  }
  return {
    showLoading,
    primary,
    showReadOnly: input.canViewReadOnly && input.hasTeamMembers,
  };
}
