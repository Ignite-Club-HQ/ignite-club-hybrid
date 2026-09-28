/**
 * Applies a pending notification-driven club switch.
 *
 * Mounted inside `ClubThemeProvider` (via `PushNotificationManager`). Listens
 * for switch requests stashed by the native / web push tap handlers and, once
 * membership is verified, moves the global club filter to the club that owns
 * the tapped thread.
 *
 * Guards:
 *  - no-op when the requested club is already active;
 *  - membership is verified against `user_roles` before switching, so a stale
 *    or spoofed payload can never point the app at a club the user isn't in;
 *  - unresolved / failed verification leaves the current filter untouched;
 *  - a request that arrives during cold start survives in sessionStorage and is
 *    drained as soon as the user id is known.
 */
import { useEffect, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  clearNotificationClubSwitchInFlight,
  consumePendingNotificationClubSwitch,
  isDefinitelyNotClubScoped,
  markNotificationClubSwitchApplied,
  peekPendingNotificationClubSwitchRequest,
  resolveNotificationClubId,
  stashResolvedNotificationClubSwitch,
  subscribeNotificationClubSwitch,
} from "@/lib/notificationClubSwitch";


type MembershipVerdict = "yes" | "no" | "error";

/**
 * Verifies the user actually belongs to `clubId` before we move the global
 * filter there.
 *
 * `user_roles` alone is NOT sufficient: plenty of legitimate members (parents,
 * players carried in on a roster) hold only team-scoped rows, or rows whose
 * `club_id` is null. Rejecting those silently left the app filtered to the old
 * club while the notification's thread was open — the reported bug. So we also
 * accept a team membership that resolves to the club, and a club_players row.
 *
 * Returns "error" (not "no") when every lookup failed, so the caller can retry
 * rather than dropping the switch.
 */
async function verifyClubMembership(userId: string, clubId: string): Promise<MembershipVerdict> {
  let sawError = false;

  const roleRes = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .limit(1);
  if (roleRes.error) sawError = true;
  else if (roleRes.data && roleRes.data.length > 0) return "yes";

  // `as any` on the client: the embedded-join generics here trip TS2589
  // (excessively deep instantiation) against the generated Supabase types.
  const db = supabase as any;

  // PRIMARY missing path. `useClubTheme` builds both `availableClubThemes` and
  // `userClubs` from a UNION of `user_roles.club_id` AND
  // `user_roles.team_id -> teams.club_id`. A team-scoped role row has
  // `club_id = NULL`, so the direct check above rejects members the rest of the
  // app treats as belonging to the club — which is exactly why the switch was
  // silently dropped. Mirror the union here.
  const teamRoleRes = await db
    .from("user_roles")
    .select("id, teams!inner(club_id)")
    .eq("user_id", userId)
    .not("team_id", "is", null)
    .eq("teams.club_id", clubId)
    .limit(1);
  if (teamRoleRes.error) sawError = true;
  else if (teamRoleRes.data && teamRoleRes.data.length > 0) return "yes";

  const teamRes = await db
    .from("team_memberships")
    .select("id, teams!inner(club_id)")
    .eq("user_id", userId)
    .eq("status", "active")
    .eq("teams.club_id", clubId)
    .limit(1);
  if (teamRes.error) sawError = true;
  else if (teamRes.data && teamRes.data.length > 0) return "yes";

  const playerRes = await db
    .from("club_players")
    .select("id")
    .eq("user_id", userId)
    .eq("club_id", clubId)
    .limit(1);
  if (playerRes.error) sawError = true;
  else if (playerRes.data && playerRes.data.length > 0) return "yes";

  if (sawError) {
    console.warn("[NotificationClubSwitch] membership check incomplete", {
      roles: roleRes.error?.message,
      teamRoles: teamRoleRes.error?.message,
      teams: teamRes.error?.message,
      players: playerRes.error?.message,
    });
    return "error";
  }
  return "no";
}

/**
 * Bounded retries for the two failure modes that used to silently drop a
 * legitimate switch:
 *  - tap-time club resolution raced auth/network → raw stash re-resolved here,
 *    where `user?.id` guarantees the session is ready;
 *  - membership verification hit a transient error → retried instead of
 *    waiting for an incidental effect re-run.
 */
const MAX_RESOLVE_ATTEMPTS = 3;
const RESOLVE_RETRY_MS = 1200;
const MAX_VERIFY_ATTEMPTS = 3;
const VERIFY_RETRY_MS = 1500;

