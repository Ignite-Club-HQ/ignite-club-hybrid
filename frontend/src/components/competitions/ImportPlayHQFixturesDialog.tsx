import { useMemo, useRef, useState } from "react";
import ExcelJS from "exceljs";
import { FileUp, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { parseCsvLine } from "@/lib/csv";
import { isPlayHQFormat, playHQToDriblShape, type PlayHQSkippedRow } from "@/lib/playhqFixtureImport";
import { createGeneratedMatches } from "@/features/competitions/fixtures/matchWorkflows";

interface TeamOption {
  id: string;
  name: string;
}
interface ImportRow {
  id: string;
  externalHome: string;
  externalAway: string;
  date: string;
  time: string;
  round: string;
  grade: string;
  venue: string;
}

function parseWorkbookRows(fileName: string, content: string | ArrayBuffer): Promise<string[][]> {
  if (fileName.endsWith(".csv")) {
    return Promise.resolve((content as string).split(/\r?\n/).filter((line) => line.trim()).map(parseCsvLine));
  }
  return (async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(content as ArrayBuffer);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      rows.push(Array.from({ length: row.cellCount }, (_, index) => {
        const value = row.getCell(index + 1).value;
        return value instanceof Date ? value.toISOString() : String(value ?? "").trim();
      }));
    });
    return rows;
  })();
}

function localScheduledAt(date: string, time: string): string | null {
  const match = date.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!match) return null;
  const timeMatch = time.match(/^(\d{2}):(\d{2})$/);
  if (!timeMatch) return null;
  const value = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]), Number(timeMatch[1]), Number(timeMatch[2]));
  return Number.isNaN(value.getTime()) ? null : value.toISOString();
}

