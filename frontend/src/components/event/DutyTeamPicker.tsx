import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";

const NO_TEAM = "__no_team__";

interface TeamOption {
  id: string;
  name: string;
}

/** An explicit empty target list stays restricted, never becomes all-club. */
export function eventDutyTeamIds(teamId?: string | null, targetTeamIds?: string[] | null): string[] | null {
  if (teamId) return [teamId];
  return Array.isArray(targetTeamIds) ? [...new Set(targetTeamIds)] : null;
}

export function scopeDutyTeamOptions(teams: TeamOption[], allowedIds: string[] | null): TeamOption[] {
  if (allowedIds === null) return teams;
  const allowed = new Set(allowedIds);
  return teams.filter((team) => allowed.has(team.id));
}

/**
 * Pick duty-eligible teams from the canister's club team list. Candid
 * optionals arrive as arrays: deleted_at_ms is [] for a live team, so it
 * must be unwrapped ([] is truthy and would hide every team).
 */
export function filterDutyTeamOptions(rows: Array<{
  id: string;
  name: string;
  is_active: boolean;
  archived: boolean;
  is_shell: boolean;
  deleted_at_ms?: [] | [bigint];
}>): TeamOption[] {
  return rows
    .filter((team) => team.is_active && !team.archived && !team.is_shell && !team.deleted_at_ms?.[0])
    .map((team) => ({ id: team.id, name: team.name }));
}

export function DutyTeamPicker({
  clubId,
  teamId,
  targetTeamIds,
  value,
  onChange,
  disabled = false,
  readOnly = false,
}: {
  clubId: string | null | undefined;
  teamId?: string | null;
  targetTeamIds?: string[] | null;
  value: string | null;
  onChange: (teamId: string | null) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const allowedIds = eventDutyTeamIds(teamId, targetTeamIds);
  const { data: teams = [] } = useQuery({
    queryKey: ["active-club-teams-for-duty", clubId, allowedIds],
    enabled: !!clubId,
    queryFn: async () => {
      if (!clubId || allowedIds?.length === 0) return [];
      return withFeatureBackend("membership", {
      supabase: async () => {
        let query = supabase
          .from("teams")
          .select("id, name, is_archived, is_shell, deleted_at, lifecycle_status")
          .eq("club_id", clubId)
          .eq("is_archived", false)
          .eq("is_shell", false)
          .is("deleted_at", null)
          .order("name");
        if (allowedIds) query = query.in("id", allowedIds);
        const { data, error } = await query;
        if (error) throw error;
        return (data ?? [])
          .filter((team) => team.lifecycle_status !== "archived")
          .map((team) => ({ id: team.id, name: team.name }));
      },
      icp: async (ctx) => {
        const { listLiveMembershipTeams } = await import("@/live/features/membership");
        const rows = await listLiveMembershipTeams(ctx, clubId);
        return scopeDutyTeamOptions(filterDutyTeamOptions(rows as any), allowedIds);
      },
    }, { clubId });
    },
  });

  if (!clubId) return null;
  if (readOnly) {
    if (!value) return null;
    return <p className="text-sm">Team on duty: {teams.find((team) => team.id === value)?.name ?? "Unavailable team"}</p>;
  }
  return (
    <div className="space-y-1.5">
      <Label>Team on duty</Label>
      <Select
        value={value && teams.some((team) => team.id === value) ? value : NO_TEAM}
        onValueChange={(next) => {
          if (next === NO_TEAM) onChange(null);
          else if (teams.some((team) => team.id === next)) onChange(next);
        }}
        disabled={disabled}
      >
        <SelectTrigger aria-label="Team on duty"><SelectValue placeholder="No team on duty" /></SelectTrigger>
        <SelectContent>
          <SelectItem value={NO_TEAM}>No team on duty</SelectItem>
          {teams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <p className="text-xs text-muted-foreground">The whole team and linked parents receive a reminder 24 hours before the event.</p>
    </div>
  );
}

export function EventDutyTeamAssignment({
  eventId,
  clubId,
  teamId: eventTeamId,
  targetTeamIds,
  canEdit,
}: {
  eventId: string;
  clubId: string;
  teamId?: string | null;
  targetTeamIds?: string[] | null;
  canEdit: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const { data: teamId = null } = useQuery({
    queryKey: ["event-duty-team", eventId],
    queryFn: async () => withFeatureBackend("events", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("events")
          .select("duty_team_id")
          .eq("id", eventId)
          .maybeSingle();
        if (error) throw error;
        return data?.duty_team_id ?? null;
      },
      icp: async (ctx) => {
        const { getLiveEventDutyTeam } = await import("@/live/features/events");
        return getLiveEventDutyTeam(ctx, eventId);
      },
    }, { eventId: eventId }),
  });

  const update = async (nextTeamId: string | null) => {
    setSaving(true);
    try {
      await withFeatureBackend("events", {
        supabase: async () => {
          const { error } = await supabase
            .from("events")
            .update({ duty_team_id: nextTeamId })
            .eq("id", eventId);
          if (error) throw error;
        },
        icp: async (ctx) => {
          const { setLiveEventDutyTeam } = await import("@/live/features/events");
          await setLiveEventDutyTeam(ctx, eventId, nextTeamId);
        },
      }, { eventId: eventId });
      await queryClient.invalidateQueries({ queryKey: ["event-duty-team", eventId] });
      toast({ title: "Duty team updated" });
    } catch (error) {
      toast({ title: "Could not update duty team", description: error instanceof Error ? error.message : "Update failed", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  if (!canEdit && !teamId) return null;
  return (
    <section className="space-y-2">
      {canEdit ? (
        <DutyTeamPicker clubId={clubId} teamId={eventTeamId} targetTeamIds={targetTeamIds} value={teamId} onChange={update} disabled={saving} />
      ) : (
        <DutyTeamPicker clubId={clubId} value={teamId} onChange={() => undefined} readOnly />
      )}
    </section>
  );
}