export function useNotificationClubSwitch() {
  const { user } = useAuth();
  const { activeClubTheme, setActiveClubTheme } = useClubTheme();
  const drainingRef = useRef(false);
  const drainRequestedRef = useRef(false);
  const activeClubThemeRef = useRef(activeClubTheme);
  const setActiveClubThemeRef = useRef(setActiveClubTheme);

  // `useClubTheme` currently exposes a setter whose identity changes whenever
  // the provider renders. Keeping that function in the drain effect's
  // dependency list cancelled an in-flight membership lookup on every theme
  // bootstrap render. The replacement effect then saw `drainingRef === true`
  // and returned, leaving the pending switch stranded until another unrelated
  // render/event happened. Refs keep the long-running drain alive while still
  // applying through the latest context values.
  activeClubThemeRef.current = activeClubTheme;
  setActiveClubThemeRef.current = setActiveClubTheme;

  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    const timers = new Set<number>();
    const sleep = (ms: number) => new Promise<void>((resolve) => {
      const t = window.setTimeout(() => { timers.delete(t); resolve(); }, ms);
      timers.add(t);
    });

    const apply = async (clubId: string, attempt = 0): Promise<void> => {
      if (cancelled) return;
      if (!clubId) {
        consumePendingNotificationClubSwitch();
        clearNotificationClubSwitchInFlight();
        return;
      }
      if (clubId === activeClubThemeRef.current) {
        // Already correct — still mark it so the provider's async bootstrap
        // cannot drag the filter back to a previously stored club.
        markNotificationClubSwitchApplied(clubId);
        consumePendingNotificationClubSwitch();
        clearNotificationClubSwitchInFlight();
        return;
      }
      try {
        const verified = await verifyClubMembership(user.id, clubId);
        if (verified === "error") {
          // Lookup failed (offline / flaky) — retry bounded times rather than
          // silently dropping the switch, then keep it pending for the next drain.
          if (attempt + 1 < MAX_VERIFY_ATTEMPTS) {
            await sleep(VERIFY_RETRY_MS);
            return apply(clubId, attempt + 1);
          }
          return;
        }
        if (cancelled) return;
        consumePendingNotificationClubSwitch();
        if (verified === "no") {
          // Not a member — never switch, and stop shielding the route from the
          // club scope guard.
          clearNotificationClubSwitchInFlight();
          return;
        }
        console.log("[NotificationClubSwitch] switching active club", { from: activeClubThemeRef.current, to: clubId });
        markNotificationClubSwitchApplied(clubId);
        activeClubThemeRef.current = clubId;
        setActiveClubThemeRef.current(clubId);
        clearNotificationClubSwitchInFlight();
      } catch (err) {
        console.warn("[NotificationClubSwitch] switch failed", err);
      }
    };

    const drain = async (): Promise<void> => {
      if (cancelled) return;
      if (drainingRef.current) {
        // A duplicate native event, or the tap-time resolver upgrading a raw
        // request while this pass is awaiting Supabase, must not be lost.
        drainRequestedRef.current = true;
        return;
      }
      drainingRef.current = true;
      try {
        do {
          drainRequestedRef.current = false;
          const req = peekPendingNotificationClubSwitchRequest();
          if (!req) continue;
          if (req.clubId) {
            await apply(req.clubId);
            continue;
          }
          // Raw request: the tap-time lookup raced auth/network. Now that
          // `user?.id` is known the session is ready — resolve here, bounded.
          if (isDefinitelyNotClubScoped(req.data, req.url)) {
            consumePendingNotificationClubSwitch();
            clearNotificationClubSwitchInFlight();
            continue;
          }
          let resolved = false;
          for (let attempt = 0; attempt < MAX_RESOLVE_ATTEMPTS && !cancelled; attempt++) {
            const clubId = await resolveNotificationClubId(req.data, req.url);
            if (cancelled) return;
            if (clubId) {
              // Upgrade the stash (marks the route in-flight) and apply directly.
              stashResolvedNotificationClubSwitch(clubId, req.data, req.url);
              await apply(clubId);
              resolved = true;
              break;
            }
            if (attempt + 1 < MAX_RESOLVE_ATTEMPTS) await sleep(RESOLVE_RETRY_MS);
          }
          if (cancelled) return;
          if (resolved) continue;
          // Re-peek: a concurrent tap-time resolution may have landed during
          // our retries — never consume a freshly resolved switch.
          const fresh = peekPendingNotificationClubSwitchRequest();
          if (fresh?.clubId) {
            await apply(fresh.clubId);
            continue;
          }
          // Genuinely not club-scoped (or unreachable for good) — leave the
          // current filter untouched.
          consumePendingNotificationClubSwitch();
          clearNotificationClubSwitchInFlight();
        } while (!cancelled && drainRequestedRef.current);
      } finally {
        drainingRef.current = false;
      }
    };

    // Drain anything stashed before mount (cold-start tap).
    void drain();

    const unsubscribe = subscribeNotificationClubSwitch(() => void drain());
    return () => {
      cancelled = true;
      unsubscribe();
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [user?.id]);
}
