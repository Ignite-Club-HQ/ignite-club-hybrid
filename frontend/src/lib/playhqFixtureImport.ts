const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

const pad = (value: number | string) => String(value).padStart(2, "0");
const fullYear = (value: string) => value.length === 2 ? 2000 + Number(value) : Number(value);
const toPlayHQDate = (date: Date) => `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;

export function isPlayHQFormat(headers: string[]): boolean {
  const normalized = headers.map((header) => header.toLowerCase().trim());
  return ["game date", "home team", "away team", "playing surface", "grade"]
    .filter((column) => normalized.includes(column)).length >= 4;
}

export function splitPlayHQTeam(value: string): { club: string; grade: string; group: string } {
  const match = value.trim().match(/^(.*?)\s+(U\s?\d{1,2}|Under\s?\d{1,2})\b\s*(.*)$/i);
  if (!match) return { club: value.trim(), grade: "", group: "" };
  return {
    club: match[1].trim(),
    grade: match[2].replace(/\s+/g, "").toUpperCase(),
    group: match[3].trim(),
  };
}

export function normalisePlayHQDate(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^\d{5}(\.\d+)?$/.test(value)) {
    return toPlayHQDate(new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(value)) * 86_400_000));
  }
  const iso = value.match(/(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (iso) return `${pad(iso[3])}/${pad(iso[2])}/${iso[1]}`;
  const numeric = value.match(/(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})/);
  if (numeric) return `${pad(numeric[1])}/${pad(numeric[2])}/${fullYear(numeric[3])}`;
  const named = value.match(/(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?[,]?\s*(\d{4})/i);
  if (named) {
    const month = MONTHS[named[2].slice(0, 4).toLowerCase()] ?? MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (month) return `${pad(named[1])}/${pad(month)}/${named[3]}`;
  }
  return value;
}

const VALID_DATE = /^\d{2}\/\d{2}\/\d{4}$/;
const PIECE_SPLIT = /\s*(?:,|;|\n|&|\band\b|\bto\b|\s[-–]\s|\|)\s*/i;

/**
 * Expand a day range into individual dd/mm/yyyy dates. When `to < from`
 * the range crosses a month boundary ("31-1/11/2026": the month/year
 * belong to the last day).
 */
function expandDayRange(from: number, to: number, month: number, year: number): string[] {
  const out: string[] = [];
  const start = to >= from ? new Date(year, month - 1, from) : new Date(year, month - 2, from);
  const end = new Date(year, month - 1, to);
  for (let d = start; d <= end && out.length < 7; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    out.push(toPlayHQDate(d));
  }
  return out;
}

function expandSharedDayRange(value: string): string[] {
  const match = value.trim().match(/^(\d{1,2})\s*[-–&]\s*(\d{1,2})[/.](\d{1,2})[/.](\d{2,4})$/);
  if (!match) return [];
  return expandDayRange(Number(match[1]), Number(match[2]), Number(match[3]), fullYear(match[4]));
}

/** Named-month day range: "17-18 Oct 2026" / "Sat 17 - Sun 18 October 2026". */
function expandNamedMonthRange(value: string): string[] {
  const match = value.trim().match(/^(?:[a-z]{3,9}\s+)?(\d{1,2})(?:st|nd|rd|th)?\s*[-–&]\s*(?:[a-z]{3,9}\s+)?(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]{3,9})\.?,?\s+(\d{4})$/i);
  if (!match) return [];
  const month = MONTHS[match[3].slice(0, 4).toLowerCase()] ?? MONTHS[match[3].slice(0, 3).toLowerCase()];
  if (!month) return [];
  return expandDayRange(Number(match[1]), Number(match[2]), month, Number(match[4]));
}

/**
 * Every date in a cell, as dd/mm/yyyy, in order. Handles
 * "17/10/2026, 18/10/2026", "17/10/2026 - 18/10/2026", "17-18/10/2026",
 * "17-18 Oct 2026", "31-1/11/2026", "17/10 - 18/10/2026", one date per
 * line, etc. Pieces without a year borrow the year found elsewhere in
 * the cell.
 */
export function extractPlayHQDates(raw: string): string[] {
  const value = raw.trim();
  if (!value) return [];
  const sharedRange = expandSharedDayRange(value);
  if (sharedRange.length) return sharedRange;
  const namedRange = expandNamedMonthRange(value);
  if (namedRange.length) return namedRange;
  const isoDates = [...value.matchAll(/\d{4}-\d{1,2}-\d{1,2}/g)].map(([date]) => normalisePlayHQDate(date));
  if (isoDates.length) return [...new Set(isoDates)];
  const year = value.match(/\b(20\d{2})\b/)?.[1];
  const pieces = value.split(PIECE_SPLIT).filter(Boolean);
  const dates: string[] = [];
  for (const piece of pieces) {
    const withYear = year && !/\b\d{4}\b/.test(piece) && !/\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2}\b/.test(piece)
      ? `${piece} ${year}`
      : piece;
    const d = normalisePlayHQDate(withYear);
    if (VALID_DATE.test(d) && !dates.includes(d)) dates.push(d);
  }
  if (dates.length >= 2) return dates;
  const single = normalisePlayHQDate(value);
  return VALID_DATE.test(single) ? [single] : [];
}

export function normalisePlayHQTime(raw: string): string {
  const value = raw.trim();
  if (!value) return "";
  if (/^0?\.\d+$/.test(value)) {
    const minutes = Math.round(Number(value) * 1440);
    return `${pad(Math.floor(minutes / 60) % 24)}:${pad(minutes % 60)}`;
  }
  const iso = value.match(/T(\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;
  const match = value.match(/(\d{1,2})[:.](\d{2})\s*(am|pm)?/i) ?? value.match(/\b(\d{1,2})\s*(am|pm)\b/i);
  if (match) {
    let hours = Number(match[1]);
    const minutes = match[2] && /^\d{2}$/.test(match[2]) ? Number(match[2]) : 0;
    const period = (match[3] ?? match[2] ?? "").toLowerCase();
    if (period === "pm" && hours < 12) hours += 12;
    if (period === "am" && hours === 12) hours = 0;
    return `${pad(hours)}:${pad(minutes)}`;
  }
  const compact = value.match(/^(\d{3,4})$/);
  if (compact) return `${pad(compact[1].slice(0, -2))}:${compact[1].slice(-2)}`;
  return value;
}

export function extractPlayHQTimes(raw: string): string[] {
  const parts = raw.split(/\s*(?:,|;|\n|&|\band\b)\s*/i).filter(Boolean);
  const times = parts.map(normalisePlayHQTime).filter((time) => /^\d{2}:\d{2}$/.test(time));
  return times.length ? times : [normalisePlayHQTime(raw)];
}

export interface PlayHQSkippedRow {
  row: number;
  message: string;
}

export function playHQToDriblShape(headers: string[], rows: string[][]): {
  headers: string[];
  rows: string[][];
  skipped: PlayHQSkippedRow[];
} {
  const normalizedHeaders = headers.map((header) => header.toLowerCase().trim());
  const get = (row: string[], ...names: string[]) => {
    const index = names.map((name) => normalizedHeaders.indexOf(name)).find((value) => value >= 0);
    return index === undefined ? "" : (row[index] ?? "").trim();
  };
  const outHeaders = [
    "Identifier", "Competition", "Round", "Date", "Start", "Ground", "Field",
    "Age Group", "Home Club Name", "Home Team", "Home Team Group",
    "Away Club Name", "Away Team", "Away Team Group",
  ];
  const skipped: PlayHQSkippedRow[] = [];
  const output: string[][] = [];
  const grouped = new Map<string, { row: string[]; dates: string[]; times: string[] }>();

  rows.forEach((row, index) => {
    const home = get(row, "home team");
    const away = get(row, "away team");
    const status = get(row, "game status", "status").toLowerCase();
    if (get(row, "bye") || /^(cancelled|canceled|forfeit|bye)$/.test(status)) {
      skipped.push({ row: index + 2, message: "Bye, cancelled, or forfeited game skipped." });
      return;
    }
    if (!home || !away) {
      skipped.push({ row: index + 2, message: "Missing home or away team; row skipped." });
      return;
    }
    const dateValue = get(row, "game date", "date");
    const dates = extractPlayHQDates(dateValue);
    if (!dates.length) {
      skipped.push({ row: index + 2, message: "Could not read a fixture date; row skipped." });
      return;
    }
    const times = extractPlayHQTimes(get(row, "game time", "start time", "time"));
    const id = get(row, "game id", "match id", "id") || `${get(row, "round", "round name")}|${home}|${away}`;
    const existing = grouped.get(id);
    if (existing) {
      existing.dates = [...new Set([...existing.dates, ...dates])];
      existing.times = [...existing.times, ...times];
    } else {
      grouped.set(id, { row, dates, times });
    }
  });

  for (const [id, match] of grouped) {
    const row = match.row;
    const home = get(row, "home team");
    const away = get(row, "away team");
    const homeTeam = splitPlayHQTeam(home);
    const awayTeam = splitPlayHQTeam(away);
    const grade = get(row, "grade") || homeTeam.grade || awayTeam.grade;
    const baseRound = get(row, "round", "round name", "game round");
    const finals = /final/i.test(baseRound) ? baseRound : "";
    const round = finals || (baseRound ? (/round/i.test(baseRound) ? baseRound : `Round ${baseRound}`) : "Round");
    const ground = get(row, "playing surface", "ground", "venue");
    const field = get(row, "field", "court");
    match.dates.forEach((date, dayIndex) => {
      const dayLabel = match.dates.length > 1 ? ` (Day ${dayIndex + 1} of ${match.dates.length})` : "";
      const time = match.times[dayIndex] ?? match.times[0] ?? "";
      output.push([
        `${id}-${dayIndex + 1}`,
        get(row, "competition", "competition name"),
        `${round}${dayLabel}`,
        date,
        time,
        ground,
        field,
        grade,
        homeTeam.club,
        home,
        homeTeam.group,
        awayTeam.club,
        away,
        awayTeam.group,
      ]);
    });
  }

  return { headers: outHeaders, rows: output, skipped };
}
