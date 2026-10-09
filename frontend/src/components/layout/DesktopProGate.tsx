import { Capacitor } from "@capacitor/core";
import { Smartphone, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useLocation } from "react-router-dom";
import { LogoImage } from "@/components/ui/logo-image";
import { Button } from "@/components/ui/button";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { resolveAuthBackend } from "@/live/authBackendMode";
import igniteIcon from "@/assets/ignite-icon.png";

/**
 * Whether the signed-in user belongs to ANY club (directly or via a team),
 * in either backend. Desktop is only gated once the user actually has a
 * club — a brand-new user with no clubs must be able to reach club creation
 * on desktop. Unknown (loading/errored) counts as "has clubs" so the gate
 * never opens on a guess.
 */
function useUserHasAnyClub() {
  const { user } = useAuth();
  const isIcp = resolveAuthBackend() === "icp";
  const query = useQuery({
    queryKey: ["desktop-gate-has-any-club", user?.id, isIcp],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async (): Promise<boolean> => {
      if (isIcp) {
        const [{ withFeatureBackend }, { getLiveMyRoleGrants }] = await Promise.all([
          import("@/live/featureRouter"),
          import("@/live/features/membership"),
        ]);
        return withFeatureBackend("membership", {
          supabase: async () => false,
          icp: async (ctx) => {
            const grants = await getLiveMyRoleGrants(ctx);
            return grants.some((g) => g.club[0] || g.team[0]);
          },
        });
      }
      const { data, error } = await supabase
        .from("user_roles")
        .select("club_id, team_id")
        .eq("user_id", user!.id);
      if (error) throw error;
      return (data ?? []).some((r) => r.club_id || r.team_id);
    },
  });
  return { hasAnyClub: query.data !== false, isLoading: query.isLoading || query.isError };
}

/**
 * Clubs the user belongs to that currently have Pro access. Used so a user
 * stuck on a free club can switch back to a Pro club from the lock screen,
 * and so the no-club-filter view stays open when any of the user's clubs
 * is Pro. Works on both backends: Supabase reads user_roles +
 * club_subscriptions; ICP reads club_domain role grants + per-club
 * subscription rows (never Supabase for an Internet Identity principal).
 */
function useUserProClubs(enabled: boolean) {
  const { user } = useAuth();
  const isIcp = resolveAuthBackend() === "icp";
  return useQuery({
    queryKey: ["desktop-gate-pro-clubs", user?.id, isIcp],
    enabled: enabled && !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      if (isIcp) {
        const [{ withFeatureBackend }, { getLiveMyRoleGrants }] = await Promise.all([
          import("@/live/featureRouter"),
          import("@/live/features/membership"),
        ]);
        return withFeatureBackend("membership", {
          supabase: async () => [] as { id: string; name: string; logoUrl: string | null }[],
          icp: async (ctx) => {
            const grants = ((await getLiveMyRoleGrants(ctx).catch(() => [])) as any[]) ?? [];
            const clubIds = new Set<string>();
            const teamIds: string[] = [];
            grants.forEach((g) => {
              const club = Array.isArray(g.club) ? g.club[0] : g.club;
              const team = Array.isArray(g.team) ? g.team[0] : g.team;
              if (club) clubIds.add(club);
              else if (team) teamIds.push(team);
            });
            const { getLiveTeam, getLiveClubSubscription, getLiveClubProfile } = await import("@/live/features/club");
            // Resolve the club behind team-scoped grants.
            await Promise.all(
              teamIds.map(async (tid) => {
                try {
                  const t = (await getLiveTeam(ctx, tid)) as any;
                  const cid = t?.club_id ?? t?.club;
                  if (cid) clubIds.add(cid);
                } catch {
                  /* team gone — skip */
                }
              }),
            );
            const pro = await Promise.all(
              Array.from(clubIds).map(async (cid) => {
                try {
                  const sub = await getLiveClubSubscription(ctx, cid);
                  const isPro = Boolean(
                    sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override,
                  );
                  if (!isPro) return null;
                  const profile = Array.isArray(await getLiveClubProfile(ctx, cid))
                    ? (await getLiveClubProfile(ctx, cid))[0]
                    : await getLiveClubProfile(ctx, cid);
                  const p = profile as any;
                  return {
                    id: cid,
                    name: (p?.name ?? "Club") as string,
                    logoUrl: (p?.logo_url ?? p?.logoUrl ?? null) as string | null,
                  };
                } catch {
                  return null;
                }
              }),
            );
            return pro.filter((c): c is { id: string; name: string; logoUrl: string | null } => !!c);
          },
        });
      }
      const [direct, viaTeam] = await Promise.all([
        supabase.from("user_roles").select("club_id").eq("user_id", user!.id).not("club_id", "is", null),
        supabase.from("user_roles").select("teams!inner(club_id)").eq("user_id", user!.id).not("team_id", "is", null),
      ]);
      if (direct.error) throw direct.error;
      if (viaTeam.error) throw viaTeam.error;

      const ids = new Set<string>();
      (direct.data ?? []).forEach((r: any) => r.club_id && ids.add(r.club_id));
      (viaTeam.data ?? []).forEach((r: any) => r.teams?.club_id && ids.add(r.teams.club_id));
      if (ids.size === 0) return [];

      const clubIds = Array.from(ids);
      const [subs, clubs] = await Promise.all([
        supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, expires_at")
          .in("club_id", clubIds),
        supabase.from("clubs").select("id, name, logo_url").in("id", clubIds),
      ]);
      if (subs.error) throw subs.error;
      if (clubs.error) throw clubs.error;

      const proIds = new Set(
        (subs.data ?? [])
          .filter(
            (s: any) =>
              (s.is_pro || s.is_pro_football || s.admin_pro_override || s.admin_pro_football_override) &&
              (!s.expires_at || new Date(s.expires_at) > new Date()),
          )
          .map((s: any) => s.club_id),
      );

      return (clubs.data ?? [])
        .filter((c: any) => proIds.has(c.id))
        .map((c: any) => ({ id: c.id as string, name: c.name as string, logoUrl: (c.logo_url as string) ?? null }));
    },
  });
}

