import { useState, useMemo } from "react";
import { AlertCircle, Check, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getSportEmoji } from "@/lib/sportEmojis";
import { detectTeamColor, normalizeGrade, type TeamColorHint } from "@/lib/teamColor";

interface Team {
  id: string;
  name: string;
  level_age?: string | null;
}

// Small inline swatch used in dropdowns and badges
function ColorSwatch({ color, className = "" }: { color: TeamColorHint | null; className?: string }) {
  if (!color) return null;
  return (
    <span
      className={`inline-block h-3 w-3 rounded-full border border-border shrink-0 ${className}`}
      style={{ backgroundColor: color.hex }}
      title={color.name}
      aria-label={`${color.name} team`}
    />
  );
}

interface DriblRow {
  // Core fields from Dribl
  identifier?: string;
  eventStatus?: string;
  competition?: string;
  round?: string;
  date?: string;
  day?: string;
  start?: string;
  duration?: string;
  ground?: string;
  field?: string;
  league?: string;
  ageGroup?: string;
  division?: string;
  gender?: string;
  homeClubCode?: string;
  homeClubName?: string;
  homeTeamCode?: string;
  homeTeamName?: string;
  awayClubCode?: string;
  awayClubName?: string;
  awayTeamCode?: string;
  awayTeamName?: string;
  homeTeamColor?: string;
  awayTeamColor?: string;
  teamColor?: string;
  homeTeamGroup?: string;
  awayTeamGroup?: string;
  homeTeam?: string;
  awayTeam?: string;
  // Computed
  rawRow: Record<string, string>;
}

interface DriblFixture {
  id: string;
  title: string;
  date: string;
  time: string;
  address?: string;
  description?: string;
  opponent?: string;
  driblTeamKey: string; // Key to identify which team this fixture is for
  isHomeGame: boolean;
}

interface TeamMapping {
  driblTeamKey: string;
  driblTeamDisplay: string; // e.g., "U12 Boys Div 1 - Eagles FC"
  driblGrade: string; // raw ageGroup from Dribl, for badge
  driblColor: TeamColorHint | null;
  igniteTeamId: string | null;
  fixtureCount: number;
}

interface DriblImportMapperProps {
  driblRows: DriblRow[];
  teams: Team[];
  clubName: string; // Your club's name for home/away detection
  onConfirm: (fixtures: DriblFixture[], mappings: TeamMapping[]) => void;
  onCancel: () => void;
}

// Detect Dribl columns in header row
export function isDriblFormat(headers: string[]): boolean {
  const lowerHeaders = headers.map(h => h.toLowerCase().trim());
  const driblIndicators = ['home club code', 'home team code', 'away club code', 'competition', 'matchsheet'];
  return driblIndicators.filter(ind => 
    lowerHeaders.some(h => h.includes(ind.replace(' ', '')) || h.includes(ind))
  ).length >= 2;
}

