// Throttled nudge that prompts users to also add a chat-shared image to the
// Media Gallery. We only nudge at most once every 24 hours per device so it
// never feels naggy, and we suppress it entirely if the user has already
// dismissed/published recently.

const LAST_SHOWN_KEY = "ignite_gallery_nudge_lastShown";
const THROTTLE_MS = 24 * 60 * 60 * 1000;

export function shouldShowGalleryNudge(): boolean {
  try {
    const raw = localStorage.getItem(LAST_SHOWN_KEY);
    if (!raw) return true;
    const last = parseInt(raw, 10);
    if (!Number.isFinite(last)) return true;
    return Date.now() - last > THROTTLE_MS;
  } catch {
    return false;
  }
}

export function markGalleryNudgeShown() {
  try {
    localStorage.setItem(LAST_SHOWN_KEY, String(Date.now()));
  } catch {
    /* noop */
  }
}
