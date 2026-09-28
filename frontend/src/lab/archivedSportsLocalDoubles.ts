export type LocalPlayer = {
  id: string;
  minutesPlayed: number;
  position: string | null;
  preferredPositions?: readonly string[];
  unavailable?: boolean;
  lastBenchedAt?: number | null;
};

export type LocalSubstitution = {
  period: number;
  time: number;
  playerOutId: string;
  playerInId: string;
  executed?: boolean;
  skipped?: boolean;
};

export function findDueSubstitution(
  substitutions: readonly LocalSubstitution[],
  period: number,
  elapsed: number,
) {
  return substitutions.find(
    (substitution) =>
      substitution.period === period
      && substitution.time <= elapsed
      && !substitution.executed
      && !substitution.skipped,
  );
}

export function pickFairBenchPlayer(
  position: string,
  players: readonly LocalPlayer[],
  compatible: (preferred: string, target: string) => boolean = (preferred, target) =>
    preferred === target,
) {
  return players
    .filter((player) => !player.unavailable)
    .map((player) => {
      const preferences = player.preferredPositions ?? [];
      const fit = preferences.includes(position)
        ? 0
        : preferences.some((preferred) => compatible(preferred, position))
          ? 1
          : preferences.length === 0
            ? 2
            : 3;
      return { player, fit };
    })
    .filter(({ fit }) => fit < 3)
    .sort((left, right) =>
      left.fit - right.fit
      || left.player.minutesPlayed - right.player.minutesPlayed
      || left.player.id.localeCompare(right.player.id))[0]?.player;
}

export function applyLocalLineup(
  players: readonly LocalPlayer[],
  assignments: Readonly<Record<string, string>>,
  now: number,
) {
  const positions = new Map(Object.entries(assignments).map(([position, id]) => [id, position]));
  return players.map((player) => {
    const nextPosition = positions.get(player.id) ?? null;
    return {
      ...player,
      position: nextPosition,
      lastBenchedAt: player.position !== null && nextPosition === null
        ? now
        : nextPosition !== null
          ? null
          : player.lastBenchedAt,
    };
  });
}

export function createSpectatorSessionLock() {
  let sessionId: string | null = null;
  let rowId: string | null = null;

  return {
    observe(update: { sessionId?: string; rowId: string; active: boolean }) {
      if (!update.active) {
        if (update.sessionId === sessionId) {
          sessionId = null;
          rowId = null;
        }
        return null;
      }
      if (sessionId === null) {
        if (!update.sessionId) return null;
        sessionId = update.sessionId;
      }
      if (update.sessionId !== sessionId) return null;
      rowId = update.rowId;
      return { sessionId, rowId };
    },
    current() {
      return sessionId && rowId ? { sessionId, rowId } : null;
    },
  };
}
