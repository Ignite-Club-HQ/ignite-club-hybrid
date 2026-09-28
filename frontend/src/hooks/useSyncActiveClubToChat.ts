/**
 * useSyncActiveClubToChat
 *
 * Chat pages must never mutate the global active-club filter. The selected
 * club is a user-controlled preference and can only change via the club picker.
 *
 * Safe to call with `null`/`undefined` — it's a no-op until a club id is known.
 */

export function useSyncActiveClubToChat(clubId: string | null | undefined) {
  void clubId;
}