// Parse Dribl column headers to standard keys
function normalizeHeader(header: string): string {
  const h = header.toLowerCase().trim().replace(/[\s_-]+/g, '');
  
  const mappings: Record<string, string> = {
    'identifier': 'identifier',
    'eventstatus': 'eventStatus',
    'matchsheet': 'matchsheet',
    'competition': 'competition',
    'round': 'round',
    'date': 'date',
    'day': 'day',
    'start': 'start',
    'duration': 'duration',
    'ground': 'ground',
    'field': 'field',
    'league': 'league',
    'agegroup': 'ageGroup',
    'division': 'division',
    'gender': 'gender',
    'homeclubcode': 'homeClubCode',
    'homeclubname': 'homeClubName',
    'hometeamcode': 'homeTeamCode',
    'hometeamname': 'homeTeamName',
    'hometeamcolour': 'homeTeamColor',
    'hometeamcolours': 'homeTeamColor',
    'hometeamcolor': 'homeTeamColor',
    'hometeamcolors': 'homeTeamColor',
    'homecolour': 'homeTeamColor',
    'homecolours': 'homeTeamColor',
    'homecolor': 'homeTeamColor',
    'homecolors': 'homeTeamColor',
    'teamcolour': 'teamColor',
    'teamcolours': 'teamColor',
    'teamcolor': 'teamColor',
    'teamcolors': 'teamColor',
    'colour': 'teamColor',
    'color': 'teamColor',
    'awayclubcode': 'awayClubCode',
    'awayclubname': 'awayClubName',
    'awayteamcode': 'awayTeamCode',
    'awayteamname': 'awayTeamName',
    'hometeamgroup': 'homeTeamGroup',
    'awayteamgroup': 'awayTeamGroup',
    'hometeam': 'homeTeam',
    'awayteam': 'awayTeam',
    'awayteamcolour': 'awayTeamColor',
    'awayteamcolours': 'awayTeamColor',
    'awayteamcolor': 'awayTeamColor',
    'awayteamcolors': 'awayTeamColor',
    'awaycolour': 'awayTeamColor',
    'awaycolours': 'awayTeamColor',
    'awaycolor': 'awayTeamColor',
    'awaycolors': 'awayTeamColor',
  };
  
  if (mappings[h]) return mappings[h];
  if (h.includes('home') && (h.includes('colour') || h.includes('color'))) return 'homeTeamColor';
  if (h.includes('away') && (h.includes('colour') || h.includes('color'))) return 'awayTeamColor';
  if (h.includes('colour') || h.includes('color')) return 'teamColor';

  return h;
}

// Parse raw rows into structured DriblRow objects
export function parseDriblRows(headers: string[], rows: string[][]): DriblRow[] {
  const normalizedHeaders = headers.map(normalizeHeader);
  
  return rows.map(row => {
    const rawRow: Record<string, string> = {};
    const driblRow: DriblRow = { rawRow };
    
    normalizedHeaders.forEach((header, idx) => {
      const value = row[idx]?.toString().trim() || '';
      rawRow[header] = value;
      
      if (header in driblRow || header === 'identifier' || header === 'eventStatus' || 
          header === 'competition' || header === 'round' || header === 'date' || 
          header === 'day' || header === 'start' || header === 'duration' || 
          header === 'ground' || header === 'field' || header === 'league' || 
          header === 'ageGroup' || header === 'division' || header === 'gender' ||
          header === 'homeClubCode' || header === 'homeClubName' || 
          header === 'homeTeamCode' || header === 'homeTeamName' ||
          header === 'awayClubCode' || header === 'awayClubName' ||
          header === 'awayTeamCode' || header === 'awayTeamName' ||
          header === 'homeTeamGroup' || header === 'awayTeamGroup' ||
          header === 'homeTeam' || header === 'awayTeam' ||
          header === 'homeTeamColor' || header === 'awayTeamColor' || header === 'teamColor') {
        (driblRow as any)[header] = value;
      }
    });
    
    return driblRow;
  });
}

// Treat Dribl placeholder values like "Not Set" / "N/A" / "-" as empty.
function cleanDriblValue(value?: string): string {
  const v = (value || '').trim();
  if (!v) return '';
  const lower = v.toLowerCase();
  if (lower === 'not set' || lower === 'notset' || lower === 'n/a' || lower === 'na' || lower === '-' || lower === 'tbc' || lower === 'tbd') return '';
  return v;
}

// Generate a unique key for team matching
function generateTeamKey(row: DriblRow, isHome: boolean): string {
  const teamName = isHome ? (row.homeTeam || row.homeTeamName || row.homeTeamCode) : (row.awayTeam || row.awayTeamName || row.awayTeamCode);
  const teamColor = getDriblTeamColorText(row, isHome);
  const ageGroup = row.ageGroup || '';
  const division = row.division || '';
  const gender = row.gender || '';
  
  // Create a normalized key for matching
  return `${ageGroup}|${division}|${gender}|${teamColor}|${teamName}`.toLowerCase();
}

