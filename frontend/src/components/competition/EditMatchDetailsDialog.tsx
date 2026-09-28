import { useState } from "react";
import { format } from "date-fns";
import { Loader2, Save } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

export interface CompetitionMatchSupabaseClient {
  from: (table: string) => any;
}

interface EditMatchDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  match: any;
  competitionId: string;
  entries: any[];
  divisions: any[];
  supabaseClient: CompetitionMatchSupabaseClient;
}

export function EditMatchDetailsDialog({
  open,
  onOpenChange,
  match,
  competitionId,
  entries,
  divisions,
  supabaseClient,
}: EditMatchDetailsDialogProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const accepted = entries.filter((e: any) => e.status === "accepted");
  const initialDate = match.scheduled_at ? new Date(match.scheduled_at) : null;
  const [homeId, setHomeId] = useState<string>(match.home_team_id ?? "");
  const [awayId, setAwayId] = useState<string>(match.away_team_id ?? "");
  const [divisionId, setDivisionId] = useState<string>(match.division_id ?? "");
  const [dateStr, setDateStr] = useState(initialDate ? format(initialDate, "yyyy-MM-dd") : "");
  const [timeStr, setTimeStr] = useState(initialDate ? format(initialDate, "HH:mm") : "09:00");
  const [venue, setVenue] = useState<string>(match.venue ?? "");
  const [pitch, setPitch] = useState<string>(match.pitch_number ?? "");
  const [round, setRound] = useState<string>(match.round_number != null ? String(match.round_number) : "");
  const [duration, setDuration] = useState<string>(match.duration_minutes != null ? String(match.duration_minutes) : "");
  const [arrival, setArrival] = useState<string>(match.arrival_minutes_before != null ? String(match.arrival_minutes_before) : "");
  const [notes, setNotes] = useState<string>(match.notes ?? "");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    if (!homeId || !awayId || homeId === awayId) {
      toast({ title: "Pick two different teams", variant: "destructive" });
      return;
    }
    if (!venue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    const scheduledAt = dateStr
      ? new Date(`${dateStr}T${timeStr || "09:00"}:00`).toISOString()
      : match.scheduled_at ?? null;
    setSaving(true);
    const { error } = await supabaseClient.from("competition_matches").update({
      home_team_id: homeId,
      away_team_id: awayId,
      division_id: divisionId || null,
      scheduled_at: scheduledAt,
      venue,
      pitch_number: pitch.trim() || null,
      round_number: round ? Number(round) : null,
      duration_minutes: duration ? Number(duration) : null,
      arrival_minutes_before: arrival ? Number(arrival) : null,
      notes: notes || null,
    }).eq("id", match.id);
    setSaving(false);
    if (error) {
      toast({ title: "Could not update match", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Match updated" });
    onOpenChange(false);
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-ladder", competitionId] });
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Edit match details</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>Updates flow through to the linked team events.</ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            {[
              ["Home team", homeId, setHomeId],
              ["Away team", awayId, setAwayId],
            ].map(([label, value, setter]) => (
              <div key={label as string} className="space-y-1.5">
                <Label>{label as string}</Label>
                <Select value={value as string} onValueChange={setter as (value: string) => void}>
                  <SelectTrigger><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>{accepted.map((e: any) => <SelectItem key={e.team_id} value={e.team_id}>{e.teams?.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </div>
          {divisions.length > 0 && (
            <div className="space-y-1.5">
              <Label>Division (optional)</Label>
              <Select value={divisionId || "_none"} onValueChange={(v) => setDivisionId(v === "_none" ? "" : v)}>
                <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                <SelectContent><SelectItem value="_none">None</SelectItem>{divisions.map((d: any) => <SelectItem key={d.id} value={d.id}>{d.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5"><Label>Date</Label><Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Start time</Label><Input type="time" value={timeStr} onChange={(e) => setTimeStr(e.target.value)} /></div>
            <div className="col-span-2"><Label>Round</Label><Input type="number" inputMode="numeric" min={1} value={round} onChange={(e) => setRound(e.target.value)} /></div>
            <div className="col-span-2">
              <Label>Venue</Label>
              <AddressAutocomplete value={venue} onChange={setVenue} onSelect={(a) => setVenue([a.address, a.suburb, a.state, a.postcode].filter(Boolean).join(", "))} placeholder="Search venue or address…" />
            </div>
            <div className="space-y-1.5"><Label>Pitch / Court #</Label><Input value={pitch} onChange={(e) => setPitch(e.target.value)} placeholder="e.g. 3" /></div>
            <div className="space-y-1.5"><Label>Duration (mins)</Label><Input type="number" inputMode="numeric" min={0} value={duration} onChange={(e) => setDuration(e.target.value)} /></div>
            <div className="space-y-1.5"><Label>Arrive (mins before)</Label><Input type="number" inputMode="numeric" min={0} value={arrival} onChange={(e) => setArrival(e.target.value)} /></div>
            <div className="col-span-2"><Label>Notes</Label><Input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Shown on the team event" /></div>
          </div>
        </div>
        <ResponsiveDialogFooter className="flex-row gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={saving} className="flex-1 min-h-11">Cancel</Button>
          <Button onClick={submit} disabled={saving} className="flex-1 min-h-11">
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Save className="h-4 w-4 mr-1" />}Save
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
