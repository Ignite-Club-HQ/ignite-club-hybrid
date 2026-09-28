// Detects a team "colour" hint from a team / fixture name.
// e.g. "U8 Reds" -> { name: "Red", hex: "#ef4444" }
// Used by the Dribl import mapper to help users distinguish multiple teams
// in the same age group (e.g. U8 Reds vs U8 Blues).

export interface TeamColorHint {
  name: string;
  hex: string;
}

// Ordered so longer / more specific names match first.
const COLOR_DEFS: Array<{ keys: string[]; name: string; hex: string }> = [
  { keys: ["maroon"], name: "Maroon", hex: "#7f1d1d" },
  { keys: ["burgundy", "claret"], name: "Burgundy", hex: "#9f1239" },
  { keys: ["navy"], name: "Navy", hex: "#1e3a8a" },
  { keys: ["sky"], name: "Sky", hex: "#38bdf8" },
  { keys: ["royal"], name: "Royal", hex: "#1d4ed8" },
  { keys: ["aqua", "cyan", "teal"], name: "Teal", hex: "#14b8a6" },
  { keys: ["lime"], name: "Lime", hex: "#84cc16" },
  { keys: ["emerald"], name: "Emerald", hex: "#10b981" },
  { keys: ["forest"], name: "Forest", hex: "#166534" },
  { keys: ["magenta", "pink"], name: "Pink", hex: "#ec4899" },
  { keys: ["violet", "purple"], name: "Purple", hex: "#8b5cf6" },
  { keys: ["amber"], name: "Amber", hex: "#f59e0b" },
  { keys: ["gold", "yellow"], name: "Gold", hex: "#eab308" },
  { keys: ["silver", "grey", "gray"], name: "Grey", hex: "#9ca3af" },
  { keys: ["bronze", "brown"], name: "Brown", hex: "#78350f" },
  { keys: ["red"], name: "Red", hex: "#ef4444" },
  { keys: ["blue"], name: "Blue", hex: "#3b82f6" },
  { keys: ["green"], name: "Green", hex: "#22c55e" },
  { keys: ["orange"], name: "Orange", hex: "#f97316" },
  { keys: ["white"], name: "White", hex: "#f8fafc" },
  { keys: ["black"], name: "Black", hex: "#0f172a" },
];

const PLURAL_SUFFIXES = ["s", "es"];

function tokenize(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map(token => {
      // Strip a single trailing plural suffix to match "Reds" -> "red"
      for (const suf of PLURAL_SUFFIXES) {
        if (token.length > suf.length + 2 && token.endsWith(suf)) {
          return token.slice(0, -suf.length);
        }
      }
      return token;
    });
}

export function detectTeamColor(...inputs: Array<string | undefined | null>): TeamColorHint | null {
  const tokens = new Set<string>();
  for (const input of inputs) {
    if (!input) continue;
    for (const t of tokenize(input)) tokens.add(t);
  }
  if (tokens.size === 0) return null;

  for (const def of COLOR_DEFS) {
    for (const key of def.keys) {
      if (tokens.has(key)) {
        return { name: def.name, hex: def.hex };
      }
    }
  }
  return null;
}

// Normalise an age/grade label so "U8", "u-8", "Under 8", "8s" all compare equal.
export function normalizeGrade(input?: string | null): string {
  if (!input) return "";
  const lower = input.toLowerCase();
  // Match "u8", "u 8", "u-8", "under 8", "under-8", "8s", "8 s"
  const m =
    lower.match(/\bu\s*-?\s*(\d{1,2})\b/) ||
    lower.match(/\bunder\s*-?\s*(\d{1,2})\b/) ||
    lower.match(/\b(\d{1,2})\s*s?\b/);
  if (m) return `u${m[1]}`;
  return lower.replace(/[^a-z0-9]+/g, "");
}
