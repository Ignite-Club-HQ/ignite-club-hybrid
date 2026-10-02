import { useEffect } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import {
  getCurrentInternetIdentity,
  signOutInternetIdentity,
} from "@/live/internetIdentityAuth";
import { getLiveMyRoleGrants } from "@/live/features/membership";
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

export function ClubBackendEnforcement() {
  const { user } = useAuth();
  const { toast } = useToast();

  useEffect(() => {
    if (!user) {
      clearUserClubIds();
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const identity = await getCurrentInternetIdentity();
        const provider: BackendProvider = identity ? "icp" : "supabase";
        let clubIds: string[] = [];
        if (identity) {
          try {
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
          return;
        }
        const { country } = getCurrentCountry();
        const required = resolveBackendForUser(config, country, clubIds, isIcpAuthAvailable());
        if (required === provider) {
          sessionStorage.removeItem(ENFORCED_KEY);
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
          await signOutInternetIdentity();
        } else {
          await supabase.auth.signOut();
        }
        window.location.reload();
      } catch (error) {
        console.warn("[club-backend] Enforcement check failed.", error);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  return null;
}
