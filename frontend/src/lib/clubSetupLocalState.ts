/**
 * Local-only state for the club setup wizard (draft input + dismissed card).
 * Cleared when a club is soft-deleted or permanently purged so stale drafts
 * do not resurface (e.g. as a "resume setup" card on the home page).
 */
export function clearClubSetupLocalState(clubId: string): void {
  if (typeof window === "undefined" || !clubId) return;
  try {
    localStorage.removeItem(`ignite_wizard_draft_${clubId}`);
    localStorage.removeItem(`ignite_club_setup_dismissed_${clubId}`);
  } catch {
    /* ignore quota / access errors */
  }
}
