import { useCallback, useRef, useState } from "react";
import { Send, Star } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  CsvFileDropZone,
  CsvFormatGuide,
  CsvImportDialogFrame,
  CsvImportedFile,
  CsvImportIssue,
  CsvIssueSummary,
  CsvTemplateDownloadButton,
  CsvPreviewShell,
  downloadCsvTemplate,
} from "@/components/csv-import/CsvImportPresentation";
import { useToast } from "@/hooks/use-toast";
import { isValidEmail, parseCsvLine } from "@/lib/csv";

interface ParsedPlayer {
  id: string;
  name: string;
  abilityRating: string;
  parentName: string;
  parentEmail: string;
}

interface MiniLeagueMemberCSVImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImport: (players: ParsedPlayer[]) => void;
}

const ABILITY_OPTIONS = [
  { value: "1", label: "1 - Beginner" },
  { value: "2", label: "2 - Developing" },
  { value: "3", label: "3 - Intermediate" },
  { value: "4", label: "4 - Advanced" },
  { value: "5", label: "5 - Expert" },
];
const FORMAT_COLUMNS = ["player_name", "ability_rating", "parent_name", "parent_email"];
const TEMPLATE_CONTENT = `player_name,ability_rating,parent_name,parent_email
Oliver Smith,5,James Smith,redacted@example.invalid
Jack Williams,5,David Williams,redacted@example.invalid
Sophie Taylor,5,Michael Taylor,redacted@example.invalid
Charlie Brown,5,Robert Brown,redacted@example.invalid
Emily Davies,4,John Davies,redacted@example.invalid
Noah Wilson,4,Chris Wilson,redacted@example.invalid
Amelia Evans,4,Paul Evans,redacted@example.invalid
George Thomas,4,Mark Thomas,redacted@example.invalid
Isla Roberts,4,Steve Roberts,redacted@example.invalid
Harry Johnson,3,Andy Johnson,redacted@example.invalid
Mia Walker,3,Dan Walker,redacted@example.invalid
Leo White,3,Tom White,redacted@example.invalid
Ava Harris,3,Matt Harris,redacted@example.invalid
Oscar Clark,3,Ben Clark,redacted@example.invalid
Lily Lewis,3,Sam Lewis,redacted@example.invalid
Freddie Hall,3,Nick Hall,redacted@example.invalid
Ella Young,2,Peter Young,redacted@example.invalid
Alfie King,2,Gary King,redacted@example.invalid
Grace Wright,2,Ian Wright,redacted@example.invalid
Archie Green,2,Simon Green,redacted@example.invalid
Poppy Adams,2,Tim Adams,redacted@example.invalid
Henry Baker,2,Alan Baker,redacted@example.invalid
Rosie Hill,2,Phil Hill,redacted@example.invalid
Max Scott,1,Brian Scott,redacted@example.invalid
Evie Turner,1,Colin Turner,redacted@example.invalid
Jacob Campbell,1,Keith Campbell,redacted@example.invalid
Chloe Mitchell,1,Graham Mitchell,redacted@example.invalid
Finley Carter,1,Wayne Carter,redacted@example.invalid
Hannah Phillips,1,Derek Phillips,redacted@example.invalid
Thomas Parker,1,Neil Parker,redacted@example.invalid`;

