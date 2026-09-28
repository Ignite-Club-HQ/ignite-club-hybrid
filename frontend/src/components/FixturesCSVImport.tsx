import { useState, useRef, useCallback } from "react";
import { Upload, FileText, X, AlertCircle, Download, FileSpreadsheet, ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { FixturePreviewEditor } from "@/components/FixturePreviewEditor";
import { DriblImportMapper, isDriblFormat, parseDriblRows } from "@/components/DriblImportMapper";
import { validateFixtureImportAuthorization } from "@/lib/fixtureImportAuthorization";
import ExcelJS from "exceljs";

interface Team {
  id: string;
  name: string;
  level_age?: string | null;
}

interface FixturesCSVImportProps {
  clubId: string;
  clubName?: string;
  teamId?: string;
  teams?: Team[];
  onImportComplete: () => void;
  isClubAdmin?: boolean;
  isProFootball?: boolean; // Required for Dribl imports
}

interface ParsedFixture {
  id: string; // Unique ID for tracking edits
  title: string;
  date: string;
  time: string;
  address?: string;
  description?: string;
  reminderHours?: number;
  teamName?: string;
  teamId?: string;
  existingEventId?: string;
  existingEventTitle?: string;
  existingEventDate?: string;
  opponent?: string;
  isHomeGame?: boolean;
}

interface ValidationError {
  row: number;
  message: string;
}

type ParsedCell = string | number | boolean | Date | null | undefined;
type ParsedRow = ParsedCell[];

// Validation helpers
const isValidDate = (date: string): boolean => {
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const parsed = new Date(date);
  return !isNaN(parsed.getTime());
};

const isValidTime = (time: string): boolean => {
  if (!time) return false;
  const normalized = time.substring(0, 5);
  if (!/^\d{1,2}:\d{2}$/.test(normalized)) return false;
  const [hours, minutes] = normalized.split(':').map(Number);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
};

const isFixtureValid = (fixture: ParsedFixture): boolean => {
  return fixture.title.trim().length > 0 && 
         isValidDate(fixture.date) && 
         isValidTime(fixture.time);
};

const ACCEPTED_FILE_TYPES = ".csv,.xlsx";

export function FixturesCSVImport({ clubId, clubName = '', teamId, teams = [], onImportComplete, isClubAdmin = false, isProFootball = false }: FixturesCSVImportProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedFixtures, setParsedFixtures] = useState<ParsedFixture[]>([]);
  const [duplicateFixtures, setDuplicateFixtures] = useState<ParsedFixture[]>([]);
  const [errors, setErrors] = useState<ValidationError[]>([]);
  const [importing, setImporting] = useState(false);
  const [formatOpen, setFormatOpen] = useState(false);
  const [updateDuplicates, setUpdateDuplicates] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  
  // Dribl-specific state
  const [driblMode, setDriblMode] = useState(false);
  const [driblRawData, setDriblRawData] = useState<{ headers: string[]; rows: string[][] } | null>(null);

  // Per-team exclusion: team names the user has un-checked in the "Will be imported" list
  const [excludedTeams, setExcludedTeams] = useState<Set<string>>(new Set());

  const validateAndParseRows = (rows: ParsedRow[]): { fixtures: ParsedFixture[]; errors: ValidationError[] } => {
    const fixtures: ParsedFixture[] = [];
    const errors: ValidationError[] = [];

    if (rows.length < 2) {
      errors.push({ row: 0, message: "File must have a header row and at least one data row" });
      return { fixtures, errors };
    }

    const header = rows[0].map(h => h?.toString().toLowerCase().trim() || '');
    const requiredColumns = ['title', 'date', 'time'];
    const missingColumns = requiredColumns.filter(col => !header.includes(col));

    if (missingColumns.length > 0) {
      errors.push({ row: 1, message: `Missing required columns: ${missingColumns.join(', ')}` });
      return { fixtures, errors };
    }

    const titleIdx = header.indexOf('title');
    const dateIdx = header.indexOf('date');
    const timeIdx = header.indexOf('time');
    const teamIdx = header.indexOf('team');
    const opponentIdx = header.indexOf('opponent');
    const addressIdx = header.indexOf('address');
    const descriptionIdx = header.indexOf('description');
    const reminderIdx = header.indexOf('reminder_hours');

    const teamNameMap = new Map<string, string>();
    const teamIdNameMap = new Map<string, string>();
    for (const team of teams) {
      teamNameMap.set(team.name.toLowerCase().trim(), team.id);
      teamIdNameMap.set(team.id, team.name);
    }

    for (let i = 1; i < rows.length; i++) {
      const values = rows[i];
      const rowNum = i + 1;

      if (!values || values.every(v => !v || v.toString().trim() === '')) continue;

      const title = values[titleIdx]?.toString().trim() || '';
      let date = values[dateIdx]?.toString().trim() || '';
      let time = values[timeIdx]?.toString().trim() || '';

      // Try to parse Excel date format
      if (values[dateIdx] instanceof Date) {
        const excelDate = values[dateIdx] as Date;
        date = `${excelDate.getFullYear()}-${String(excelDate.getMonth() + 1).padStart(2, '0')}-${String(excelDate.getDate()).padStart(2, '0')}`;
      } else if (typeof values[dateIdx] === 'number') {
        const excelDate = new Date(Date.UTC(1899, 11, 30) + values[dateIdx] * 24 * 60 * 60 * 1000);
        if (!isNaN(excelDate.getTime())) {
          date = `${excelDate.getUTCFullYear()}-${String(excelDate.getUTCMonth() + 1).padStart(2, '0')}-${String(excelDate.getUTCDate()).padStart(2, '0')}`;
        }
      }

      // Try to parse Excel time format
      if (values[timeIdx] instanceof Date) {
        const excelTime = values[timeIdx] as Date;
        time = `${String(excelTime.getHours()).padStart(2, '0')}:${String(excelTime.getMinutes()).padStart(2, '0')}`;
      } else if (typeof values[timeIdx] === 'number') {
        const totalMinutes = Math.round(values[timeIdx] * 24 * 60);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        time = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
      }

      // Normalize time format
      if (time && /^\d{1,2}:\d{2}(:\d{2})?$/.test(time)) {
        time = time.substring(0, 5);
      }

      const reminderHoursStr = reminderIdx >= 0 ? values[reminderIdx]?.toString().trim() : undefined;
      let reminderHours: number | undefined;
      if (reminderHoursStr) {
        const parsed = parseInt(reminderHoursStr, 10);
        if (!isNaN(parsed) && parsed >= 0) {
          reminderHours = parsed;
        }
      }

      const teamNameFromFile = teamIdx >= 0 ? values[teamIdx]?.toString().trim() : undefined;
      let resolvedTeamId: string | undefined = teamId;
      
      if (teamNameFromFile) {
        const matchedTeamId = teamNameMap.get(teamNameFromFile.toLowerCase());
        if (matchedTeamId) {
          // A non-club-admin must never be able to use the file's `team`
          // column to escape the team selected on the import page.
          if (!isClubAdmin && teamId && matchedTeamId !== teamId) {
            errors.push({
              row: rowNum,
              message: `Team "${teamNameFromFile}" does not match the selected team — club admin permissions required`,
            });
            continue;
          }
          resolvedTeamId = matchedTeamId;
        } else if (teams.length > 0) {
          errors.push({ row: rowNum, message: `Team "${teamNameFromFile}" not found` });
          continue;
        }
      }


      const resolvedTeamName = resolvedTeamId ? teamIdNameMap.get(resolvedTeamId) : undefined;

      fixtures.push({
        id: crypto.randomUUID(),
        title,
        date,
        time: time ? time.padStart(5, '0') : '',
        address: addressIdx >= 0 ? values[addressIdx]?.toString().trim() : undefined,
        description: descriptionIdx >= 0 ? values[descriptionIdx]?.toString().trim() : undefined,
        reminderHours,
        teamName: teamNameFromFile || resolvedTeamName,
        teamId: resolvedTeamId,
        opponent: opponentIdx >= 0 ? values[opponentIdx]?.toString().trim() : undefined,
      });
    }

    const seenFixtures = new Set<string>();
    const uniqueFixtures: ParsedFixture[] = [];
    
    for (const fixture of fixtures) {
      const key = `${fixture.title.toLowerCase()}|${fixture.date}|${fixture.teamId || ''}`;
      if (seenFixtures.has(key)) {
        errors.push({ 
          row: 0, 
          message: `Duplicate: "${fixture.title}" on ${fixture.date}` 
        });
      } else {
        seenFixtures.add(key);
        uniqueFixtures.push(fixture);
      }
    }

    const fixturesWithTeam = uniqueFixtures.filter(f => f.teamName);
    const fixturesWithoutTeam = uniqueFixtures.filter(f => !f.teamName);
    
    if (fixturesWithTeam.length > 0 && fixturesWithoutTeam.length > 0) {
      errors.push({
        row: 0,
        message: `${fixturesWithoutTeam.length} fixture(s) missing team name`
      });
    }

    // Authorization is derived from the shared helper so the preview, the
    // disabled Import button and handleImport all agree.
    const auth = validateFixtureImportAuthorization({
      isClubAdmin,
      teamId,
      fixtures: uniqueFixtures,
    });
    if (auth.ok === false) {
      errors.push({ row: 0, message: auth.message });
    }


    return { fixtures: uniqueFixtures, errors };
  };

  const parseCSV = (content: string): string[][] => {
    const lines = content.trim().split('\n');
    return lines.map(line => parseCSVLine(line));
  };

  const parseCSVLine = (line: string): string[] => {
    const values: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === ',' && !inQuotes) {
        values.push(current);
        current = '';
      } else {
        current += char;
      }
    }
    values.push(current);
    return values;
  };

  const parseExcel = async (data: ArrayBuffer): Promise<ParsedRow[]> => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(data);

    const firstSheet = workbook.worksheets[0];
    if (!firstSheet) return [];

    const rows: ParsedRow[] = [];

    firstSheet.eachRow({ includeEmpty: true }, (row) => {
      const rowValues = (row.values as unknown[]).slice(1).map((cell): ParsedCell => {
        if (cell === null || cell === undefined) return '';
        if (typeof cell === 'string' || typeof cell === 'number' || typeof cell === 'boolean' || cell instanceof Date) {
          return cell;
        }

        const cellObject = cell as {
          result?: unknown;
          text?: string;
          richText?: Array<{ text: string }>;
        };

        if (cellObject.result !== undefined) {
          if (
            typeof cellObject.result === 'string' ||
            typeof cellObject.result === 'number' ||
            typeof cellObject.result === 'boolean' ||
            cellObject.result instanceof Date
          ) {
            return cellObject.result;
          }
        }

        if (typeof cellObject.text === 'string') {
          return cellObject.text;
        }

        if (Array.isArray(cellObject.richText)) {
          return cellObject.richText.map((part) => part.text).join('');
        }

        return String(cell);
      });

      rows.push(rowValues);
    });

    return rows;
  };

  const processFixtures = async (fixtures: ParsedFixture[], parseErrors: ValidationError[], selectedFile: File) => {
    if (fixtures.length > 0) {
      const { data: existingEvents } = await supabase
        .from('events')
        .select('id, title, event_date, team_id')
        .eq('club_id', clubId)
        .eq('type', 'game');
      
      if (existingEvents) {
        const newFixtures: ParsedFixture[] = [];
        const duplicates: ParsedFixture[] = [];
        
        for (const fixture of fixtures) {
          const fixtureDate = fixture.date;
          const fixtureTeamId = fixture.teamId || teamId || null;
          
          // Conflict if ANY existing game is already on that day for that team.
          // Imports must never overwrite an existing match.
          // Compare by LOCAL calendar date so timezone offsets don't hide conflicts.
          const existingEvent = existingEvents.find(event => {
            if (event.team_id !== fixtureTeamId) return false;
            const d = new Date(event.event_date);
            const localDate = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
            return localDate === fixtureDate;
          });
          
          if (existingEvent) {
            duplicates.push({
              ...fixture,
              existingEventId: existingEvent.id,
              existingEventTitle: existingEvent.title,
              existingEventDate: (() => {
                const d = new Date(existingEvent.event_date);
                return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
              })(),
            });
          } else {
            newFixtures.push(fixture);
          }
        }
        
        setFile(selectedFile);
        setParsedFixtures(newFixtures);
        setDuplicateFixtures(duplicates);
        setErrors(parseErrors);
        setUpdateDuplicates(false);
        setExcludedTeams(new Set());
        return;
      }
    }
    
    setFile(selectedFile);
    setParsedFixtures(fixtures);
    setDuplicateFixtures([]);
    setErrors(parseErrors);
    setUpdateDuplicates(false);
    setExcludedTeams(new Set());
  };

  const processFile = useCallback(async (selectedFile: File) => {
    const fileName = selectedFile.name.toLowerCase();
    const isCSV = fileName.endsWith('.csv');
    const isExcel = fileName.endsWith('.xlsx');

    if (!isCSV && !isExcel) {
      toast({
        title: "Invalid file",
        description: "Please select a CSV or XLSX file",
        variant: "destructive",
      });
      return;
    }

    try {
      const parseAndCheck = async (rows: ParsedRow[]) => {
        if (rows.length < 2) {
          setErrors([{ row: 0, message: "File must have a header row and at least one data row" }]);
          setFile(selectedFile);
          return;
        }
        
        const headers = rows[0].map(h => h?.toString() || '');
        
        // Check if this is a Dribl export
        if (isDriblFormat(headers)) {
          // Dribl imports are only available for Pro Football clubs
          if (!isProFootball) {
            setErrors([{ 
              row: 0, 
              message: "Dribl imports require a Pro Football subscription. Please use the standard CSV format or upgrade to Pro Football." 
            }]);
            setFile(selectedFile);
            return;
          }
          
          setFile(selectedFile);
          setDriblMode(true);
          setDriblRawData({
            headers,
            rows: rows.slice(1).map((row) => row.map((cell) => cell?.toString() || '')),
          });
          return;
        }
        
        // Standard import flow
        const { fixtures, errors: parseErrors } = validateAndParseRows(rows);
        await processFixtures(fixtures, parseErrors, selectedFile);
      };
      
      if (isCSV) {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const content = event.target?.result as string;
          const rows = parseCSV(content);
          await parseAndCheck(rows);
        };
        reader.readAsText(selectedFile);
      } else {
        const reader = new FileReader();
        reader.onload = async (event) => {
          const data = event.target?.result as ArrayBuffer;
          const rows = await parseExcel(data);
          await parseAndCheck(rows);
        };
        reader.readAsArrayBuffer(selectedFile);
      }
    } catch (error) {
      console.error('Error parsing file:', error);
      toast({
        title: "Parse error",
        description: "Failed to parse the file",
        variant: "destructive",
      });
    }
  }, [toast, clubId, teamId, teams, isClubAdmin]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = e.target.files?.[0];
    if (!selectedFile) return;
    await processFile(selectedFile);
  };

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      await processFile(droppedFile);
    }
  }, [processFile]);

  const teamKeyOf = (f: ParsedFixture) => f.teamName || 'No team assigned';
  const fixturesAfterExclusion = parsedFixtures.filter(f => !excludedTeams.has(teamKeyOf(f)));

  // Blocking authorization state for the current (post-exclusion) selection.
  const importAuth = validateFixtureImportAuthorization({
    isClubAdmin,
    teamId,
    fixtures: fixturesAfterExclusion,
  });
  const authBlocked = importAuth.ok === false;
  const authBlockMessage = importAuth.ok === false ? importAuth.message : null;

  const handleImport = async () => {
    if (!user) return;

    const fixturesToInsert = fixturesAfterExclusion;

    if (fixturesToInsert.length === 0) return;

    // Never rely solely on the disabled button — re-run authorization here so
    // no programmatic submission path can bypass it.
    const auth = validateFixtureImportAuthorization({
      isClubAdmin,
      teamId,
      fixtures: fixturesToInsert,
    });
    if (auth.ok === false) {
      toast({
        variant: "destructive",
        title: "Not authorised",
        description: auth.message,
      });
      setImporting(false);
      return;
    }



    setImporting(true);
    try {
      // Re-check conflicts at import time so a concurrent insert can't slip through.
      const fixtureTeamIds = Array.from(new Set(
        fixturesToInsert.map(f => f.teamId || teamId || null).filter(Boolean) as string[]
      ));
      const fixtureDates = Array.from(new Set(fixturesToInsert.map(f => f.date)));

      if (fixtureTeamIds.length > 0 && fixtureDates.length > 0) {
        const minDate = fixtureDates.reduce((a, b) => (a < b ? a : b));
        const maxDate = fixtureDates.reduce((a, b) => (a > b ? a : b));
        // Pad the window by a day on each side so timezone offsets can't hide an event
        // that lives on the same local calendar day but a different UTC day.
        const padDay = (iso: string, deltaDays: number) => {
          const d = new Date(`${iso}T00:00:00`);
          d.setDate(d.getDate() + deltaDays);
          return d;
        };
        const startIso = padDay(minDate, -1).toISOString();
        const endIso = (() => {
          const d = padDay(maxDate, 1);
          d.setHours(23, 59, 59, 999);
          return d.toISOString();
        })();

        const { data: liveExisting, error: checkError } = await supabase
          .from('events')
          .select('id, event_date, team_id')
          .eq('club_id', clubId)
          .eq('type', 'game')
          .in('team_id', fixtureTeamIds)
          .gte('event_date', startIso)
          .lte('event_date', endIso);

        if (checkError) throw checkError;

        const localDateKey = (iso: string) => {
          const d = new Date(iso);
          return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        };

        const conflictKeys = new Set(
          (liveExisting || []).map(e => `${e.team_id}|${localDateKey(e.event_date)}`)
        );

        const blocked = fixturesToInsert.filter(f => {
          const tId = f.teamId || teamId || null;
          return tId && conflictKeys.has(`${tId}|${f.date}`);
        });

        if (blocked.length > 0) {
          toast({
            variant: "destructive",
            title: "Import blocked",
            description: `${blocked.length} fixture${blocked.length !== 1 ? 's' : ''} already have a match scheduled on that day. Remove them and try again.`,
          });
          setImporting(false);
          return;
        }
      }

      const eventsToInsert = fixturesToInsert.map(fixture => {
        const eventDateTime = new Date(`${fixture.date}T${fixture.time}`);
        return {
          title: fixture.title,
          type: 'game' as const,
          club_id: clubId,
          team_id: fixture.teamId || teamId || null,
          event_date: eventDateTime.toISOString(),
          start_time: eventDateTime.toISOString(),
          address: fixture.address || null,
          description: fixture.description || null,
          created_by: user.id,
          reminder_hours_before: fixture.reminderHours || null,
          reminder_sent: false,
          is_recurring: false,
          opponent: fixture.opponent || null,
          is_home_game: fixture.isHomeGame ?? null,
        };
      });

      const { error: insertError } = await supabase
        .from('events')
        .insert(eventsToInsert);

      if (insertError) throw insertError;

      toast({
        title: "Fixtures imported",
        description: `Successfully created ${eventsToInsert.length} fixture${eventsToInsert.length !== 1 ? 's' : ''}`,
      });

      setFile(null);
      setParsedFixtures([]);
      setDuplicateFixtures([]);
      setErrors([]);
      setUpdateDuplicates(false);
      onImportComplete();
    } catch (error) {
      console.error('Error importing fixtures:', error);
      toast({
        title: "Import failed",
        description: "Failed to import fixtures. Please try again.",
        variant: "destructive",
      });
    } finally {
      setImporting(false);
    }
  };

  const handleClear = () => {
    setFile(null);
    setParsedFixtures([]);
    setDuplicateFixtures([]);
    setErrors([]);
    setUpdateDuplicates(false);
    setDriblMode(false);
    setDriblRawData(null);
    setExcludedTeams(new Set());
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle Dribl mapper confirmation
  const handleDriblConfirm = async (
    driblFixtures: Array<{
      id: string;
      title: string;
      date: string;
      time: string;
      address?: string;
      description?: string;
      opponent?: string;
      driblTeamKey: string;
      isHomeGame: boolean;
    }>,
    mappings: Array<{
      driblTeamKey: string;
      driblTeamDisplay: string;
      igniteTeamId: string | null;
      fixtureCount: number;
    }>
  ) => {
    // Convert Dribl fixtures to ParsedFixture format with team IDs
    const mappingLookup = new Map(mappings.map(m => [m.driblTeamKey, m.igniteTeamId]));
    const teamNameLookup = new Map(teams.map(t => [t.id, t.name]));
    
    const fixtures: ParsedFixture[] = driblFixtures
      .filter(f => mappingLookup.get(f.driblTeamKey)) // Only include fixtures with mapped teams
      .map(f => {
        const mappedTeamId = mappingLookup.get(f.driblTeamKey) || undefined;
        return ({
        id: f.id,
        title: f.title,
        date: f.date,
        time: f.time,
        address: f.address,
        description: f.description,
        opponent: f.opponent,
        teamName: mappedTeamId ? teamNameLookup.get(mappedTeamId) : undefined,
        teamId: mappedTeamId,
        isHomeGame: f.isHomeGame,
        });
      });
    
    // Exit Dribl mode and process fixtures normally
    setDriblMode(false);
    setDriblRawData(null);
    
    // Process fixtures for duplicates
    await processFixtures(fixtures, [], file!);
  };

  const downloadTemplate = () => {
    // Generate future dates for template
    const today = new Date();
    const nextSaturday = new Date(today);
    nextSaturday.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7 || 7));
    const followingSaturday = new Date(nextSaturday);
    followingSaturday.setDate(nextSaturday.getDate() + 7);
    
    const formatDate = (d: Date) => d.toISOString().split('T')[0];
    
    // Include team column for club admins doing multi-team imports
    const csvContent = isClubAdmin && !teamId
      ? `title,date,time,team,opponent,address,description,reminder_hours
Round 1 vs Eagles,${formatDate(nextSaturday)},10:00,${teams[0]?.name || 'U10 Blue'},Eagles FC,123 Sports Ground Rd,Home game,24
Round 2 vs Tigers,${formatDate(followingSaturday)},14:30,${teams[1]?.name || teams[0]?.name || 'U12 Red'},Tigers United,456 Stadium Ave,Away game,48`
      : `title,date,time,opponent,address,description,reminder_hours
Round 1 vs Eagles,${formatDate(nextSaturday)},10:00,Eagles FC,123 Sports Ground Rd,Home game,24
Round 2 vs Tigers,${formatDate(followingSaturday)},14:30,Tigers United,456 Stadium Ave,Away game,48`;
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isClubAdmin && !teamId ? 'fixtures_multi_team_template.csv' : 'fixtures_template.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const downloadExcelTemplate = async () => {
    // Generate future dates for template
    const today = new Date();
    const nextSaturday = new Date(today);
    nextSaturday.setDate(today.getDate() + ((6 - today.getDay() + 7) % 7 || 7));
    const followingSaturday = new Date(nextSaturday);
    followingSaturday.setDate(nextSaturday.getDate() + 7);
    
    const formatDate = (d: Date) => d.toISOString().split('T')[0];

    const wsData = isClubAdmin && !teamId
      ? [
          ['title', 'date', 'time', 'team', 'opponent', 'address', 'description', 'reminder_hours'],
          ['Round 1 vs Eagles', formatDate(nextSaturday), '10:00', teams[0]?.name || 'U10 Blue', 'Eagles FC', '123 Sports Ground Rd', 'Home game', 24],
          ['Round 2 vs Tigers', formatDate(followingSaturday), '14:30', teams[1]?.name || teams[0]?.name || 'U12 Red', 'Tigers United', '456 Stadium Ave', 'Away game', 48],
        ]
      : [
          ['title', 'date', 'time', 'opponent', 'address', 'description', 'reminder_hours'],
          ['Round 1 vs Eagles', formatDate(nextSaturday), '10:00', 'Eagles FC', '123 Sports Ground Rd', 'Home game', 24],
          ['Round 2 vs Tigers', formatDate(followingSaturday), '14:30', 'Tigers United', '456 Stadium Ave', 'Away game', 48],
        ];

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Fixtures');
    wsData.forEach((row) => worksheet.addRow(row));

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = isClubAdmin && !teamId ? 'fixtures_multi_team_template.xlsx' : 'fixtures_template.xlsx';
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalToImport = fixturesAfterExclusion.length;
  const fileType = file?.name.endsWith('.csv') ? 'CSV' : 'Excel';

  // Check if all fixtures have valid mandatory fields (conflicts are skipped, not imported)
  const allFixturesValid = fixturesAfterExclusion.every(isFixtureValid);
  const invalidCount = fixturesAfterExclusion.filter(f => !isFixtureValid(f)).length;

  // If in Dribl mode, show the mapper
  if (driblMode && driblRawData) {
    const driblRows = parseDriblRows(driblRawData.headers, driblRawData.rows);
    return (
      <DriblImportMapper
        driblRows={driblRows}
        teams={teams}
        clubName={clubName}
        onConfirm={handleDriblConfirm}
        onCancel={handleClear}
      />
    );
  }

  return (
    <div className="space-y-4">
      {/* Format Guide - Collapsible */}
      <Collapsible open={formatOpen} onOpenChange={setFormatOpen}>
        <CollapsibleTrigger asChild>
          <Button variant="outline" className="w-full justify-between h-12">
            <div className="flex items-center gap-2">
              <Info className="h-4 w-4" />
              <span>File format guide</span>
            </div>
            <ChevronDown className={`h-4 w-4 transition-transform ${formatOpen ? 'rotate-180' : ''}`} />
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent className="mt-3">
          <Card>
            <CardContent className="pt-4 space-y-4">
              <div className="space-y-3">
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Required columns</p>
                  <div className="flex flex-wrap gap-1.5">
                    <Badge className="text-xs">title</Badge>
                    <Badge className="text-xs">date</Badge>
                    <Badge className="text-xs">time</Badge>
                  </div>
                </div>
                
                <div>
                  <p className="text-xs font-medium text-muted-foreground mb-2">Optional columns</p>
                  <div className="flex flex-wrap gap-1.5">
                    {isClubAdmin && !teamId && (
                      <Badge className="text-xs bg-primary/20 text-primary border-primary/30">team</Badge>
                    )}
                    <Badge variant="secondary" className="text-xs">opponent</Badge>
                    <Badge variant="secondary" className="text-xs">address</Badge>
                    <Badge variant="secondary" className="text-xs">description</Badge>
                    <Badge variant="secondary" className="text-xs">reminder_hours</Badge>
                  </div>
                </div>
              </div>

              <div className="text-xs text-muted-foreground space-y-1">
                <p><strong>date:</strong> YYYY-MM-DD (e.g., 2025-03-15)</p>
                <p><strong>time:</strong> 24-hour HH:MM (e.g., 14:30)</p>
                {isClubAdmin && !teamId ? (
                  <p className="text-primary/80">
                    <strong>team:</strong> Exact team name to assign fixtures across multiple teams.
                  </p>
                ) : (
                  <p className="text-primary/80">Fixtures will be assigned to the selected team automatically.</p>
                )}
              </div>
              
              {isProFootball && (
                <div className="pt-2 border-t border-border">
                  <p className="text-xs text-muted-foreground">
                    <strong>⚽ Dribl exports:</strong> Automatically detected! Upload your Dribl export and we'll map teams for you.
                  </p>
                </div>
              )}

              <div className="flex gap-2 pt-2">
                <Button variant="outline" size="sm" className="flex-1" onClick={downloadTemplate}>
                  <Download className="h-3.5 w-3.5 mr-1.5" />
                  CSV
                </Button>
                <Button variant="outline" size="sm" className="flex-1" onClick={downloadExcelTemplate}>
                  <FileSpreadsheet className="h-3.5 w-3.5 mr-1.5" />
                  Excel
                </Button>
              </div>
            </CardContent>
          </Card>
        </CollapsibleContent>
      </Collapsible>

      {/* Using specific MIME types to prevent cloud picker defaults on mobile */}
      <input
        ref={fileInputRef}
        type="file"
        accept="text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,.csv,.xlsx"
        onChange={handleFileSelect}
        className="hidden"
      />

      {!file ? (
        <Card 
          className={`border-2 border-dashed transition-all cursor-pointer ${
            isDragging 
              ? 'border-primary bg-primary/5' 
              : 'border-muted-foreground/25 hover:border-primary/50'
          }`}
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => fileInputRef.current?.click()}
        >
          <CardContent className="py-10">
            <div className="flex flex-col items-center gap-3 text-center">
              <div className={`rounded-full p-4 transition-colors ${
                isDragging ? 'bg-primary/10' : 'bg-muted'
              }`}>
                <Upload className={`h-8 w-8 ${isDragging ? 'text-primary' : 'text-muted-foreground'}`} />
              </div>
              <div>
                <p className="font-medium">
                  {isDragging ? 'Drop file here' : 'Tap to upload'}
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  or drag and drop
                </p>
              </div>
              <div className="flex gap-2">
                <Badge variant="secondary">.csv</Badge>
                <Badge variant="secondary">.xlsx</Badge>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="pt-4 space-y-4">
            {/* File info */}
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div className="flex items-center gap-3 min-w-0">
                {file.name.endsWith('.csv') ? (
                  <FileText className="h-5 w-5 shrink-0 text-muted-foreground" />
                ) : (
                  <FileSpreadsheet className="h-5 w-5 shrink-0 text-muted-foreground" />
                )}
                <span className="text-sm font-medium truncate">{file.name}</span>
              </div>
              <Button variant="ghost" size="icon" className="shrink-0" onClick={handleClear}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {/* Errors */}
            {errors.length > 0 && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>
                  <ul className="text-sm space-y-1">
                    {errors.slice(0, 3).map((error, i) => (
                      <li key={i}>{error.row > 0 ? `Row ${error.row}: ` : ''}{error.message}</li>
                    ))}
                    {errors.length > 3 && (
                      <li className="text-muted-foreground">+ {errors.length - 3} more errors</li>
                    )}
                  </ul>
                </AlertDescription>
              </Alert>
            )}

            {/* Summary banner — clear at-a-glance counts with per-team breakdown */}
            {(parsedFixtures.length > 0 || duplicateFixtures.length > 0) && (() => {
              const groupByTeam = (list: ParsedFixture[]) => {
                const map = new Map<string, number>();
                for (const f of list) {
                  const name = f.teamName || 'No team assigned';
                  map.set(name, (map.get(name) || 0) + 1);
                }
                return Array.from(map.entries()).sort((a, b) => a[0].localeCompare(b[0]));
              };
              const importTeams = groupByTeam(parsedFixtures);
              const skipTeams = groupByTeam(duplicateFixtures);
              return (
                <div className="space-y-2">
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="flex items-end justify-between gap-3">
                      <div>
                        <p className="text-2xl font-bold text-primary leading-none">{fixturesAfterExclusion.length}</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Will be imported
                          {excludedTeams.size > 0 && (
                            <span className="text-muted-foreground/70"> · of {parsedFixtures.length}</span>
                          )}
                        </p>
                      </div>
                      {importTeams.length > 1 && (
                        <button
                          type="button"
                          className="text-xs text-primary underline-offset-2 hover:underline"
                          onClick={() => {
                            if (excludedTeams.size === 0) {
                              setExcludedTeams(new Set(importTeams.map(([n]) => n)));
                            } else {
                              setExcludedTeams(new Set());
                            }
                          }}
                        >
                          {excludedTeams.size === 0 ? 'Deselect all' : 'Select all'}
                        </button>
                      )}
                    </div>
                    {importTeams.length > 0 && (
                      <ul className="text-xs space-y-0.5 pt-1 border-t border-primary/20">
                        {importTeams.map(([name, count]) => {
                          const checked = !excludedTeams.has(name);
                          return (
                            <li key={name} className="flex items-start justify-between gap-3 rounded-md bg-background/40 px-2 py-1.5">
                              <label className="flex items-start gap-2 min-w-0 flex-1 cursor-pointer">
                                <Checkbox
                                  checked={checked}
                                  onCheckedChange={(v) => {
                                    setExcludedTeams(prev => {
                                      const next = new Set(prev);
                                      if (v) next.delete(name);
                                      else next.add(name);
                                      return next;
                                    });
                                  }}
                                  className="mt-0.5 shrink-0"
                                />
                                <span className={`font-medium whitespace-normal break-words ${checked ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                                  {name}
                                </span>
                              </label>
                              <span className="text-muted-foreground shrink-0">{count}</span>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </div>
                  <div className={`rounded-lg border p-3 space-y-2 ${duplicateFixtures.length > 0 ? 'border-destructive/30 bg-destructive/5' : 'border-muted bg-muted/30'}`}>
                    <div>
                      <p className={`text-2xl font-bold leading-none ${duplicateFixtures.length > 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                        {duplicateFixtures.length}
                      </p>
                      <p className="text-xs text-muted-foreground mt-1">Skipped (already exists)</p>
                    </div>
                    {skipTeams.length > 0 && (
                      <ul className="text-xs space-y-0.5 pt-1 border-t border-destructive/20">
                        {skipTeams.map(([name, count]) => (
                           <li key={name} className="flex items-start justify-between gap-3 rounded-md bg-background/40 px-2 py-1">
                             <span className="text-foreground font-medium whitespace-normal break-words">{name}</span>
                            <span className="text-muted-foreground shrink-0">{count}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* New fixtures preview */}
            {parsedFixtures.length > 0 && (
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between h-10">
                    <span className="text-sm">View {parsedFixtures.length} fixture{parsedFixtures.length !== 1 ? 's' : ''} to import</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2">
                  <FixturePreviewEditor
                    fixtures={parsedFixtures}
                    onUpdate={setParsedFixtures}
                  />
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Skipped fixtures (existing match on same day for same team) */}
            {duplicateFixtures.length > 0 && (
              <Collapsible defaultOpen={false}>
                <CollapsibleTrigger asChild>
                  <Button variant="outline" className="w-full justify-between h-10 border-destructive/30 text-destructive hover:text-destructive">
                    <span className="text-sm">View {duplicateFixtures.length} skipped fixture{duplicateFixtures.length !== 1 ? 's' : ''}</span>
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </CollapsibleTrigger>
                <CollapsibleContent className="pt-2 space-y-2">
                  <p className="text-xs text-muted-foreground">
                    These fixtures were skipped because a match already exists on that day for the team. Delete or edit the existing event first if you need to replace it.
                  </p>
                  <ul className="space-y-2 max-h-80 overflow-y-auto pr-1">
                    {duplicateFixtures.map((f, i) => (
                      <li key={i} className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs space-y-2">
                        <div className="pb-2 border-b border-border/40 space-y-1">
                          <p className="text-[10px] uppercase tracking-wide text-muted-foreground">Team skipped</p>
                          <p className="text-sm font-semibold text-foreground whitespace-normal break-words">
                            {f.teamName || 'No team assigned'}
                          </p>
                          <p className="text-muted-foreground">{f.date}</p>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="text-destructive font-medium shrink-0">Skipped:</span>
                          <span className="text-foreground">{f.title}</span>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <span className="text-muted-foreground shrink-0">Existing:</span>
                          <span className="text-muted-foreground">
                            {f.existingEventTitle || '(existing match)'}
                          </span>
                        </div>
                      </li>
                    ))}
                  </ul>
                </CollapsibleContent>
              </Collapsible>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1 h-12"
                onClick={handleClear}
              >
                Cancel
              </Button>
              <Button
                className="flex-1 h-12"
                onClick={handleImport}
                disabled={totalToImport === 0 || importing || !allFixturesValid || authBlocked}
              >
                {importing ? 'Importing...' : `Import ${totalToImport}`}
              </Button>
            </div>
            {authBlocked && authBlockMessage && (
              <p className="text-xs text-destructive text-center">{authBlockMessage}</p>
            )}
            {!allFixturesValid && invalidCount > 0 && (
              <p className="text-xs text-destructive text-center">
                {invalidCount} fixture{invalidCount !== 1 ? 's' : ''} missing required fields
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
