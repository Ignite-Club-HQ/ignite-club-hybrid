import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { CheckCircle2, Circle, ArrowRight, X, Sparkles } from "lucide-react";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface TeamNextStepsCardProps {
  teamId: string;
  onInvite: () => void;
}

/**
 * Post-team-creation onboarding card.
 * Shows checklist for inviting members and adding the first event.
 * Auto-hides once both steps are complete; user can also dismiss manually.
 */
export function TeamNextStepsCard({ teamId, onInvite }: TeamNextStepsCardProps) {
  const navigate = useNavigate();
  const dismissKey = `team-next-steps-dismissed:${teamId}`;
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);

  // Count invited members (user_roles for this team + outstanding pending_invites)
  const { data: memberCount = 0, isLoading: loadingMembers } = useQuery({
    queryKey: ["team-next-steps-members", teamId],
    queryFn: async () => {
      const { withFeatureBackend } = await import("@/live/featureRouter");
      return withFeatureBackend("membership", {
        supabase: async () => {
          const [rolesRes, invitesRes] = await Promise.all([
            supabase
              .from("user_roles")
              .select("user_id", { count: "exact", head: true })
              .eq("team_id", teamId),
            supabase
              .from("pending_invites")
              .select("id", { count: "exact", head: true })
              .eq("team_id", teamId)
              .eq("status", "pending"),
          ]);
          // Distinct member count is approximate (a user may hold multiple roles);
          // for the "is just the creator" check this is good enough.
          return (rolesRes.count ?? 0) + (invitesRes.count ?? 0);
        },
        icp: async (ctx) => {
          // Internet Identity: role grants and outstanding invites live on the
          // club canister.
          const membership = await import("@/live/features/membership");
          const grants = await membership.listLiveTeamRoleGrants(ctx, teamId);
          const team = await membership.getLiveMembershipTeam(ctx, teamId);
          const clubId = (team as any)?.club_id as string | undefined;
          const invites = clubId
            ? await membership.listLiveTeamInvites(ctx, clubId, teamId)
            : [];
          const pending = (invites as any[]).filter((i) => {
            const status = i?.status;
            if (typeof status === "string") return status === "pending";
            if (status && typeof status === "object") return "pending" in status;
            return true; // listed invites are outstanding by default
          }).length;
          return (grants as any[]).length + pending;
        },
      }, { teamId });
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
  });

  // Count any future-or-today events for this team
  const today = format(new Date(), "yyyy-MM-dd");
  const { data: hasEvent = false, isLoading: loadingEvents } = useQuery({
    queryKey: ["team-next-steps-events", teamId],
    queryFn: async () => {
      const { withFeatureBackend } = await import("@/live/featureRouter");
      return withFeatureBackend("events", {
        supabase: async () => {
          const { count } = await supabase
            .from("events")
            .select("id", { count: "exact", head: true })
            .eq("team_id", teamId)
            .eq("is_cancelled", false)
            .gte("event_date", today);
          return (count ?? 0) > 0;
        },
        icp: async (ctx) => {
          const { listLiveEvents } = await import("@/live/features/events");
          const events = await listLiveEvents(ctx, null, teamId);
          return (events as any[]).some(
            (e) => !e.cancelled
              && new Date(Number(e.starts_at_ms)).toISOString().slice(0, 10) >= today,
          );
        },
      }, { teamId });
    },
    enabled: !!teamId,
    staleTime: 30 * 1000,
  });

  if (loadingMembers || loadingEvents) return null;
  if (dismissed) return null;

  // Treat "1 member" as "just the creator" — still needs to invite others.
  const hasInvitedOthers = memberCount > 1;

  // Hide once both steps are done
  if (hasInvitedOthers && hasEvent) return null;

  const steps = [
    {
      label: "Invite team members",
      description: "Add coaches, players, or parents",
      done: hasInvitedOthers,
      onClick: onInvite,
    },
    {
      label: "Add your first event",
      description: "Schedule a training, game or social",
      done: hasEvent,
      onClick: () => navigate("/events/new"),
    },
  ];

  const completedCount = steps.filter((s) => s.done).length;

  const handleDismiss = () => {
    localStorage.setItem(dismissKey, "1");
    setDismissed(true);
  };

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/5 to-transparent">
      <CardContent className="p-4 space-y-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <Sparkles className="h-3.5 w-3.5 text-primary" />
            </div>
            <div className="min-w-0">
              <h3 className="font-semibold text-sm leading-tight">Next steps</h3>
              <p className="text-xs text-muted-foreground leading-tight">
                {completedCount}/{steps.length} complete
              </p>
            </div>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 -mr-1 -mt-1 shrink-0 text-muted-foreground"
            onClick={handleDismiss}
            aria-label="Dismiss next steps"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="w-full bg-muted rounded-full h-1.5">
          <div
            className="bg-primary h-1.5 rounded-full transition-all"
            style={{ width: `${(completedCount / steps.length) * 100}%` }}
          />
        </div>

        <div className="space-y-1">
          {steps.map((step, i) => (
            <button
              key={i}
              type="button"
              onClick={step.done ? undefined : step.onClick}
              disabled={step.done}
              className={`w-full flex items-start gap-3 p-2 rounded-lg text-left transition-colors ${
                step.done
                  ? "opacity-60 cursor-default"
                  : "hover:bg-primary/5 active:bg-primary/10"
              }`}
            >
              {step.done ? (
                <CheckCircle2 className="h-5 w-5 text-emerald-500 shrink-0 mt-0.5" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground shrink-0 mt-0.5" />
              )}
              <div className="flex-1 min-w-0">
                <p className={`text-sm font-medium ${step.done ? "line-through" : ""}`}>
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground">{step.description}</p>
              </div>
              {!step.done && (
                <ArrowRight className="h-4 w-4 text-primary shrink-0 mt-1" />
              )}
            </button>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
