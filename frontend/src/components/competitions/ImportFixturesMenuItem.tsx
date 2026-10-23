import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, Download, Loader2, AlertTriangle, Check } from "lucide-react";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { competitionFixtureKey, deriveImportedFinalsLabel, getCompetitionFinalsLabel } from "@/lib/competitionFinalsLabel";

const TEMPLATE =
  "Date,Time,Round,Home,Away,Location,Pitch,Division\n" +
  "04/10/2026,09:00,1,Tangerinas,Blue,Bridgewater Oval,Pitch 1 - North field (near canteen),\n" +
  "04/10/2026,09:00,1,Red,Green,Bridgewater Oval,Pitch 2 - South field (far end),\n";

/** Minimal CSV/TSV parser supporting quoted fields. */
export function parseDelimited(text: string): string[][] {
  const firstLine = text.split(/\r?\n/)[0] ?? "";
  const delim = firstLine.includes("\t") ? "\t" : firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') inQuotes = false;
      else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delim) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim())) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim())) rows.push(row);
  return rows.map((r) => r.map((f) => f.trim()));
}

/** Parses DD/MM/YYYY, D-M-YY or YYYY-MM-DD plus "HH:MM" / "h:mm pm". Local time. */
export function parseDateTime(dateStr: string, timeStr: string): Date | null {
  let y: number, m: number, d: number;
  const iso = dateStr.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  const dmy = dateStr.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (iso) { y = +iso[1]; m = +iso[2]; d = +iso[3]; }
  else if (dmy) { d = +dmy[1]; m = +dmy[2]; y = +dmy[3]; if (y < 100) y += 2000; }
  else return null;
  let hh = 0, mm = 0;
  if (timeStr) {
    const t = timeStr.toLowerCase().replace(/\s+/g, "").match(/^(\d{1,2})(?:[:.](\d{2}))?(am|pm)?$/);
    if (!t) return null;
    hh = +t[1]; mm = t[2] ? +t[2] : 0;
    if (t[3] === "pm" && hh < 12) hh += 12;
    if (t[3] === "am" && hh === 12) hh = 0;
    if (hh > 23 || mm > 59) return null;
  }
  const dt = new Date(y, m - 1, d, hh, mm);
  if (dt.getMonth() !== m - 1 || dt.getDate() !== d) return null;
  return dt;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

const HEADER_ALIASES: Record<string, string[]> = {
  date: ["date", "match date", "day"],
  time: ["time", "kick off", "kickoff", "start", "start time"],
  round: ["round", "rd", "round number", "round name", "stage", "match", "match type", "fixture", "game", "game type"],
  home: ["home", "team for", "for", "home team", "team 1", "team a", "team", "team name", "my team", "our team", "club team", "home team name", "home side"],
  away: ["away", "team against", "against", "away team", "opponent", "opponents", "opposition", "opponent team", "vs", "versus", "team 2", "team b", "away team name", "away side"],
  location: ["location", "venue", "ground", "address"],
  pitch: ["pitch", "field", "court", "pitch description"],
  division: ["division", "grade", "pool"],
  notes: ["notes", "note", "comments", "comment", "description", "details", "info"],
};

interface ParsedRow {
  line: number;
  errors: string[];
  scheduledAt: Date | null;
  round: number | null;
  finalsLabel: string | null;
  homeId: string | null;
  awayId: string | null;
  homeName: string;
  awayName: string;
  venue: string;
  pitch: string;
  divisionId: string | null;
  fileNotes: string;
  duplicate: false | "existing" | "file";
}

async function fetchExistingKeys(competitionId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from("competition_matches")
    .select("scheduled_at, home_team_id, away_team_id, venue, pitch_number, notes")
    .eq("competition_id", competitionId)
    .not("scheduled_at", "is", null)
    .limit(5000);
  if (error) throw error;
  return (data ?? []).map((m: any) => competitionFixtureKey({
    scheduledAt: m.scheduled_at, homeId: m.home_team_id, awayId: m.away_team_id, venue: m.venue, pitch: m.pitch_number,
    finalsLabel: getCompetitionFinalsLabel(m.notes),
  }));
}

const rowKey = (r: ParsedRow) => competitionFixtureKey({
  scheduledAt: r.scheduledAt!, homeId: r.homeId, awayId: r.awayId, venue: r.venue || null, pitch: r.pitch || null,
  finalsLabel: r.finalsLabel,
});

/** Menu entry only. The sheet must live OUTSIDE the dropdown: opening the
 * native file picker closes the menu, which would unmount the sheet and drop
 * the chosen file silently. */
export function ImportFixturesMenuItem({ onOpen }: { onOpen: () => void }) {
  return (
    <DropdownMenuItem onSelect={() => setTimeout(onOpen, 0)}>
      <Upload className="h-4 w-4 mr-2" /> Import fixtures
    </DropdownMenuItem>
  );
}

export function ImportFixturesSheet({ competitionId, entries, divisions, open, setOpen }: { competitionId: string; entries: any[]; divisions: any[]; open: boolean; setOpen: (o: boolean) => void }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);

  const accepted = entries.filter((e: any) => e.status === "accepted" && e.teams);

  // Existing fixtures, used to stop the same games being imported twice.
  const { data: existingKeys } = useQuery({
    queryKey: ["competition-match-keys", competitionId],
    enabled: open,
    staleTime: 0,
    gcTime: 0,
    refetchOnMount: "always",
    queryFn: () => fetchExistingKeys(competitionId),
  });

  const parsed = useMemo<{ rows: ParsedRow[]; headerError: string | null }>(() => {
    if (!text.trim()) return { rows: [], headerError: null };
    const grid = parseDelimited(text);
    if (grid.length < 2) return { rows: [], headerError: "Add a header row and at least one fixture." };
    const header = grid[0].map(norm);
    const col: Record<string, number> = {};
    for (const [key, aliases] of Object.entries(HEADER_ALIASES)) {
      col[key] = header.findIndex((h) => aliases.includes(h));
    }
    const missing = ["date", "home", "away"].filter((k) => col[k] < 0);
    if (missing.length) {
      const found = grid[0].map((h) => h.trim()).filter(Boolean).join(", ");
      return { rows: [], headerError: `Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. The first row must be headings — found: ${found || "(empty)"}. Rename your team columns to "Home" and "Away".` };
    }
    const get = (r: string[], k: string) => (col[k] >= 0 ? r[col[k]] ?? "" : "");
    const findTeam = (name: string) => {
      const n = norm(name);
      const hit = accepted.find((e: any) => norm(e.teams.name) === n);
      return hit ?? null;
    };
    // Blank or "TBD" teams are allowed (e.g. finals where standings aren't known yet)
    const isTbd = (name: string) => !name.trim() || norm(name) === "tbd";
    const rows = grid.slice(1).map((r, i): ParsedRow => {
      const errors: string[] = [];
      const homeName = get(r, "home");
      const awayName = get(r, "away");
      const homeTbd = isTbd(homeName);
      const awayTbd = isTbd(awayName);
      const home = homeTbd ? null : findTeam(homeName);
      const away = awayTbd ? null : findTeam(awayName);
      if (!homeTbd && !home) errors.push(`"${homeName}" isn't an accepted team`);
      if (!awayTbd && !away) errors.push(`"${awayName}" isn't an accepted team`);
      if (home && away && home.teams.id === away.teams.id) errors.push("Home and away are the same team");
      const scheduledAt = parseDateTime(get(r, "date"), get(r, "time"));
      if (!scheduledAt) errors.push("Date/time not recognised (use DD/MM/YYYY and HH:MM)");
      const teamCols = new Set([col.home, col.away]);
      const finalsLabel = deriveImportedFinalsLabel(get(r, "round"), r.filter((_, ci) => !teamCols.has(ci)));
      let roundRaw = get(r, "round").replace(/[^0-9]/g, "");
      if (!roundRaw && !finalsLabel) {
        // No round column: look for "Round 3" / "Rd 3" / "R3" in title, notes or other cells.
        for (let ci = 0; ci < r.length && !roundRaw; ci++) {
          if (teamCols.has(ci)) continue;
          const m = String(r[ci] ?? "").match(/\b(?:round|rd|r)\s*\.?\s*(\d{1,3})\b/i);
          if (m) roundRaw = m[1];
        }
      }
      const round = roundRaw ? Number(roundRaw) : null;
      let divisionId: string | null = null;
      const divName = get(r, "division");
      if (divName) {
        const div = divisions.find((d: any) => norm(d.name) === norm(divName));
        if (!div) errors.push(`Division "${divName}" not found`);
        else divisionId = div.id;
      } else if (home?.division_id && home.division_id === away?.division_id) {
        divisionId = home.division_id;
      }
      return {
        line: i + 2, errors, scheduledAt, round, finalsLabel,
        homeId: home?.teams.id ?? null, awayId: away?.teams.id ?? null,
        homeName: home?.teams.name ?? (homeTbd ? "TBD" : homeName), awayName: away?.teams.name ?? (awayTbd ? "TBD" : awayName),
        venue: get(r, "location"), pitch: get(r, "pitch"), divisionId,
        fileNotes: get(r, "notes").trim(), duplicate: false,
      };
    });
    // Flag rows already in the competition, or repeated earlier in the same file.
    const existing = new Set(existingKeys ?? []);
    const seen = new Set<string>();
    for (const row of rows) {
      if (row.errors.length || !row.scheduledAt) continue;
      const key = rowKey(row);
      if (existing.has(key)) row.duplicate = "existing";
      else if (seen.has(key)) row.duplicate = "file";
      else seen.add(key);
    }
    return { rows, headerError: null };
  }, [text, accepted, divisions, existingKeys]);

  const errorCount = parsed.rows.filter((r) => r.errors.length).length;
  const duplicateCount = parsed.rows.filter((r) => r.duplicate).length;
  const existingDupCount = parsed.rows.filter((r) => r.duplicate === "existing").length;
  const fileDupCount = parsed.rows.filter((r) => r.duplicate === "file").length;
  const newCount = parsed.rows.length - duplicateCount;
  const canImport = parsed.rows.length > 0 && newCount > 0 && errorCount === 0 && !parsed.headerError && existingKeys !== undefined;

  const onFile = async (file: File) => {
    if (!/\.(csv|tsv|txt)$/i.test(file.name)) {
      toast({ title: "Please use a CSV file", description: "In Excel or Google Sheets choose File → Save as / Download → CSV.", variant: "destructive" });
      return;
    }
    setText(await file.text());
  };

  const downloadTemplate = () => {
    const blob = new Blob([TEMPLATE], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "fixtures-template.csv"; a.click();
    URL.revokeObjectURL(url);
  };

  const submit = async () => {
    if (!canImport) return;
    if (parsed.rows.some((r) => !r.scheduledAt)) return;
    setSaving(true);
    // Re-check against the latest fixtures so a double tap or a second admin can't duplicate games.
    let fresh: Set<string>;
    try {
      fresh = new Set(await fetchExistingKeys(competitionId));
    } catch {
      setSaving(false);
      toast({ title: "Couldn't check existing fixtures", description: "Nothing was saved. Please try again.", variant: "destructive" });
      return;
    }
    const toInsert = parsed.rows.filter((r) => {
      if (!r.scheduledAt) return false;
      const key = rowKey(r);
      if (fresh.has(key)) return false;
      fresh.add(key);
      return true;
    });
    if (toInsert.length === 0) {
      setSaving(false);
      toast({ title: "Nothing new to import", description: "These fixtures are already in the competition." });
      qc.invalidateQueries({ queryKey: ["competition-match-keys", competitionId] });
      return;
    }
    const skipped = parsed.rows.length - toInsert.length;
    const rows = toInsert.flatMap((r) => r.scheduledAt ? [{
      competition_id: competitionId,
      division_id: r.divisionId,
      round_number: r.round,
      notes: [r.finalsLabel, r.fileNotes].filter(Boolean).join(" · ") || null,
      home_team_id: r.homeId,
      away_team_id: r.awayId,
      status: "scheduled",
      created_by: user?.id ?? null,
      scheduled_at: r.scheduledAt.toISOString(),
      venue: r.venue || null,
      pitch_number: r.pitch || null,
    }] : []);
    const { error } = await supabase.from("competition_matches").insert(rows);
    setSaving(false);
    if (error) {
      const raw = (error.message || "").toLowerCase();
      toast({
        title: "Couldn't import fixtures",
        description: raw.includes("permission") || raw.includes("row-level")
          ? "You don't have permission to add fixtures to this competition."
          : "Nothing was saved. Please check the file and try again.",
        variant: "destructive",
      });
      return;
    }
    toast({
      title: `Imported ${rows.length} fixture${rows.length === 1 ? "" : "s"}`,
      description: skipped ? `${skipped} already existed and ${skipped === 1 ? "was" : "were"} skipped.` : undefined,
    });
    qc.invalidateQueries({ queryKey: ["competition-matches", competitionId] });
    qc.invalidateQueries({ queryKey: ["competition-match-keys", competitionId] });
    setText("");
    setOpen(false);
  };

  return (
    <>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-3xl px-5 pb-8">
          <SheetHeader className="mb-4">
            <SheetTitle className="text-xl font-bold">Import fixtures</SheetTitle>
            <SheetDescription>
              Upload a CSV (or paste from a spreadsheet) with columns: Date, Time, Round, Home, Away, Location, Pitch. Division is optional. Team names must match accepted teams — or leave a team blank or write TBD for games like finals where the teams aren't known yet. Each row's Pitch text is saved as that fixture's pitch description.
            </SheetDescription>
          </SheetHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={downloadTemplate}>
                <Download className="h-4 w-4 mr-2" /> Download template
              </Button>
              <Button variant="outline" size="sm" asChild>
                <label className="cursor-pointer">
                  <Upload className="h-4 w-4 mr-2" /> Choose CSV file
                  <input type="file" accept=".csv,.tsv,.txt,text/csv" className="hidden"
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
                </label>
              </Button>
            </div>
            <div>
              <Label>Or paste rows here</Label>
              <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)}
                placeholder={"Date,Time,Round,Home,Away,Location,Pitch\n04/10/2026,09:00,1,Tangerinas,Blue,Bridgewater Oval,Pitch 1 - North field"}
                className="font-mono text-xs" />
            </div>

            {parsed.headerError && (
              <p className="text-sm text-destructive flex items-center gap-2"><AlertTriangle className="h-4 w-4" />{parsed.headerError}</p>
            )}

            {parsed.rows.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm font-medium">
                  {parsed.rows.length} fixture{parsed.rows.length === 1 ? "" : "s"} found
                  {errorCount > 0 && <span className="text-destructive"> · {errorCount} need fixing</span>}
                  {existingDupCount > 0 && <span className="text-muted-foreground"> · {existingDupCount} already imported (will be skipped)</span>}
                  {fileDupCount > 0 && <span className="text-muted-foreground"> · {fileDupCount} repeated in file (will be skipped)</span>}
                </p>
                <div className="rounded-md border divide-y max-h-72 overflow-y-auto">
                  {parsed.rows.map((r) => (
                    <div key={r.line} className="p-2 text-xs">
                      <div className="flex items-center gap-2">
                        {r.errors.length ? <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" /> : r.duplicate ? <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground shrink-0" /> : <Check className="h-3.5 w-3.5 text-primary shrink-0" />}
                        <span className="font-medium">
                          {r.finalsLabel ? `${r.finalsLabel} · ` : r.round != null ? `R${r.round} · ` : ""}{r.homeName} vs {r.awayName}
                        </span>
                      </div>
                      <div className="text-muted-foreground pl-5">
                        {r.scheduledAt ? r.scheduledAt.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "—"}
                        {r.venue && ` · ${r.venue}`}{r.pitch && ` · ${r.pitch}`}
                      </div>
                      {r.duplicate && <div className="text-muted-foreground pl-5">{r.duplicate === "file" ? "Same game appears earlier in this file — will be skipped" : "Already in this competition — won't be imported again"}</div>}
                      {r.errors.map((e) => (
                        <div key={e} className="text-destructive pl-5">Row {r.line}: {e}</div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <Button className="w-full" disabled={!canImport || saving} onClick={submit}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {parsed.rows.length > 0 && newCount === 0 && errorCount === 0
                ? "All fixtures already imported"
                : <>Import {newCount || ""} fixture{newCount === 1 ? "" : "s"}</>}
            </Button>
            <p className="text-[11px] text-muted-foreground">
              While the competition is in Draft, imported fixtures stay private. When published, they become games in both teams' schedules.
            </p>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
