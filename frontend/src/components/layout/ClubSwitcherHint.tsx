import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

/**
 * One-shot coach-mark for the header club switcher.
 *
 * Shown once ever per user, only when they belong to more than one club.
 * Dismissal is persisted under an `ignite_`-prefixed key so it is swept by
 * `clearUserScopedCaches()` on sign-out / cross-user sign-in.
 *
 * No backdrop-blur / CSS blur (see project memory: blur over scrolling content
 * causes per-frame re-rasterisation freezes on Android WebView).
 */
const KEY_PREFIX = "ignite_club_switcher_hint_";

export function hasSeenClubSwitcherHint(userId: string): boolean {
  try {
    return localStorage.getItem(`${KEY_PREFIX}${userId}`) === "1";
  } catch {
    return true;
  }
}

export function markClubSwitcherHintSeen(userId: string): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${userId}`, "1");
  } catch {
    /* storage unavailable — hint simply shows again next launch */
  }
  // Persist across devices; local flag above keeps the UI instant.
  void supabase
    .from("profiles")
    .update({ club_switcher_hint_seen_at: new Date().toISOString() })
    .eq("id", userId);
}

/** Server-side dismissal state, so the hint stays dismissed on other devices. */
export async function fetchClubSwitcherHintSeen(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("profiles")
    .select("club_switcher_hint_seen_at")
    .eq("id", userId)
    .maybeSingle();
  if (error) return true; // fail closed — never nag on an unknown state
  const seen = !!data?.club_switcher_hint_seen_at;
  if (seen) markLocalClubSwitcherHintSeen(userId);
  return seen;
}

function markLocalClubSwitcherHintSeen(userId: string): void {
  try {
    localStorage.setItem(`${KEY_PREFIX}${userId}`, "1");
  } catch {
    /* ignore */
  }
}

interface ClubSwitcherHintProps {
  userId: string;
  /** True when the user belongs to more than one club. */
  enabled: boolean;
  onDismiss?: () => void;
  /** Reports whether the coach-mark is currently on screen. */
  onVisibleChange?: (visible: boolean) => void;
}

export function ClubSwitcherHint({ userId, enabled, onDismiss, onVisibleChange }: ClubSwitcherHintProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    onVisibleChange?.(visible);
  }, [visible, onVisibleChange]);

  useEffect(() => {
    if (!enabled || !userId) return;
    if (hasSeenClubSwitcherHint(userId)) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void fetchClubSwitcherHintSeen(userId).then((seen) => {
      if (cancelled || seen) return;
      timer = setTimeout(() => setVisible(true), 600);
    });
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, userId]);

  const dismiss = () => {
    setVisible(false);
    markClubSwitcherHintSeen(userId);
    onDismiss?.();
  };

  if (!visible) return null;


  return (
    <div
      role="status"
      className="absolute left-0 top-full z-50 mt-1 w-[248px] rounded-lg border border-border bg-popover px-3 py-2 shadow-lg animate-in fade-in-0 slide-in-from-top-1"
    >
      <div
        className="absolute -top-1.5 left-5 h-3 w-3 rotate-45 border-l border-t border-border bg-popover"
        aria-hidden="true"
      />
      <div className="flex items-start gap-2">
        <p className="text-xs leading-snug text-popover-foreground">
          You're in more than one club — tap here to switch.
        </p>
        <button
          type="button"
          onClick={dismiss}
          aria-label="Dismiss club switcher hint"
          className="-mr-1 -mt-0.5 shrink-0 rounded p-1 text-muted-foreground hover:text-foreground focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
