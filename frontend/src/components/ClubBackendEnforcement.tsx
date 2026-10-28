import { useEffect, useState, type ReactNode } from "react";
import { useOptionalAuth } from "@/hooks/useAuth";
import { AppSplash } from "@/components/AppSplash";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getCurrentInternetIdentityConfirmed } from "@/live/internetIdentityAuth";
// features/membership is imported lazily at the call site so the ICP SDK
// stays out of the entry chunk (this component mounts at app start).
import { getActiveIcpTarget } from "@/live/targetRegistry";
import { isIcpAuthAvailable, readAuthChoice } from "@/live/authBackendMode";
import {
  cacheClubBackendHint,
  deriveClubBackendsFromHomeCountries,
  getBackendRoutingConfig,
  isClubHomeCountryRoutingActive,
  resolveBackendForUser,
  resolveClubBackendOverride,
  type BackendProvider,
} from "@/live/backendRouting";
import { getCurrentCountry } from "@/live/userCountry";
import { clearUserClubIds, setUserClubIds } from "@/live/userClubs";

/**
 * Refreshes signed-in memberships and checks email-mode club routing.
 * A confirmed Internet Identity account stays on-chain: a club's country
 * describes placement preference, not a migration of its existing records.
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
// Remembers, per account, that this device already passed the club
// sign-in-method check, so returning to the app never waits on it again
// (the check still runs in the background and can still switch a member).
const VERIFIED_KEY = "ignite.clubBackendVerified";

function isVerified(userId: string): boolean {
  try { return localStorage.getItem(VERIFIED_KEY) === userId; } catch { return false; }
}
function markVerified(userId: string) {
  try { localStorage.setItem(VERIFIED_KEY, userId); } catch { /* ignore */ }
}

async function fetchSupabaseMembership(
  userId: string,
): Promise<{ clubIds: string[]; isAppAdmin: boolean }> {
  const { data: roles, error: rolesError } = await supabase
    .from("user_roles")
    .select("club_id, team_id, role")
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
  return {
    clubIds: [...new Set([...directClubIds, ...teamClubIds])],
    isAppAdmin: (roles ?? []).some(r => r.role === "app_admin"),
  };
}

function hasClubPins(): boolean {
  return isClubHomeCountryRoutingActive(getBackendRoutingConfig());
}

async function fetchSupabaseHomeCountries(clubIds: string[]): Promise<Record<string, string | null>> {
  if (clubIds.length === 0) return {};
  const { data, error } = await supabase.from("clubs").select("id, home_country").in("id", clubIds);
  if (error) throw error;
  return Object.fromEntries((data ?? []).map((c: any) => [c.id, c.home_country ?? null]));
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
    const alreadyVerified = isVerified(user.id);
    if (hasClubPins() && !alreadyVerified) setSettled(false);
    else setSettled(true);
    let cancelled = false;
    const settle = () => {
      markVerified(user.id);
      if (!cancelled) setSettled(true);
    };
    void (async () => {
      try {
        // Decide the provider from the signed-in account, not from whether the
        // II client answered yet: a momentary null (client still restoring or
        // re-minting) used to classify an ICP member as "supabase", sign them
        // out and reload the page.
        const isIcpUser = (user as { app_metadata?: { provider?: string } }).app_metadata?.provider === "icp";
        // An email (Supabase) account never uses an Internet Identity, even if
        // an old one is still stored on this device.
        const identity = isIcpUser ? await getCurrentInternetIdentityConfirmed() : null;
        if (isIcpUser && !identity) {
          settle();
          return;
        }
        const provider: BackendProvider = isIcpUser ? "icp" : "supabase";
        let clubIds: string[] = [];
        // App admins administer the whole app (Placement Settings, routing
        // config) from Supabase-backed screens, so a club pin must never sign
        // them out of their Supabase session.
        let isAppAdmin = false;
        // False when the membership lookup failed, so the hint cache below
        // is left untouched: resolving a pin from an empty membership list
        // yields null, and caching null would ERASE the hint — after the next
        // sign-out /auth would fall back to country rules and show the wrong
        // sign-in screen until the user signed in again.
        let membershipKnown = true;
        if (identity) {
          try {
            const { getLiveMyRoleGrants } = await import("@/live/features/membership");
            const grants = await getLiveMyRoleGrants({ identity, target: getActiveIcpTarget() });
            clubIds = [...new Set(grants.map(g => g.club[0]).filter((id): id is string => !!id))];
            // App admins may sign in with either method — a club pin must
            // never force them onto the other backend.
            isAppAdmin = grants.some(g => g.role === "app_admin");
          } catch (error) {
            // Canister unreachable or not deployed: keep memberships empty so
            // routing falls back to country rules / the cached hint.
            membershipKnown = false;
            console.warn("[club-backend] Could not load ICP role grants.", error);
          }
        } else {
          const membership = await fetchSupabaseMembership(user.id);
          clubIds = membership.clubIds;
          isAppAdmin = membership.isAppAdmin;
        }
        if (cancelled) return;
        setUserClubIds(clubIds);

        // These memberships came from the caller-authorized canisters. Mapping
        // their countries through today's email default does not move those
        // clubs to Supabase or create an email identity for this account.
        // Retain the actual signed-in provider, including explicit ?auth=icp
        // choices and restored/redirect sessions without that URL parameter.
        if (provider === "icp") {
          if (membershipKnown) cacheClubBackendHint("icp");
          sessionStorage.removeItem(ENFORCED_KEY);
          settle();
          return;
        }

        // A club's backend follows its home country, using the same country
        // rules as the sign-in screen.
        const config = getBackendRoutingConfig();
        let homeCountries: Record<string, string | null> = {};
        try {
          homeCountries = await fetchSupabaseHomeCountries(clubIds);
        } catch (error) {
          membershipKnown = false;
          console.warn("[club-backend] Could not load club home countries.", error);
        }
        if (cancelled) return;
        config.clubBackendOverrides = deriveClubBackendsFromHomeCountries(
          config, homeCountries, isIcpAuthAvailable(),
        );
        const pin = resolveClubBackendOverride(config, clubIds);
        if (membershipKnown) cacheClubBackendHint(pin);
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
        // The person deliberately picked email sign-in on this device
        // (?auth=email): honour it — their data is read from Supabase.
        if (readAuthChoice() === "supabase") {
          sessionStorage.removeItem(ENFORCED_KEY);
          settle();
          return;
        }
        if (isAppAdmin) {
          console.info(
            `[club-backend] App admin signed in via ${provider} while a club pin requires ${required} — skipping enforcement so admin settings stay reachable.`,
          );
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
        try { localStorage.removeItem(VERIFIED_KEY); } catch { /* ignore */ }
        toast({
          title: "Switching sign-in method",
          description:
            required === "icp"
              ? "Your club uses Internet Identity. Signing you out so you can sign in with it."
              : "Your club uses email sign-in. Signing you out so you can sign in with it.",
        });
        await supabase.auth.signOut();
        // Deliberately NOT settling: keep the loader up until the reload
        // replaces the page, so no wrong-backend query can fire in between.
        // Reload the ROOT, not the current URL: the published/preview hosting
        // has no SPA fallback, so reloading a deep path (e.g. /auth) answers
        // a plain "Not Found" instead of the app.
        // Drop any device-level ?auth= choice so the club's method wins.
        try { localStorage.removeItem("ignite.authChoice"); } catch { /* ignore */ }
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
  if (!user || settled || !hasClubPins() || isVerified(user.id)) {
    return <>{children}</>;
  }
  return <AppSplash message="Signing you in..." />;
}
