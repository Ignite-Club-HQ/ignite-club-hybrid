import { useState } from "react";
import { Trophy } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { AddressAutocomplete } from "@/components/AddressAutocomplete";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";
import { buildFinalsSeedPairings, type FinalsFormat } from "@/lib/competitionScheduler";

export interface CompetitionFixturesSupabaseClient {
  from: (table: string) => any;
}

interface AddFinalsRoundMenuItemProps {
  competitionId: string;
  divisions: any[];
  supabaseClient: CompetitionFixturesSupabaseClient;
}

export function AddFinalsRoundMenuItem({
  competitionId,
  divisions,
  supabaseClient,
}: AddFinalsRoundMenuItemProps) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const [divisionId, setDivisionId] = useState<string>("");
  const [format, setFormat] = useState<FinalsFormat>("gf");
  const [date, setDate] = useState<string>("");
  const [time, setTime] = useState<string>("09:00");
  const [duration, setDuration] = useState<string>("60");
  const [venue, setVenue] = useState<string>("");
  const [pitchInput, setPitchInput] = useState<string>("");
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setDivisionId(""); setFormat("gf"); setDate(""); setTime("09:00");
    setDuration("60"); setVenue(""); setPitchInput("");
  };

  const submit = async () => {
    if (!date) {
      toast({ title: "Pick a finals date", variant: "destructive" });
      return;
    }
    if (!venue.trim()) {
      toast({ title: "Venue is required", variant: "destructive" });
      return;
    }
    setSaving(true);

    let q = supabaseClient
      .from("competition_matches")
      .select("round_number")
      .eq("competition_id", competitionId)
      .order("round_number", { ascending: false, nullsFirst: false })
      .limit(1);
    if (divisionId) q = q.eq("division_id", divisionId);
    else q = q.is("division_id", null);
    const { data: existing, error: existingError } = await q;
    if (existingError) {
      setSaving(false);
      toast({
        title: "Couldn't add finals",
        description: "We couldn't work out the next round number. Please try again.",
        variant: "destructive",
      });
      return;
    }
    const nextRound = (existing?.[0]?.round_number ?? 0) + 1;

    const pairs = buildFinalsSeedPairings(format);
    const pitchLabels = pitchInput
      .split(/[,\n]/)
      .map((s) => s.trim())
      .filter(Boolean);
    const usePitches = pitchLabels.length > 0 ? pitchLabels : Array.from({ length: pairs.length }, (_, i) => String(i + 1));
    const dur = Math.max(1, Number(duration) || 60);
    const [hh, mm] = time.split(":").map(Number);
    const baseStart = new Date(`${date}T00:00:00`);
    baseStart.setHours(hh || 9, mm || 0, 0, 0);

    const rows = pairs.map((p, idx) => {
      const wave = Math.floor(idx / usePitches.length);
      const pitch = usePitches[idx % usePitches.length];
      const start = new Date(baseStart.getTime() + wave * dur * 60_000);
      return {
        competition_id: competitionId,
        division_id: divisionId || null,
        round_number: nextRound,
        home_team_id: null,
        away_team_id: null,
        status: "scheduled" as const,
        created_by: user?.id ?? null,
        scheduled_at: start.toISOString(),
        venue,
        pitch_number: pitch,
        duration_minutes: dur,
        notes: p.isGrandFinal
          ? `Grand Final · ${p.homeSeed} v ${p.awaySeed}`
          : `Finals · ${p.homeSeed} v ${p.awaySeed}`,
      };
    });

    const { error } = await supabaseClient.from("competition_matches").insert(rows);
    setSaving(false);
    if (error) {
      toast({ title: "Couldn't add finals", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: `Added finals round (${rows.length} match${rows.length === 1 ? "" : "es"})` });
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    reset();
    setOpen(false);
  };

  return (
    <>
      <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setOpen(true); }}>
        <Trophy className="h-4 w-4 mr-2" /> Add finals round
      </DropdownMenuItem>
      <ResponsiveDialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <ResponsiveDialogContent className="max-w-md">
          <ResponsiveDialogHeader>
            <ResponsiveDialogTitle>Add finals round</ResponsiveDialogTitle>
            <ResponsiveDialogDescription>
              Schedules placeholder finals matches. Teams are TBD and locked in once standings are known.
            </ResponsiveDialogDescription>
          </ResponsiveDialogHeader>
          <div className="space-y-3 py-2">
            {divisions.length > 0 && (
              <div>
                <Label>Division (optional)</Label>
                <select
                  value={divisionId || "_all"}
                  onChange={(e) => setDivisionId(e.target.value === "_all" ? "" : e.target.value)}
                  className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
                >
                  <option value="_all">No division</option>
                  {divisions.map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
              </div>
            )}
            <div>
              <Label>Finals format</Label>
              <select
                value={format}
                onChange={(e) => setFormat(e.target.value as FinalsFormat)}
                className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
              >
                <option value="gf">Grand Final only (1 v 2)</option>
                <option value="top4">Top 4 (1v2, 3v4)</option>
                <option value="top6">Top 6 (1v2, 3v4, 5v6)</option>
                <option value="top8">Top 8 (1v2, 3v4, 5v6, 7v8)</option>
              </select>
              <p className="text-xs text-muted-foreground mt-1">
                {buildFinalsSeedPairings(format).length} match{buildFinalsSeedPairings(format).length === 1 ? "" : "es"} will be created.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Date</Label>
                <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <div>
                <Label>First kickoff</Label>
                <Input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
              </div>
              <div>
                <Label>Duration (mins)</Label>
                <Input type="number" inputMode="numeric" min={1} value={duration} onChange={(e) => setDuration(e.target.value)} />
              </div>
              <div>
                <Label>Pitches (optional)</Label>
                <Input value={pitchInput} onChange={(e) => setPitchInput(e.target.value)} placeholder="e.g. 1, 2" />
              </div>
            </div>
            <div>
              <Label>Venue <span className="text-destructive">*</span></Label>
              <AddressAutocomplete
                value={venue}
                onChange={setVenue}
                onSelect={(a) => {
                  const full = [a.address, a.suburb, a.state, a.postcode].filter(Boolean).join(", ");
                  setVenue(full);
                }}
                placeholder="Search venue or address…"
              />
            </div>
          </div>
          <ResponsiveDialogFooter>
            <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submit} disabled={saving}>
              {saving ? "Adding…" : <><Trophy className="h-4 w-4 mr-1" />Add finals</>}
            </Button>
          </ResponsiveDialogFooter>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}
