import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";

export type TrainingDefaultStatus = "going" | "not_going";

interface Args {
  teamId: string | null | undefined;
  /** Pass exactly one of childId or userId */
  childId?: string | null;
  userId?: string | null;
}

export interface TrainingDefaultRow {
  id: string;
  default_status: TrainingDefaultStatus;
  team_id: string;
  child_id: string | null;
  user_id: string | null;
  auto_paused_at: string | null;
  auto_paused_reason: string | null;
}

/**
 * Per-(team, child|user) "default training RSVP" row.
 * Phase 1 of recurring RSVP: parents/members can set a default answer that
 * auto-applies to new training events. Override on any single event flips
 * source from 'default' → 'user' and is sticky for that event.
 */
export function useTrainingDefault({ teamId, childId, userId }: Args) {
  const qc = useQueryClient();
  const enabled = !!teamId && (!!childId || !!userId);

  const queryKey = ["training-default", teamId, childId ?? null, userId ?? null];

  const query = useQuery({
    queryKey,
    enabled,
    queryFn: async (): Promise<TrainingDefaultRow | null> => {
      let q = supabase
        .from("child_training_defaults")
        .select("id, default_status, team_id, child_id, user_id, auto_paused_at, auto_paused_reason")
        .eq("team_id", teamId!)
        .is("deleted_at", null);
      q = childId ? q.eq("child_id", childId) : q.eq("user_id", userId!);
      const { data, error } = await q.maybeSingle();
      if (error && (error as any).code !== "PGRST116") throw error;
      return (data as TrainingDefaultRow | null) ?? null;
    },
    staleTime: 60_000,
  });

  const upsert = useMutation({
    mutationFn: async (status: TrainingDefaultStatus) => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("Not authenticated");

      if (query.data) {
        const { error } = await supabase
          .from("child_training_defaults")
          .update({ default_status: status, deleted_at: null, auto_paused_at: null, auto_paused_reason: null })
          .eq("id", query.data.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("child_training_defaults").insert({
          team_id: teamId!,
          child_id: childId ?? null,
          user_id: childId ? null : userId!,
          default_status: status,
          created_by: user.id,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey });
      qc.invalidateQueries({ queryKey: ["event-rsvps"] });
      qc.invalidateQueries({ queryKey: ["event-rsvps-going"] });
    },
    onError: (e: any) => {
      toast({ title: "Couldn't save auto-RSVP", description: e?.message ?? String(e), variant: "destructive" });
    },
  });

  const clear = useMutation({
    mutationFn: async () => {
      if (!query.data) return;
      const { error } = await supabase
        .from("child_training_defaults")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", query.data.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey }),
  });

  return {
    defaultRow: query.data ?? null,
    isLoading: query.isLoading,
    setDefault: upsert.mutate,
    clearDefault: clear.mutate,
    isSaving: upsert.isPending || clear.isPending,
  };
}