// Color in Dribl is in the "Team Group" column (e.g. "Blue", "Navy", "White").
// Falls back to dedicated colour columns, then to keywords inside the full team name.
function getDriblTeamColorText(row: DriblRow, isHome: boolean): string {
  const group = cleanDriblValue(isHome ? row.homeTeamGroup : row.awayTeamGroup);
  if (group) return group;

  const directColor = cleanDriblValue(isHome ? row.homeTeamColor : row.awayTeamColor);
  if (directColor) return directColor;

  const sidePrefix = isHome ? 'home' : 'away';
  const genericColor = Object.entries(row.rawRow).find(([key, value]) => {
    const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return Boolean(cleanDriblValue(value)) && normalizedKey.includes(sidePrefix) && (normalizedKey.includes('colour') || normalizedKey.includes('color') || normalizedKey.includes('group'));
  })?.[1];
  const cleanedGeneric = cleanDriblValue(genericColor);
  if (cleanedGeneric) return cleanedGeneric;

  // Last resort: scan the full team description (e.g. "Bridgewater JSC Under 8 Mixed Navy")
  const fullTeam = cleanDriblValue(isHome ? row.homeTeam : row.awayTeam);
  if (fullTeam) {
    const detected = detectTeamColor(fullTeam);
    if (detected) return detected.name;
  }

  return cleanDriblValue(row.teamColor);
}

// Attempt to auto-match Dribl team to Ignite team. We score every team and
// prefer the highest match (grade + colour + division/gender keyword overlap).
function autoMatchTeam(
  row: DriblRow,
  driblTeamName: string,
  driblTeamColorText: string,
  teams: Team[],
): string | null {
  const driblGrade = normalizeGrade(row.ageGroup);
  const driblColor = detectTeamColor(driblTeamColorText, driblTeamName);
  const keywordParts = [row.division, row.gender]
    .map(p => (p || '').toLowerCase().trim())
    .filter(Boolean);

  let bestId: string | null = null;
  let bestScore = 0;

  for (const team of teams) {
    const teamNameLower = team.name.toLowerCase();
    const teamGrade = normalizeGrade(team.level_age || team.name);
    const teamColor = detectTeamColor(team.name, team.level_age);

    let score = 0;
    // Grade match is the strongest signal — required for a high-confidence match
    if (driblGrade && teamGrade && driblGrade === teamGrade) score += 5;
    // Colour distinguishes teams in the same grade
    if (driblColor && teamColor && driblColor.name === teamColor.name) score += 3;
    // Keyword overlap (division / gender)
    for (const part of keywordParts) {
      if (part && teamNameLower.includes(part)) score += 1;
    }

    if (score > bestScore) {
      bestScore = score;
      bestId = team.id;
    }
  }

  // Require at least a grade match (5) before auto-assigning
  return bestScore >= 5 ? bestId : null;
}