export function MiniLeagueMemberCSVImportDialog({ open, onOpenChange, onImport }: MiniLeagueMemberCSVImportDialogProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [parsedPlayers, setParsedPlayers] = useState<ParsedPlayer[]>([]);
  const [errors, setErrors] = useState<CsvImportIssue[]>([]);

  const updatePlayerField = (playerId: string, field: keyof ParsedPlayer, value: string) => {
    setParsedPlayers(previous => previous.map(player => player.id === playerId ? { ...player, [field]: value } : player));
  };
  const isPlayerValid = (player: ParsedPlayer) => player.name.trim().length > 0 && (!player.parentEmail || isValidEmail(player.parentEmail));
  const allPlayersValid = parsedPlayers.every(isPlayerValid);
  const invalidCount = parsedPlayers.filter(player => !isPlayerValid(player)).length;

  const validateAndParse = (content: string): { players: ParsedPlayer[]; errors: CsvImportIssue[] } => {
    const lines = content.trim().split("\n").filter(line => line.trim());
    const players: ParsedPlayer[] = [];
    const parseErrors: CsvImportIssue[] = [];

    if (lines.length === 0) {
      parseErrors.push({ row: 0, message: "File is empty" });
      return { players, errors: parseErrors };
    }

    const hasHeader = lines[0].toLowerCase().includes("player") || lines[0].toLowerCase().includes("name");
    for (let index = hasHeader ? 1 : 0; index < lines.length; index++) {
      const row = index + 1;
      const values = parseCsvLine(lines[index]);
      const name = values[0]?.trim();
      const ability = values[1]?.trim() || "3";
      const parentName = values[2]?.trim() || "";
      const parentEmail = values[3]?.trim() || "";

      if (!name) {
        parseErrors.push({ row, message: "Player name is required" });
        continue;
      }
      if (name.length > 100) {
        parseErrors.push({ row, message: "Name must be less than 100 characters" });
        continue;
      }
      const abilityNumber = parseInt(ability);
      if (isNaN(abilityNumber) || abilityNumber < 1 || abilityNumber > 5) {
        parseErrors.push({ row, message: `Invalid ability rating "${ability}". Must be 1-5` });
        continue;
      }
      if (parentEmail && !isValidEmail(parentEmail)) {
        parseErrors.push({ row, message: `Invalid email format: "${parentEmail}"` });
        continue;
      }
      players.push({ id: crypto.randomUUID(), name, abilityRating: abilityNumber.toString(), parentName, parentEmail });
    }

    const emailCounts = new Map<string, number>();
    players.forEach(player => {
      if (player.parentEmail) {
        const email = player.parentEmail.toLowerCase();
        emailCounts.set(email, (emailCounts.get(email) || 0) + 1);
      }
    });
    emailCounts.forEach((count, email) => {
      if (count > 1) parseErrors.push({ row: 0, message: `Duplicate email: ${email} (${count} times)` });
    });

    return { players, errors: parseErrors };
  };

  const processFile = useCallback((selectedFile: File) => {
    if (!selectedFile.name.toLowerCase().endsWith(".csv")) {
      toast({ title: "Invalid file", description: "Please select a CSV file", variant: "destructive" });
      return;
    }
    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      if (!content) return;
      const { players, errors: parseErrors } = validateAndParse(content);
      setFile(selectedFile);
      setParsedPlayers(players);
      setErrors(parseErrors);
    };
    reader.readAsText(selectedFile);
  }, [toast]);

  const handleClear = () => {
    setFile(null);
    setParsedPlayers([]);
    setErrors([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };
  const handleImport = () => {
    if (parsedPlayers.length === 0) return;
    onImport(parsedPlayers);
    handleClear();
    onOpenChange(false);
  };
  const hasBlockingErrors = errors.some(error => error.row > 0);

  return (
    <CsvImportDialogFrame open={open} onOpenChange={onOpenChange} title="Import Players" description="Upload a CSV file to bulk import players">
      <div className="flex-1 overflow-hidden space-y-4">
        <CsvFormatGuide columns={FORMAT_COLUMNS} onDownloadTemplate={() => downloadCsvTemplate(TEMPLATE_CONTENT, "mini_league_players_template.csv")}>
          <p><strong>player_name:</strong> Required - child&apos;s name</p>
          <p><strong>ability_rating:</strong> 1-5 (1=Beginner, 5=Expert)</p>
          <p><strong>parent_name:</strong> Optional - parent&apos;s name</p>
          <p><strong>parent_email:</strong> Optional - for sending invites</p>
        </CsvFormatGuide>

        {!file ? (
          <div className="space-y-3">
            <CsvTemplateDownloadButton onClick={() => downloadCsvTemplate(TEMPLATE_CONTENT, "mini_league_players_template.csv")} />
            <CsvFileDropZone fileInputRef={fileInputRef} onFile={processFile} contentClassName="py-8" />
          </div>
        ) : (
          <div className="space-y-3 flex-1 overflow-hidden flex flex-col">
            <CsvImportedFile fileName={file.name} onClear={handleClear} />
            <CsvIssueSummary issues={errors} listClassName="list-disc list-inside text-xs" additionalIssuesLabel={count => `...and ${count} more errors`} />
            {parsedPlayers.length > 0 && (
              <CsvPreviewShell
                containerClassName="flex-1 overflow-hidden flex flex-col min-h-0"
                header={(
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm font-medium">{parsedPlayers.length} player{parsedPlayers.length !== 1 ? "s" : ""} found</span>
                    {invalidCount > 0 && <Badge variant="destructive" className="text-xs">{invalidCount} invalid</Badge>}
                  </div>
                )}
                scrollAreaClassName="h-[50vh] max-h-[400px]"
                contentClassName="space-y-2 pr-4 pb-2"
              >
                {parsedPlayers.map((player, index) => {
                  const valid = isPlayerValid(player);
                  return (
                    <div key={player.id} className={`p-3 rounded-lg border ${valid ? "bg-muted/50" : "bg-destructive/10 border-destructive/50"}`}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-xs text-muted-foreground">Player {index + 1}</span>
                        <div className="flex items-center gap-1">
                          {Array.from({ length: parseInt(player.abilityRating) }).map((_, star) => <Star key={star} className="h-3 w-3 fill-amber-400 text-amber-400" />)}
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <Input placeholder="Player name *" value={player.name} onChange={event => updatePlayerField(player.id, "name", event.target.value)} className={!player.name.trim() ? "border-destructive" : ""} />
                        <Select value={player.abilityRating} onValueChange={value => updatePlayerField(player.id, "abilityRating", value)}>
                          <SelectTrigger><SelectValue /></SelectTrigger>
                          <SelectContent>{ABILITY_OPTIONS.map(option => <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>)}</SelectContent>
                        </Select>
                      </div>
                      {(player.parentName || player.parentEmail) && (
                        <div className="grid grid-cols-2 gap-2 mt-2">
                          <Input placeholder="Parent name" value={player.parentName} onChange={event => updatePlayerField(player.id, "parentName", event.target.value)} />
                          <Input type="email" placeholder="Parent email" value={player.parentEmail} onChange={event => updatePlayerField(player.id, "parentEmail", event.target.value)} className={player.parentEmail && !isValidEmail(player.parentEmail) ? "border-destructive" : ""} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </CsvPreviewShell>
            )}
          </div>
        )}
      </div>
      {file && parsedPlayers.length > 0 && (
        <div className="pt-4 border-t">
          <Button className="w-full" onClick={handleImport} disabled={hasBlockingErrors || !allPlayersValid}>
            <Send className="h-4 w-4 mr-2" />
            Add {parsedPlayers.length} Player{parsedPlayers.length !== 1 ? "s" : ""} &amp; Send Invites
          </Button>
        </div>
      )}
    </CsvImportDialogFrame>
  );
}
