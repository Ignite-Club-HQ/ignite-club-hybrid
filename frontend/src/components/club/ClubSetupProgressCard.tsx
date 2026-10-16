import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Sparkles, ArrowRight, X, CheckCircle2, Circle } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { hasSavedClubBranding } from "@/lib/clubSetupBranding";

interface ClubSetupProgressCardProps {
  clubId: string;
  /** True when the club is a "shell" (personal team organiser) — hides club-only steps. */
  isShellClub?: boolean;
  className?: string;
}

/**
 * Resume-the-wizard card. Shows N/M completed setup steps and a "Continue setup"
 * action that opens /clubs/:id/setup. Auto-hides when fully complete or dismissed.
 * Only render for club admins (caller decides).
 */
export function ClubSetupProgressCard({
  clubId,
  isShellClub = false,
  className,
}: ClubSetupProgressCardProps) {
  const navigate = useNavigate();
  const dismissKey = `ignite_club_setup_dismissed_${clubId}`;
  const [dismissed, setDismissed] = useState(false);
  const useIcp = isFeatureRoutedToIcp("membership");
  const { hasPro } = useClubProAccess(clubId);

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  const { data, isLoading } = useQuery({
    queryKey: ["club-setup-progress", clubId, isShellClub, useIcp ? "icp" : "supabase"],
    queryFn: async () => {
      if (useIcp) {
        const [clubApi, membershipApi, messagingApi] = await Promise.all([
          import("@/live/features/club"),
          import("@/live/features/membership"),
          import("@/live/features/messaging"),
        ]);
        return withFeatureBackend("membership", {
          supabase: async () => { throw new Error("Club setup backend changed; retry"); },
          icp: async (ctx) => {
            const [teams, profile, settings, roles, invites, groups, sponsors] = await Promise.all([
              clubApi.listLiveTeams(ctx, clubId),
              clubApi.getLiveClubProfile(ctx, clubId),
              clubApi.getLiveClubSettings(ctx, clubId),
              membershipApi.listLiveRoleGrants(ctx, clubId),
              clubApi.listLivePendingInvitesByClub(ctx, clubId),
              messagingApi.listLiveGroupsByClub(ctx, clubId),
              clubApi.listLiveSponsors(ctx, clubId),
            ]);
            const pending = invites.filter((invite) => invite.status === "pending");
            return {
              teamsCount: teams.length,
              hasLogo: hasSavedClubBranding({ ...settings[0], logo_url: profile[0]?.logo_url[0] }),
              committeeCount: roles.filter((role) => role.role === "committee_member").length +
                pending.filter((invite) => invite.role[0] === "committee_member").length,
              teamMemberCount: pending.length + roles.filter((role) => role.team.length > 0).length,
              groupsCount: groups.filter((group) => ["subcommittee", "Operations"].includes(group.kind)).length,
              sponsorsCount: sponsors.length,
            };
          },
        });
      }
      const [
        teamsRes,
        clubRes,
        committeeRolesRes,
        committeeInvitesRes,
        invitesRes,
        rolesRes,
        groupsRes,
        sponsorsRes,
      ] = await Promise.all([
        supabase
          .from("teams")
          .select("id", { count: "exact", head: true })
          .eq("club_id", clubId),
        supabase
          .from("clubs")
          .select("logo_url, theme_primary_h, theme_secondary_h, theme_accent_h, theme_dark_primary_h, theme_dark_secondary_h, theme_dark_accent_h")
          .eq("id", clubId)
          .maybeSingle(),
        supabase
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("club_id", clubId)
          .eq("role", "committee_member"),
        supabase
          .from("pending_invites")
          .select("id", { count: "exact", head: true })
          .eq("club_id", clubId)
          .eq("role", "committee_member")
          .eq("status", "pending"),
        supabase
          .from("pending_invites")
          .select("id", { count: "exact", head: true })
          .eq("club_id", clubId)
          .eq("status", "pending"),
        supabase
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("club_id", clubId)
          .not("team_id", "is", null),
        supabase
          .from("chat_groups")
          .select("id", { count: "exact", head: true })
          .eq("club_id", clubId)
          .is("deleted_at", null)
          .in("category", ["subcommittee", "Operations"]),
        supabase
          .from("sponsors" as any)
          .select("id", { count: "exact", head: true })
          .eq("club_id", clubId),
      ]);
      const clubRow = clubRes.data as any;
      const hasBranding = hasSavedClubBranding(clubRow);
      return {
        teamsCount: teamsRes.count ?? 0,
        hasLogo: hasBranding,
        committeeCount: (committeeRolesRes.count ?? 0) + (committeeInvitesRes.count ?? 0),
        teamMemberCount:
          (invitesRes.count ?? 0) + (rolesRes.count ?? 0),
        groupsCount: groupsRes.count ?? 0,
        sponsorsCount: sponsorsRes.count ?? 0,
      };

    },
    enabled: !!clubId,
    staleTime: 60 * 1000,
  });

  if (isLoading || !data || dismissed) return null;

  const steps: { label: string; done: boolean; pro?: boolean; optional?: boolean; savedDetail?: string }[] = isShellClub
    ? [
        { label: "Create teams", done: data.teamsCount > 0 },
        { label: "Invite members", done: data.teamMemberCount > 0 },
      ]
    : [
        { label: "Create teams", done: data.teamsCount > 0 },
        { label: "Invite members", done: data.teamMemberCount > 0 },
        { label: "Invite committee members", done: data.committeeCount > 0, pro: true, optional: true },
        { label: "Create Subcommittees", done: data.groupsCount > 0, pro: true, optional: true },
        { label: "Add club branding", done: data.hasLogo, pro: true, optional: true, savedDetail: "Branding saved" },
        { label: "Add sponsors", done: data.sponsorsCount > 0, pro: true, optional: true, savedDetail: `${data.sponsorsCount} sponsor${data.sponsorsCount === 1 ? "" : "s"} saved` },
      ];

  // Only the two core steps determine "complete" — optional/Pro items don't
  // keep the card alive. Once every required step is done, hide permanently
  // and persist the dismissal locally so it never returns on this device,
  // even if a future optional/Pro step regresses.
  const requiredSteps = steps.filter((s) => !s.optional);
  const completed = requiredSteps.filter((s) => s.done).length;
  const total = requiredSteps.length;
  if (completed === total) {
    if (typeof localStorage !== "undefined" && localStorage.getItem(dismissKey) !== "1") {
      try { localStorage.setItem(dismissKey, "1"); } catch { /* noop */ }
    }
    return null;
  }

  const dismiss = () => {
    localStorage.setItem(dismissKey, "1");
    setDismissed(true);
  };

  return (
    <Card
      className={
        "border-primary/30 bg-gradient-to-br from-primary/10 to-transparent " +
        (className ?? "")
      }
    >
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-8 w-8 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <Sparkles className="h-4 w-4 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight">
                Finish setting up your club
              </h3>
              <p className="text-xs text-muted-foreground leading-tight">
                {completed} of {total} steps complete
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 -mr-1 -mt-1 shrink-0 text-muted-foreground"
            onClick={dismiss}
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${(completed / total) * 100}%` }}
          />
        </div>

        <ul className="space-y-1">
          {steps.map((s) => (
            <li
              key={s.label}
              className="flex items-center gap-2 text-sm"
            >
              {s.done ? (
                 <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
              ) : (
                <Circle className="h-4 w-4 text-muted-foreground shrink-0" />
              )}
              <span
                className={
                  s.done
                    ? "text-muted-foreground flex-1 min-w-0"
                    : "text-foreground flex-1 min-w-0"
                }
              >
                {s.done && s.savedDetail ? s.savedDetail : s.label}
                {s.done && s.savedDetail && !hasPro && (
                  <span className="block text-xs text-muted-foreground">Upgrade to Pro to activate</span>
                )}
              </span>
              {s.pro && !s.done && (
                <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-400 uppercase tracking-wide shrink-0">
                  Pro
                </span>
              )}
              {s.optional && !s.pro && !s.done && (
                <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted text-muted-foreground uppercase tracking-wide shrink-0">
                  Optional
                </span>
              )}
            </li>
          ))}
        </ul>

        <Button
          size="sm"
          className="w-full"
          onClick={() => navigate(`/clubs/${clubId}/setup`)}
        >
          Continue setup
          <ArrowRight className="h-4 w-4 ml-1" />
        </Button>
      </CardContent>
    </Card>
  );
}
