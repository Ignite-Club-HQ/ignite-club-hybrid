// Phase 1 — Unified Recipient Input parser
// Accepts pasted text and extracts a list of recipients.
// Supported formats per entry (separated by , ; \n \t):
//   "Alex Smith"
//   "redacted@example.invalid"
//   "Alex Smith <redacted@example.invalid>"
//   "Alex Smith, redacted@example.invalid"  (when whole input is a single recipient)
//
// Hardened parsing rules:
//   - Angle-bracket form requires the WHOLE bracket body to be a single valid
//     email — `Alex <redacted@example.invalid extra>`, `Alex <a@b><c@d>`, unmatched
//     or nested brackets are all rejected. This prevents silent extraction of
//     an attacker-controlled second address from pasted content.
//   - Bare-email form requires the whole entry to look like an email; noise
//     around the email is treated as a "Name <email>"-style pair only if a
//     single valid email is present.

export interface ParsedRecipient {
  name: string;
  email: string;
}

// Anchored email regex — used to validate a full string is an email.
const FULL_EMAIL_RE = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
// Substring email regex — used to locate a single email inside a "Name email" pair.
const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;

function findSingleEmail(input: string): string | null {
  const matches = input.match(EMAIL_RE);
  if (!matches || matches.length !== 1) return null;
  return matches[0];
}

function parseEntry(raw: string): ParsedRecipient | null {
  const s = raw.trim().replace(/^["']|["']$/g, "");
  if (!s) return null;

  const openCount = (s.match(/</g) ?? []).length;
  const closeCount = (s.match(/>/g) ?? []).length;

  // Angle-bracket handling.
  if (openCount > 0 || closeCount > 0) {
    // Reject nested / multi-pair / unmatched brackets outright.
    if (openCount !== 1 || closeCount !== 1) return null;
    const openIdx = s.indexOf("<");
    const closeIdx = s.indexOf(">");
    if (closeIdx <= openIdx) return null;
    // Anything after the closing bracket other than whitespace is invalid.
    if (s.slice(closeIdx + 1).trim().length > 0) return null;

    const name = s.slice(0, openIdx).trim();
    const inside = s.slice(openIdx + 1, closeIdx).trim();
    // The bracket body MUST be exactly one email — no extra tokens.
    if (!FULL_EMAIL_RE.test(inside)) return null;
    return { name: name || inside.split("@")[0], email: inside };
  }

  // Bare email — the whole entry is an email.
  if (FULL_EMAIL_RE.test(s)) {
    return { name: s.split("@")[0], email: s };
  }

  // "Name email" or "Name, email" — accept only when a single email is
  // present (multi-email strings without a bracket form are ambiguous and
  // must be rejected here; the outer parser will have already split on
  // list separators).
  const single = findSingleEmail(s);
  if (single) {
    const name = s.replace(single, "").replace(/[,;]/g, " ").replace(/\s+/g, " ").trim();
    return { name: name || single.split("@")[0], email: single };
  }

  // Name only — reject if it accidentally contains @-noise so we never
  // silently treat a broken address as a name.
  if (s.includes("@")) return null;
  return { name: s, email: "" };
}

export function parseRecipients(input: string): ParsedRecipient[] {
  if (!input) return [];
  // Split on newlines, tabs, semicolons. Commas only split when input contains
  // a separator that strongly suggests a list (newline / tab / semicolon, or
  // multiple emails) — otherwise "Alex Smith, redacted@example.invalid" is one entry.
  const hasStrongSep = /[\n\t;]/.test(input);
  const emailCount = (input.match(/@/g) ?? []).length;
  const splitRe = hasStrongSep || emailCount > 1 ? /[\n\t;,]+/ : /[\n\t;]+/;
  const parts = input.split(splitRe).map((p) => p.trim()).filter(Boolean);
  const out: ParsedRecipient[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const r = parseEntry(p);
    if (!r) continue;
    const key = (r.email || r.name).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

// Heuristic: does the pasted text look like a multi-recipient list?
export function looksLikeMultiRecipient(input: string): boolean {
  if (!input) return false;
  if (/[\n\t;]/.test(input)) {
    return parseRecipients(input).length >= 2;
  }
  const emails = input.match(/@/g) ?? [];
  if (emails.length >= 2) return parseRecipients(input).length >= 2;
  return false;
}
