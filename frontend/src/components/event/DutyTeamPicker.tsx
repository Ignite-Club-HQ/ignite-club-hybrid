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

export function DutyTeamPicker({
  clubId,
  value,
  onChange,
  disabled = false,
  readOnly = false,
}: {
  clubId: string | null | undefined;
  value: string | null;
  onChange: (teamId: string | null) => void;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const { data: teams = [] } = useQuery({
    queryKey: ["active-club-teams-for-duty", clubId],
    enabled: !!clubId,
    queryFn: async () => withFeatureBackend("membership", {
      supabase: async () => {
        const { data, error } = await supabase
          .from("teams")
          .select("id, name, is_archived, is_shell, deleted_at, lifecycle_status")
          .eq("club_id", clubId!)
          .eq("is_archived", false)
          .eq("is_shell", false)
          .is("deleted_at", null)
          .order("name");
        if (error) throw error;
        return (data ?? [])
          .filter((team) => team.lifecycle_status !== "archived")
          .map((team) => ({ id: team.id, name: team.name }));
      },
      icp: async (ctx) => {
        const { listLiveMembershipTeams } = await import("@/live/features/membership");
        const rows = await listLiveMembershipTeams(ctx, clubId!);
        return rows
          .filter((team: any) => team.is_active && !team.archived && !team.is_shell && !team.deleted_at_ms)
          .map((team: any) => ({ id: team.id, name: team.name }));
      },
    }, { clubId: clubId! }),
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
        onValueChange={(next) => onChange(next === NO_TEAM ? null : next)}
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
  canEdit,
}: {
  eventId: string;
  clubId: string;
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
        <DutyTeamPicker clubId={clubId} value={teamId} onChange={update} disabled={saving} />
      ) : (
        <DutyTeamPicker clubId={clubId} value={teamId} onChange={() => undefined} readOnly />
      )}
    </section>
  );
}