function normalizeClubValue(value?: string): string {
  return (value || '')
    .toLowerCase()
    .replace(/\b(football club|soccer club|fc|sc|club)\b/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function sideMatchesClub(row: DriblRow, isHome: boolean, selectedClubCode: string, clubName: string): boolean {
  const sideValues = isHome
    ? [row.homeClubCode, row.homeClubName, row.homeTeamCode, row.homeTeamName]
    : [row.awayClubCode, row.awayClubName, row.awayTeamCode, row.awayTeamName];

  const selectedValues = [selectedClubCode, clubName].filter(Boolean);
  if (sideValues.some(value => value && selectedValues.some(selected => value === selected))) {
    return true;
  }

  const normalizedSideValues = sideValues.map(normalizeClubValue).filter(Boolean);
  const normalizedSelectedValues = selectedValues.map(normalizeClubValue).filter(Boolean);

  return normalizedSideValues.some(sideValue =>
    normalizedSelectedValues.some(selectedValue =>
      sideValue === selectedValue || sideValue.includes(selectedValue) || selectedValue.includes(sideValue)
    )
  );
}

function getOwnClubCodeFromRow(row: DriblRow, isHome: boolean): string {
  return isHome
    ? (row.homeClubCode || row.homeClubName || '')
    : (row.awayClubCode || row.awayClubName || '');
}

export function DriblImportMapper({ 
  driblRows, 
  teams, 
  clubName,
  onConfirm, 
  onCancel 
}: DriblImportMapperProps) {
  // Determine which club code represents "your" club
  const [yourClubCode, setYourClubCode] = useState<string>(() => {
    // Try to auto-detect based on club name
    for (const row of driblRows) {
      if (sideMatchesClub(row, true, '', clubName)) return getOwnClubCodeFromRow(row, true);
      if (sideMatchesClub(row, false, '', clubName)) return getOwnClubCodeFromRow(row, false);
    }
    
    return '';
  });

  // Get all unique club codes from the data
  const clubCodes = useMemo(() => {
    const codes = new Map<string, string>();
    
    for (const row of driblRows) {
      if (row.homeClubCode || row.homeClubName) {
        const code = row.homeClubCode || row.homeClubName || '';
        const name = row.homeClubName || row.homeClubCode || '';
        if (code && !codes.has(code)) {
          codes.set(code, name);
        }
      }
      if (row.awayClubCode || row.awayClubName) {
        const code = row.awayClubCode || row.awayClubName || '';
        const name = row.awayClubName || row.awayClubCode || '';
        if (code && !codes.has(code)) {
          codes.set(code, name);
        }
      }
    }
    
    return Array.from(codes.entries()).map(([code, name]) => ({ code, name }));
  }, [driblRows]);

  // Generate fixtures and team mappings based on selected club
  const { fixtures, teamMappings } = useMemo(() => {
    const fixtures: DriblFixture[] = [];
    const teamMap = new Map<string, TeamMapping>();
    
    // Emit one fixture+mapping for a given side (home or away) of a row.
    const emitSide = (row: DriblRow, isHome: boolean, isDerby: boolean) => {
      const driblTeamKey = generateTeamKey(row, isHome);
      const teamName = isHome
        ? (row.homeClubName || row.homeTeamName || row.homeTeamCode || 'Unknown Team')
        : (row.awayClubName || row.awayTeamName || row.awayTeamCode || 'Unknown Team');

      // Opposing team's full label (e.g. "U8 Blue"). For internal derbies the
      // opposing club name matches ours, so use this to disambiguate.
      const opponentFullLabel = cleanDriblValue(isHome ? row.awayTeam : row.homeTeam);
      const opponentColorText = getDriblTeamColorText(row, !isHome);
      const opponent = isDerby
        ? (opponentFullLabel
            || [teamName, opponentColorText].filter(Boolean).join(' ').trim()
            || 'TBA')
        : (isHome
            ? (row.awayClubName || row.awayTeamName || row.awayTeamCode || 'TBA')
            : (row.homeClubName || row.homeTeamName || row.homeTeamCode || 'TBA'));

      const addressParts = [row.ground, row.field].filter(Boolean);
      const address = addressParts.join(' - ');

      const roundLabel = row.round
        ? (/^\d+$/.test(row.round.trim()) ? `Round ${row.round.trim()}` : row.round.trim())
        : null;

      // For derbies, title both sides explicitly (e.g. "U8 Grey V U8 Blue")
      // instead of "<Club> V <Club>".
      const ownFullLabel = cleanDriblValue(isHome ? row.homeTeam : row.awayTeam);
      const ownColorText = getDriblTeamColorText(row, isHome);
      const ownDisplay = isDerby
        ? (ownFullLabel || [teamName, ownColorText].filter(Boolean).join(' ').trim() || clubName)
        : clubName;
      const opponentDisplay = isDerby
        ? opponent
        : (isHome
            ? (row.awayClubName || row.awayTeamName || row.awayClubCode || row.awayTeamCode || 'Opponent')
            : (row.homeClubName || row.homeTeamName || row.homeClubCode || row.homeTeamCode || 'Opponent'));
      const matchup = `${ownDisplay} V ${opponentDisplay}`;
      const title = roundLabel ? `${roundLabel} - ${matchup}` : matchup;

      let parsedDate = row.date || '';
      if (row.date && row.date.includes('/')) {
        const parts = row.date.split('/');
        if (parts.length === 3) {
          parsedDate = `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
      }

      let time = row.start || '00:00';
      if (time && !time.includes(':')) {
        time = time.padStart(4, '0');
        time = `${time.slice(0, 2)}:${time.slice(2, 4)}`;
      }

      fixtures.push({
        id: crypto.randomUUID(),
        title,
        date: parsedDate,
        time: time.substring(0, 5),
        address,
        description: opponentFullLabel || '',
        opponent,
        driblTeamKey,
        isHomeGame: isHome,
      });

      if (!teamMap.has(driblTeamKey)) {
        const driblTeamColorText = getDriblTeamColorText(row, isHome);
        const fullTeamLabel = cleanDriblValue(isHome ? row.homeTeam : row.awayTeam);
        const displayParts = fullTeamLabel
          ? [fullTeamLabel, driblTeamColorText && !fullTeamLabel.toLowerCase().includes(driblTeamColorText.toLowerCase()) ? `(${driblTeamColorText})` : null]
          : [
              cleanDriblValue(row.ageGroup),
              cleanDriblValue(row.gender),
              cleanDriblValue(row.division),
              driblTeamColorText,
              teamName !== 'Unknown Team' ? teamName : null,
            ];
        const driblTeamDisplay = displayParts.filter(Boolean).join(' ') || teamName;

        const driblColor = detectTeamColor(driblTeamColorText, fullTeamLabel, teamName, row.division);

        teamMap.set(driblTeamKey, {
          driblTeamKey,
          driblTeamDisplay,
          driblGrade: row.ageGroup || '',
          driblColor,
          igniteTeamId: autoMatchTeam(row, fullTeamLabel || teamName, driblTeamColorText, teams),
          fixtureCount: 0,
        });
      }
      teamMap.get(driblTeamKey)!.fixtureCount++;
    };

    for (const row of driblRows) {
      // Skip if no date or cancelled
      if (!row.date || row.eventStatus?.toLowerCase() === 'cancelled') continue;

      const isHome = sideMatchesClub(row, true, yourClubCode, clubName);
      const isAway = sideMatchesClub(row, false, yourClubCode, clubName);

      // Skip if neither home nor away is your club
      if (!isHome && !isAway) continue;

      // Internal derby: both sides belong to our club (e.g. U8 Grey v U8 Blue).
      // Emit a fixture for each side so both teams see the match in their
      // schedule with the correct home/away flag, instead of silently dropping
      // the away side.
      const isDerby = isHome && isAway;
      if (isHome) emitSide(row, true, isDerby);
      if (isAway) emitSide(row, false, isDerby);
    }

    
    return { 
      fixtures, 
      teamMappings: Array.from(teamMap.values()).sort((a, b) => b.fixtureCount - a.fixtureCount)
    };
  }, [driblRows, yourClubCode, teams, clubName]);

  // State for team mapping overrides
  const [mappingOverrides, setMappingOverrides] = useState<Record<string, string | null>>({});

  const finalMappings = useMemo(() => {
    return teamMappings.map(m => ({
      ...m,
      igniteTeamId: mappingOverrides[m.driblTeamKey] !== undefined 
        ? mappingOverrides[m.driblTeamKey] 
        : m.igniteTeamId,
    }));
  }, [teamMappings, mappingOverrides]);

  const unmappedCount = finalMappings.filter(m => !m.igniteTeamId).length;
  const totalFixtures = fixtures.length;

  const handleConfirm = () => {
    onConfirm(fixtures, finalMappings);
  };

  return (
    <div className="space-y-4">
      {/* Club Selection */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            {getSportEmoji("Football (Soccer)")} Select Your Club
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Which club code represents your club in this export?
          </p>
          <Select value={yourClubCode} onValueChange={setYourClubCode}>
            <SelectTrigger className="h-12">
              <SelectValue placeholder="Select your club" />
            </SelectTrigger>
            <SelectContent>
              {clubCodes.map(({ code, name }) => (
                <SelectItem key={code} value={code}>
                  {name} {code !== name && `(${code})`}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          
          {totalFixtures > 0 && (
            <p className="text-sm text-primary font-medium">
              Found {totalFixtures} fixture{totalFixtures !== 1 ? 's' : ''} for your club
            </p>
          )}
          
          {totalFixtures === 0 && yourClubCode && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>
                No fixtures found for this club. Try selecting a different club code.
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Team Mapping */}
      {totalFixtures > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base flex items-center justify-between">
              <span>Map Teams</span>
              {unmappedCount > 0 && (
                <Badge variant="destructive" className="text-xs">
                  {unmappedCount} unmapped
                </Badge>
              )}
              {unmappedCount === 0 && finalMappings.length > 0 && (
                <Badge className="text-xs bg-green-600">
                  <Check className="h-3 w-3 mr-1" />
                  All mapped
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Match Dribl teams to your Ignite teams. Fixtures without a mapped team will be skipped.
            </p>
            
            <ScrollArea className="h-[60vh] max-h-[600px] pr-2">
              <div className="space-y-2 pr-2">
                {finalMappings.map((mapping) => (
                  <div
                    key={mapping.driblTeamKey}
                    className="rounded-lg border bg-card p-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-3"
                  >
                    {/* Dribl team (left) */}
                    <div className="flex-1 min-w-0 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs shrink-0">
                          {mapping.fixtureCount}
                        </Badge>
                        {mapping.driblGrade && (
                          <Badge variant="secondary" className="text-xs shrink-0">
                            {mapping.driblGrade}
                          </Badge>
                        )}
                        <ColorSwatch color={mapping.driblColor} />
                      </div>
                      <p className="text-sm font-medium break-words">
                        {mapping.driblTeamDisplay}
                      </p>
                    </div>

                    <ArrowRight className="h-4 w-4 shrink-0 text-muted-foreground hidden sm:block" />

                    {/* Ignite team selector (right) */}
                    <div className="w-full sm:w-[260px] shrink-0">
                      <Select
                        value={mapping.igniteTeamId || "unmapped"}
                        onValueChange={(value) => {
                          setMappingOverrides(prev => ({
                            ...prev,
                            [mapping.driblTeamKey]: value === "unmapped" ? null : value,
                          }));
                        }}
                      >
                        <SelectTrigger className={`w-full h-auto min-h-10 py-2 ${
                          !mapping.igniteTeamId ? 'border-destructive' : 'border-green-600'
                        }`}>
                          <SelectValue placeholder="Select team" />
                        </SelectTrigger>
                        <SelectContent className="max-w-[90vw]">
                          <SelectItem value="unmapped">
                            <span className="text-muted-foreground">Skip (no mapping)</span>
                          </SelectItem>
                          {teams.map(team => {
                            const teamColor = detectTeamColor(team.name, team.level_age);
                            return (
                              <SelectItem key={team.id} value={team.id}>
                                <span className="flex items-center gap-2">
                                  {team.level_age && (
                                    <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                                      {team.level_age}
                                    </Badge>
                                  )}
                                  <ColorSwatch color={teamColor} />
                                  <span>{team.name}</span>
                                </span>
                              </SelectItem>
                            );
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                ))}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        <Button variant="outline" className="flex-1 h-12" onClick={onCancel}>
          Cancel
        </Button>
        <Button 
          className="flex-1 h-12" 
          onClick={handleConfirm}
          disabled={totalFixtures === 0 || unmappedCount === finalMappings.length}
        >
          Continue with {totalFixtures - (unmappedCount > 0 ? finalMappings.filter(m => !m.igniteTeamId).reduce((sum, m) => sum + m.fixtureCount, 0) : 0)} fixtures
        </Button>
      </div>
    </div>
  );
}
