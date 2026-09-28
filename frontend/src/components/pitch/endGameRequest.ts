/**
 * Manual "End game & save stats" bridge.
 *
 * The finish dialog (and the whole save/finalisation path) lives in
 * `GlobalSubMonitor`, which is mounted app-wide. The pitch board itself only
 * needs to *request* finalisation, so we use a window event rather than
 * duplicating the save workflow inside the board.
 *
 * Coaches routinely pause the timer or close the app before full time, so this
 * request must work at ANY timer state — it never checks the clock.
 */
export const END_GAME_REQUEST_EVENT = "ignite:pitch-end-game-request";

export interface EndGameRequestDetail {
  teamId?: string | null;
}

export function requestEndGameAndSave(teamId?: string | null) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(
    new CustomEvent<EndGameRequestDetail>(END_GAME_REQUEST_EVENT, {
      detail: { teamId: teamId ?? null },
    }),
  );
}