/**
 * Desktop access is a Pro feature, scoped to the ACTIVE club.
 *
 * Renders a full-screen blocking overlay on desktop web (lg+ breakpoint only)
 * when the club currently selected in the club switcher has no active Pro
 * access. This matches every other Pro gate in the app: being a member of a
 * different Pro club no longer unlocks desktop while viewing a free club.
 *
 * When no club is selected (personal / no-club context) we fall back to the
 * user-level "any club Pro" lookup so users without a club filter aren't
 * locked out unexpectedly.
 *
 * Mobile/tablet widths and native (Capacitor) builds are never affected —
 * the overlay itself is `hidden lg:flex`, so below lg it doesn't exist visually.
 *
 * Entitlement is unknown-safe: while either Pro lookup is loading or errored,
 * we render nothing (no lock).
 */
export function DesktopProGate() {
  const { activeThemeData, activeClubFilter, setActiveClubTheme } = useClubTheme();
  const activeClubId = activeClubFilter ?? null;
  const { pathname } = useLocation();

  const anyClub = useUserHasAnyClubPro();
  const activeClub = useClubProAccess(activeClubId, { enabled: !!activeClubId });
  const membership = useUserHasAnyClub();

  // The club setup wizard must stay reachable on desktop: a brand-new free
  // club gets until the wizard is finished before the Pro lock appears.
  const onSetupWizard = /^\/clubs\/[^/]+\/setup/.test(pathname);

  // Users with no clubs at all are never locked — desktop must stay open so
  // they can create their first club. The gate only applies once a club
  // exists and that club (or every club they belong to) is on the free plan.
  const locked = Capacitor.isNativePlatform() || onSetupWizard
    ? false
    : membership.isLoading || !membership.hasAnyClub
      ? false
      : activeClubId
        ? !activeClub.isLoading && !activeClub.hasPro
        : !anyClub.isLoading && !anyClub.hasAnyClubPro;

  // Hook order must stay stable — always call, gate with `enabled`.
  const proClubs = useUserProClubs(locked);
  const switchable = (proClubs.data ?? []).filter((c) => c.id !== activeClubId);

  if (!locked) return null;


  return (
    <div
      className="hidden lg:flex fixed inset-0 z-[100] flex-col items-center justify-center bg-background px-8 text-center"
      role="dialog"
      aria-modal="true"
      aria-label="Desktop access requires Pro"
    >
      <LogoImage
        src={activeThemeData?.logoUrl || igniteIcon}
        alt="Ignite"
        className="h-16 w-16 rounded-2xl mb-6"
        imgClassName="object-cover"
      />

      <div className="flex items-center gap-2 text-primary mb-3">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
        <span className="text-xs font-semibold uppercase tracking-wide">Pro feature</span>
      </div>

      <h1 className="text-2xl font-bold text-foreground max-w-lg">
        Desktop access is available on Pro
      </h1>
      <p className="mt-3 max-w-md text-sm text-muted-foreground">
        Your club is on the free plan, so Ignite is mobile-only for now. Upgrade your
        club to Pro to unlock the full desktop experience, or keep using the app on
        your phone or tablet — Pro can be purchased from the club upgrade screen in the mobile app.
      </p>

      {switchable.length > 0 && (
        <div className="mt-8 w-full max-w-md">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Switch to a Pro club
          </p>
          <div className="mt-3 flex flex-col gap-2">
            {switchable.map((club) => (
              <Button
                key={club.id}
                variant="outline"
                className="h-12 w-full justify-start gap-3"
                onClick={() => setActiveClubTheme(club.id)}
              >
                <LogoImage
                  src={club.logoUrl || igniteIcon}
                  alt=""
                  className="h-7 w-7 rounded-md"
                  imgClassName="object-cover"
                />
                <span className="truncate text-sm font-medium">{club.name}</span>
                <span className="ml-auto text-[10px] font-semibold uppercase tracking-wide text-primary">
                  Pro
                </span>
              </Button>
            ))}
          </div>
        </div>
      )}

      <p className="mt-8 flex items-center gap-2 text-xs text-muted-foreground">
        <Smartphone className="h-3.5 w-3.5" aria-hidden="true" />
        Everything still works as normal on mobile.
      </p>
    </div>
  );
}
