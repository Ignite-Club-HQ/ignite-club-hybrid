import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Trash2, Loader2, CalendarOff } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { format } from "date-fns";

interface Pause {
  id: string;
  starts_at: string;
  ends_at: string;
  label: string | null;
}

/**
 * Manage holiday / break windows during which the team's training default
 * RSVPs do NOT auto-apply (Phase 3 of recurring RSVP).
 */
export default function TeamTrainingPausesCard({ teamId }: { teamId: string }) {
  const qc = useQueryClient();
  const [starts, setStarts] = useState("");
  const [ends, setEnds] = useState("");
  const [label, setLabel] = useState("");

  const { data: pauses = [], isLoading } = useQuery({
    queryKey: ["team-training-pauses", teamId],
    queryFn: async (): Promise<Pause[]> => {
      const { data, error } = await supabase
        .from("team_training_pauses")
        .select("id, starts_at, ends_at, label")
        .eq("team_id", teamId)
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as Pause[];
    },
    enabled: !!teamId,
  });

  const add = useMutation({
    mutationFn: async () => {
      if (!starts || !ends) throw new Error("Pick start and end dates");
      const { data: { user } } = await supabase.auth.getUser();
      const { error } = await supabase.from("team_training_pauses").insert({
        team_id: teamId,
        starts_at: new Date(starts).toISOString(),
        ends_at: new Date(ends).toISOString(),
        label: label.trim() || null,
        created_by: user?.id ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setStarts(""); setEnds(""); setLabel("");
      qc.invalidateQueries({ queryKey: ["team-training-pauses", teamId] });
      toast({ description: "Break added — training defaults won't auto-apply during this window." });
    },
    onError: (e: any) => toast({ description: e.message ?? "Couldn't add break", variant: "destructive" }),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("team_training_pauses").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["team-training-pauses", teamId] }),
  });

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div className="flex items-center gap-2">
          <CalendarOff className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-medium">Training breaks</h3>
        </div>
        <p className="text-xs text-muted-foreground -mt-2">
          During a break window, parents on default RSVP won't be auto-marked Going for new training events.
        </p>

        <div className="space-y-2 rounded-md border p-3">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-xs">Starts</Label>
              <Input type="datetime-local" value={starts} onChange={(e) => setStarts(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Ends</Label>
              <Input type="datetime-local" value={ends} onChange={(e) => setEnds(e.target.value)} />
            </div>
          </div>
          <div>
            <Label className="text-xs">Label (optional)</Label>
            <Input placeholder="School holidays" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button
            size="sm"
            onClick={() => add.mutate()}
            disabled={add.isPending || !starts || !ends}
            className="w-full"
          >
            {add.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Add break"}
          </Button>
        </div>

        {isLoading ? (
          <div className="text-sm text-muted-foreground">Loading…</div>
        ) : pauses.length === 0 ? (
          <div className="text-sm text-muted-foreground">No breaks scheduled.</div>
        ) : (
          <ul className="space-y-2">
            {pauses.map((p) => (
              <li key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                <div className="text-sm">
                  <div className="font-medium">{p.label ?? "Break"}</div>
                  <div className="text-xs text-muted-foreground">
                    {format(new Date(p.starts_at), "d MMM yyyy")} → {format(new Date(p.ends_at), "d MMM yyyy")}
                  </div>
                </div>
                <Button
                  size="icon"
                  variant="ghost"
                  onClick={() => remove.mutate(p.id)}
                  disabled={remove.isPending}
                  aria-label="Remove break"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
