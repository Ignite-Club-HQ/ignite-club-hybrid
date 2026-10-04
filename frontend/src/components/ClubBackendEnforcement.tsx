import { useEffect, useState, type ReactNode } from "react";
import { useOptionalAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  getCurrentInternetIdentity,
  signOutInternetIdentity,
} from "@/live/internetIdentityAuth";
// features/membership is imported lazily at the call site so the ICP SDK
// stays out of the entry chunk (this component mounts at app start).
import { getActiveIcpTarget } from "@/live/targetRegistry";
import { isIcpAuthAvailable } from "@/live/authBackendMode";
import {
  cacheClubBackendHint,
  getBackendRoutingConfig,
  resolveBackendForUser,
  resolveClubBackendOverride,
  type BackendProvider,
} from "@/live/backendRouting";
import { getCurrentCountry } from "@/live/userCountry";
import { clearUserClubIds, setUserClubIds } from "@/live/userClubs";

/**
 * Applies the app-admin per-club backend overrides
 * (`backend_routing_config.clubBackendOverrides`) after sign-in.
 *
 * Membership is only knowable post-auth, so the flow is two-phase:
 *  1. Pre-auth, routing reads the cached club-backend hint so /auth shows
 *     the right sign-in method (see backendRouting.ts / authBackendMode.ts).
 *  2. Post-auth, this component loads the user's club ids from whichever
 *     backend they signed in with, refreshes the hint, and — when a pin says
 *     the user belongs on the OTHER backend — signs them out and reloads so
 *     they land on the correct sign-in screen. A sessionStorage guard stops
 *     a misconfigured pin from reload-looping: after one enforced switch the
 *     user stays signed in and a warning is logged instead.
 *
 * Race-window hardening: while a signed-in user COULD be subject to a club
 * pin (i.e. at least one clubBackendOverrides entry exists), this component
 * holds its children — the route tree — behind a loader until the pin check
 * has settled. That closes the window where pages would fire queries against
 * the wrong backend before enforcement signed the user out. With no pins
 * configured nothing can force a switch, so children render immediately and
 * the membership/hint maintenance still runs in the background.
 *
 * With no club pin this component only maintains the membership store and
 * hint cache; it never signs anyone out.
 */

const ENFORCED_KEY = "ignite.clubBackendEnforced";

async function fetchSupabaseClubIds(userId: string): Promise<string[]> {
  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("club_id, team_id")
    .eq("user_id", userId);
  if (rolesError) throw rolesError;
  const directClubIds = (roles ?? []).filter(r => r.club_id).map(r => r.club_id!);
  const teamIds = (roles ?? []).filter(r => r.team_id).map(r => r.team_id!);
  let teamClubIds: string[] = [];
  if (teamIds.length > 0) {
    const { data: teams, error: teamsError } = await supabase
      .from("teams")
      .select("club_id")
      .in("id", teamIds);
    if (teamsError) throw teamsError;
    teamClubIds = (teams ?? []).map(t => t.club_id).filter((id): id is string => !!id);
  }
  return [...new Set([...directClubIds, ...teamClubIds])];
}

function hasClubPins(): boolean {
  return Object.keys(getBackendRoutingConfig().clubBackendOverrides).length > 0;
}

export function ClubBackendEnforcement({ children }: { children?: ReactNode }) {
  const user = useOptionalAuth()?.user ?? null;
  const { toast } = useToast();
  const [settled, setSettled] = useState(false);

  useEffect(() => {
    if (!user) {
      clearUserClubIds();
      setSettled(true);
      return;
    }
    // A new signed-in user must re-run the pin check before the route tree
    // renders again.
    if (hasClubPins()) setSettled(false);
    let cancelled = false;
    const settle = () => {
      if (!cancelled) setSettled(true);
    };
    void (async () => {
      try {
        const identity = await getCurrentInternetIdentity();
        const provider: BackendProvider = identity ? "icp" : "supabase";
        let clubIds: string[] = [];
        if (identity) {
          try {
            const { getLiveMyRoleGrants } = await import("@/live/features/membership");
            const grants = await getLiveMyRoleGrants({ identity, target: getActiveIcpTarget() });
            clubIds = [...new Set(grants.map(g => g.club[0]).filter((id): id is string => !!id))];
          } catch (error) {
            // Canister unreachable or not deployed: keep memberships empty so
            // routing falls back to country rules / the cached hint.
            console.warn("[club-backend] Could not load ICP role grants.", error);
          }
        } else {
          clubIds = await fetchSupabaseClubIds(user.id);
        }
        if (cancelled) return;
        setUserClubIds(clubIds);

        const config = getBackendRoutingConfig();
        const pin = resolveClubBackendOverride(config, clubIds);
        cacheClubBackendHint(pin);
        if (pin === null) {
          sessionStorage.removeItem(ENFORCED_KEY);
          settle();
          return;
        }
        const { country } = getCurrentCountry();
        const required = resolveBackendForUser(config, country, clubIds, isIcpAuthAvailable());
        if (required === provider) {
          sessionStorage.removeItem(ENFORCED_KEY);
          settle();
          return;
        }
        if (sessionStorage.getItem(ENFORCED_KEY)) {
          console.warn(
            "[club-backend] Club pin requires backend",
            required,
            "but the user is signed in via",
            provider,
            "— staying signed in to avoid a reload loop.",
          );
          toast({
            title: "Sign-in method mismatch",
            description:
              required === "icp"
                ? "Your club uses Internet Identity, but we couldn't switch you automatically. Please sign out and sign back in with Internet Identity."
                : "Your club uses email sign-in, but we couldn't switch you automatically. Please sign out and sign back in with email.",
            variant: "destructive",
          });
          settle();
          return;
        }
        sessionStorage.setItem(ENFORCED_KEY, "1");
        toast({
          title: "Switching sign-in method",
          description:
            required === "icp"
              ? "Your club uses Internet Identity. Signing you out so you can sign in with it."
              : "Your club uses email sign-in. Signing you out so you can sign in with it.",
        });
        if (provider === "icp") {
          const { disconnectChatRealtime } = await import("@/live/wsRealtime");
          disconnectChatRealtime();
          await signOutInternetIdentity();
        } else {
          await supabase.auth.signOut();
        }
        // Deliberately NOT settling: keep the loader up until the reload
        // replaces the page, so no wrong-backend query can fire in between.
        // Reload the ROOT, not the current URL: the published/preview hosting
        // has no SPA fallback, so reloading a deep path (e.g. /auth) answers
        // a plain "Not Found" instead of the app.
        window.location.replace("/");
      } catch (error) {
        console.warn("[club-backend] Enforcement check failed.", error);
        // Fail open to the previous behavior rather than hanging the app on
        // a loader forever when the membership fetch itself fails.
        settle();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Fast path: with no club pins configured nothing can force a backend
  // switch, so never hold the route tree on the membership fetch.
  if (!user || settled || !hasClubPins()) {
    return <>{children}</>;
  }
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="animate-pulse text-2xl font-bold text-gradient-emerald">Ignite</div>
    </div>
  );
}