export function ImportPlayHQFixturesDialog({
  competitionId,
  entries,
  divisions,
  existingMatches,
  onImported,
}: {
  competitionId: string;
  entries: any[];
  divisions: any[];
  existingMatches: any[];
  onImported: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [skipped, setSkipped] = useState<PlayHQSkippedRow[]>([]);
  const [fileName, setFileName] = useState("");
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const acceptedTeams = useMemo(() => entries
    .filter((entry) => ["accepted", "registered"].includes(entry.status) && entry.teams?.id && entry.teams?.name)
    .map((entry) => ({ id: entry.teams.id as string, name: entry.teams.name as string } satisfies TeamOption)), [entries]);
  const externalTeams = useMemo(() => Array.from(new Set(rows.flatMap((row) => [row.externalHome, row.externalAway]))), [rows]);
  const mappedRows = rows.filter((row) => mapping[row.externalHome] && mapping[row.externalAway] && mapping[row.externalHome] !== mapping[row.externalAway]);
  const duplicateRows = mappedRows.filter((row) => {
    const scheduledAt = localScheduledAt(row.date, row.time);
    const roundNumber = row.round.match(/round\s*(\d+)/i)?.[1];
    const homeId = mapping[row.externalHome];
    const awayId = mapping[row.externalAway];
    return existingMatches.some((match) => {
      if (match.external_id && match.external_id === row.id) return true;
      if (!scheduledAt || !match.scheduled_at) return false;
      const existingDate = new Date(match.scheduled_at);
      const incomingDate = new Date(scheduledAt);
      const sameLocalDate = existingDate.getFullYear() === incomingDate.getFullYear() &&
        existingDate.getMonth() === incomingDate.getMonth() &&
        existingDate.getDate() === incomingDate.getDate();
      return sameLocalDate && match.home_team_id === homeId && match.away_team_id === awayId &&
        (roundNumber ? Number(match.round_number) === Number(roundNumber) : match.round_number == null);
    });
  });
  const duplicateIds = new Set(duplicateRows.map((row) => row.id));
  const importableRows = mappedRows.filter((row) => !duplicateIds.has(row.id));
  const unmappedCount = rows.length - mappedRows.length;

  const reset = () => {
    setRows([]);
    setSkipped([]);
    setFileName("");
    setMapping({});
    if (inputRef.current) inputRef.current.value = "";
  };

  const readFile = async (file: File) => {
    setRows([]);
    setSkipped([]);
    setMapping({});
    const content = file.name.toLowerCase().endsWith(".csv")
      ? await file.text()
      : await file.arrayBuffer();
    const sourceRows = await parseWorkbookRows(file.name.toLowerCase(), content);
    if (sourceRows.length < 2) throw new Error("Choose a fixture file with a header and at least one match.");
    const headers = sourceRows[0];
    if (!isPlayHQFormat(headers)) throw new Error("This does not look like a PlayHQ advanced fixture export.");
    const parsed = playHQToDriblShape(headers, sourceRows.slice(1).map((row) => row.map(String)));
    const outputIndex = (name: string) => parsed.headers.indexOf(name);
    const get = (row: string[], name: string) => row[outputIndex(name)] ?? "";
    const nextRows = parsed.rows.map((row): ImportRow => ({
      id: get(row, "Identifier"),
      externalHome: get(row, "Home Team"),
      externalAway: get(row, "Away Team"),
      date: get(row, "Date"),
      time: get(row, "Start"),
      round: get(row, "Round"),
      grade: get(row, "Age Group"),
      venue: [get(row, "Ground"), get(row, "Field")].filter(Boolean).join(" · "),
    }));
    setRows(nextRows);
    setSkipped(parsed.skipped);
    setFileName(file.name);
    const initial: Record<string, string> = {};
    for (const label of new Set(nextRows.flatMap((row) => [row.externalHome, row.externalAway]))) {
      const exact = acceptedTeams.find((team) => team.name.toLowerCase() === label.toLowerCase());
      if (exact) initial[label] = exact.id;
    }
    setMapping(initial);
  };

  const save = async () => {
    if (importableRows.length === 0) return;
    setSaving(true);
    try {
      const importRows = importableRows.map((row) => {
        const division = divisions.find((item) => String(item.name).toLowerCase() === row.grade.toLowerCase());
        const round = row.round.match(/round\s*(\d+)/i)?.[1];
        return {
          competition_id: competitionId,
          home_team_id: mapping[row.externalHome],
          away_team_id: mapping[row.externalAway],
          division_id: division?.id ?? null,
          round_number: round ? Number(round) : null,
          scheduled_at: localScheduledAt(row.date, row.time),
          venue: row.venue || null,
          status: "scheduled",
          source: "playhq",
          external_id: row.id,
        };
      });
      const { error } = await createGeneratedMatches(importRows);
      if (error) throw new Error(error.message);
      toast({ title: "Fixtures imported", description: `${importRows.length} PlayHQ fixtures added.` });
      onImported();
      reset();
      setOpen(false);
    } catch (error) {
      toast({ title: "Import failed", description: error instanceof Error ? error.message : "Could not import fixtures.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => {
      if (saving) return;
      setOpen(nextOpen);
      if (!nextOpen) reset();
    }}>
      <DialogTrigger asChild>
        <DropdownMenuItem onSelect={(event) => event.preventDefault()}>
          <FileUp className="mr-2 h-4 w-4" /> Import PlayHQ fixtures
        </DropdownMenuItem>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Import PlayHQ fixtures</DialogTitle>
          <DialogDescription>Upload an advanced fixture export, map its teams to accepted competition entries, and review skipped rows before import.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <Input ref={inputRef} type="file" accept=".csv,.xlsx" aria-label="PlayHQ fixture file" onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) void readFile(file).catch((error) => toast({ title: "Could not read fixtures", description: error instanceof Error ? error.message : "Invalid file.", variant: "destructive" }));
          }} />
          {fileName && <p className="text-xs text-muted-foreground">{fileName} · {rows.length} playable rows · {skipped.length} skipped</p>}
          {externalTeams.map((label) => (
            <div key={label} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] items-center gap-3">
              <Label className="truncate" title={label}>{label}</Label>
              <Select value={mapping[label] ?? ""} onValueChange={(teamId) => setMapping((current) => ({ ...current, [label]: teamId }))}>
                <SelectTrigger aria-label={`Map ${label}`}><SelectValue placeholder="Choose team" /></SelectTrigger>
                <SelectContent>{acceptedTeams.map((team) => <SelectItem key={team.id} value={team.id}>{team.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          ))}
          {rows.length > 0 && (
            <div className="rounded-md border divide-y max-h-52 overflow-y-auto">
              {rows.slice(0, 12).map((row) => <p key={row.id} className="p-2 text-xs text-muted-foreground">{row.round}: {row.externalHome} vs {row.externalAway} · {row.date} {row.time || "time TBD"}</p>)}
              {rows.length > 12 && <p className="p-2 text-xs text-muted-foreground">And {rows.length - 12} more fixtures.</p>}
            </div>
          )}
          {skipped.length > 0 && <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1"><p className="font-medium">Skipped rows</p>{skipped.slice(0, 5).map((item) => <p key={`${item.row}:${item.message}`}>Row {item.row}: {item.message}</p>)}</div>}
          {unmappedCount > 0 && rows.length > 0 && <p className="text-xs text-amber-700">{unmappedCount} row{unmappedCount === 1 ? "" : "s"} will be skipped until both teams are mapped to different accepted teams.</p>}
          {duplicateRows.length > 0 && <p className="text-xs text-amber-700">{duplicateRows.length} fixture{duplicateRows.length === 1 ? " is" : "s are"} already present and will be skipped.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={saving}>Cancel</Button>
          <Button onClick={() => void save()} disabled={saving || importableRows.length === 0}>
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Import {importableRows.length} fixtures
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
