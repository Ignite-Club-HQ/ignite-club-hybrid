/**
 * True when a recap bullet has no identifying context: it uses a vague
 * placeholder like "someone"/"a player"/"a parent"/"a volunteer" AND contains
 * no proper-noun name to anchor who/what it refers to. The recap pipeline is
 * supposed to use real names from the transcript — anything left as vague
 * filler is filtered at display time.
 */
const VAGUE_SUBJECT = /\b(?:someone|somebody|anyone|anybody|a\s+(?:player|parent|member|volunteer|coach|user|person)|another\s+(?:player|parent|member|volunteer|person)|one\s+(?:player|parent|member|volunteer)|the\s+(?:player|parent|member))\b/i;
const MONTH_OR_DAY = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec|January|February|March|April|June|July|August|September|October|November|December|Sun|Mon|Tue|Wed|Thu|Fri|Sat|Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|PS|ASAP|AM|PM|TBC|TBD|RSVP)$/;

// Bullets that just announce a media drop with no subject/context. Filtered
// unless extra descriptive context is present.
const BARE_MEDIA_SHARE = /^(?:a |an |some |the |)?(?:photo|photos|image|images|picture|pictures|video|videos|clip|clips|file|files|document|documents)\s+(?:is|are|was|were|has been|have been|got|were just)?\s*(?:shared|posted|uploaded|added|sent)\b/i;
const MEDIA_WORDS = "photo|photos|image|images|picture|pictures|video|videos|clip|clips|file|files|document|documents";
const MEDIA_ACTION_WORDS = "shared|posted|uploaded|added|sent";
const MEDIA_THANKS_RE = new RegExp(
  `\\b(?:thanks?|thank you|thanked|cheers|appreciate(?:d)?)\\b.{0,80}\\b(?:${MEDIA_ACTION_WORDS}|sharing|posting|uploading|adding|sending)\\b.{0,80}\\b(?:${MEDIA_WORDS})\\b|` +
  `\\b(?:${MEDIA_WORDS})\\b.{0,80}\\b(?:thanks?|thank you|thanked|cheers|appreciate(?:d)?)\\b`,
  "i",
);
const DESCRIPTIVE_MEDIA_SHARE_RE = new RegExp(
  `\\b(?:${MEDIA_WORDS})\\b\\s+of\\s+.{3,120}\\b(?:${MEDIA_ACTION_WORDS})\\b|` +
  `\\b(?:${MEDIA_ACTION_WORDS})\\b\\s+(?:a|an|some|the)?\\s*(?:${MEDIA_WORDS})\\b\\s+of\\s+.{3,120}`,
  "i",
);
const RECAP_LEADING_DECORATION = /^(?:\[[^\]]{1,40}\]\s*)?(?:[•\-*]\s*)?/;

const MEDIA_STOPWORDS = new Set([
  "in","to","on","the","a","an","of","from","via","with","into","by","just","now",
  "recent","recently","today","yesterday","match","game","training","chat",
  "team","group","club","thread","message","messages","conversation","and","or",
  "was","were","been","has","have","got","sent","shared","posted","uploaded","added",
  "bridgewater","white","blue","red","black","green","yellow","u6","u7","u8","u9","u10","u11","u12","u13","u14","u15","u16","u17","u18",
]);

export function isVagueRecapBullet(text: string | null | undefined): boolean {
  if (!text) return true;
  const original = text.trim();
  const t = original.replace(RECAP_LEADING_DECORATION, "").trim();
  if (!t) return true;

  // The recap AI cannot see uploaded images. If a bullet's only evidence is a
  // thank-you/comment around a photo share, it can mislead users by inventing
  // what the photo showed (e.g. "kids celebrating together"). Drop those lines
  // unless the original upload had an explicit caption, which the backend now
  // distinguishes by not exposing image-only placeholders to the model.
  if (MEDIA_THANKS_RE.test(t)) return true;
  // Legacy cached summaries may already contain invented image descriptions.
  // The UI cannot prove whether "photos of X were shared" came from a real
  // caption or model inference, so fail closed and hide it.
  if (DESCRIPTIVE_MEDIA_SHARE_RE.test(t)) return true;

  const hasProperNoun = (() => {
    const tokens = t.split(/\s+/);
    for (let i = 1; i < tokens.length; i++) {
      const raw = tokens[i].replace(/[^A-Za-z'’\-]/g, "");
      if (raw.length < 2) continue;
      if (!/^[A-Z][a-z'’\-]+$/.test(raw)) continue;
      if (MONTH_OR_DAY.test(raw)) continue;
      return true;
    }
    return false;
  })();

  // Bare "A photo was shared in the team chat" style bullets — drop unless the
  // sentence carries a descriptive subject (a name, place, opponent, event
  // title, etc.). Generic context words like "match"/"training"/"chat" don't
  // count as descriptive.
  if (BARE_MEDIA_SHARE.test(t)) {
    const remainder = t.replace(BARE_MEDIA_SHARE, "");
    const meaningful = remainder
      .toLowerCase()
      .replace(/[^a-z\s]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !MEDIA_STOPWORDS.has(w));
    if (meaningful.length === 0) return true;
  }

  // Extra safety for stale cached/generated lines that include a date prefix or
  // slightly different grammar: "A photo is/was shared in the team chat" is not
  // useful unless it says what the photo/video/file is actually of.
  if (/\b(?:photo|photos|image|images|picture|pictures|video|videos|file|files|document|documents)\b.{0,40}\b(?:is|are|was|were|has been|have been)?\s*(?:shared|posted|uploaded|added|sent)\b/i.test(t)) {
    const withoutMediaPhrase = t
      .replace(/\b(?:a|an|some|the)?\s*(?:photo|photos|image|images|picture|pictures|video|videos|file|files|document|documents)\b/gi, " ")
      .replace(/\b(?:is|are|was|were|has|have|been|shared|posted|uploaded|added|sent)\b/gi, " ")
      .replace(/\b(?:in|to|on|the|a|an|of|from|via|with|into|team|group|club|chat|thread|message|conversation|recent|activity)\b/gi, " ")
      .replace(/[^A-Za-z\s]+/g, " ")
      .replace(/\s{2,}/g, " ")
      .trim();
    const descriptiveWords = withoutMediaPhrase
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length > 2 && !MEDIA_STOPWORDS.has(w));
    if (descriptiveWords.length === 0) return true;
  }

  if (!VAGUE_SUBJECT.test(t)) return false;
  // For vague-subject bullets, a proper-noun token elsewhere is enough context.
  return !hasProperNoun;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const LONG_WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const FULL_MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAY_WORD_RE_SOURCE = "Sun(?:day)?|Mon(?:day)?|Tue(?:sday|s)?|Wed(?:nesday)?|Thu(?:rsday|rs|r)?|Fri(?:day)?|Sat(?:urday)?";

type RecapTagDate = { weekday: string; label: string; possessive: string };

export function parseRecapTagDate(rawTag: string | null | undefined): Date | null {
  if (!rawTag) return null;
  const trimmed = rawTag.trim();

  const machine = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})\s+\d{2}:\d{2}$/);
  if (machine) {
    const d = new Date(Number(machine[1]), Number(machine[2]) - 1, Number(machine[3]));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  // Explicit timeline tags generated by the backend look like "Sat 27 Jun 9:30am".
  const explicit = trimmed.match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat)\s+(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)(?:\s+(\d{4}))?\b/i);
  if (!explicit) return null;
  const month = MONTHS.findIndex((m) => m.toLowerCase() === explicit[3].toLowerCase());
  if (month < 0) return null;

  const currentYear = new Date().getFullYear();
  const years = explicit[4] ? [Number(explicit[4])] : [currentYear - 1, currentYear, currentYear + 1];
  const expectedWeekday = explicit[1].slice(0, 3).toLowerCase();
  const d = years
    .map((year) => new Date(year, month, Number(explicit[2])))
    .find((candidate) => WEEKDAYS[candidate.getDay()]?.toLowerCase() === expectedWeekday)
    ?? new Date(years[0], month, Number(explicit[2]));
  return Number.isNaN(d.getTime()) ? null : d;
}

function tagDateLabel(date: Date): RecapTagDate {
  const weekday = LONG_WEEKDAYS[date.getDay()] ?? WEEKDAYS[date.getDay()] ?? "that day";
  const shortWeekday = WEEKDAYS[date.getDay()] ?? weekday.slice(0, 3);
  const month = MONTHS[date.getMonth()] ?? "";
  const fullMonth = FULL_MONTHS[date.getMonth()] ?? month;
  const day = date.getDate();
  return {
    weekday,
    label: `${shortWeekday} ${day} ${month}`.trim(),
    possessive: `${weekday} ${day} ${fullMonth}`,
  };
}

function shiftDate(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function isAfterEndOfToday(date: Date): boolean {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  return date.getTime() > end.getTime();
}

function weekdayIndex(raw: string): number | null {
  const key = raw.toLowerCase();
  if (key.startsWith("sun")) return 0;
  if (key.startsWith("mon")) return 1;
  if (key.startsWith("tue")) return 2;
  if (key.startsWith("wed")) return 3;
  if (key.startsWith("thu")) return 4;
  if (key.startsWith("fri")) return 5;
  if (key.startsWith("sat")) return 6;
  return null;
}

function resolveModifiedWeekday(baseDate: Date, modifier: string, rawWeekday: string): Date | null {
  const target = weekdayIndex(rawWeekday);
  if (target == null) return null;
  const baseDay = baseDate.getDay();
  const mod = modifier.toLowerCase();
  let offset = (target - baseDay + 7) % 7;
  if (mod === "next" && offset === 0) offset = 7;
  if (mod === "last") offset = -(((baseDay - target + 7) % 7) || 7);
  return shiftDate(baseDate, offset);
}

/**
 * Convert relative date words copied from a message into explicit dates anchored
 * to the message send-date tag. This prevents a Wednesday message saying
 * "today's training" from being shown later as if it means the current day.
 */
export function resolveRelativeDateWords(text: string, rawTag?: string | null): string {
  if (!text) return text;
  const baseDate = parseRecapTagDate(rawTag);
  if (!baseDate) return stripRelativeDateWords(text);

  const base = tagDateLabel(baseDate);
  const next = tagDateLabel(shiftDate(baseDate, 1));
  const prev = tagDateLabel(shiftDate(baseDate, -1));

  return text
    .replace(new RegExp(`\\b(this|next|last)\\s+(${WEEKDAY_WORD_RE_SOURCE})(['’]s)?\\b`, "gi"), (match, modifier: string, weekday: string, possessive: string | undefined) => {
      const resolved = resolveModifiedWeekday(baseDate, modifier, weekday);
      if (!resolved) return match;
      const tag = tagDateLabel(resolved);
      return possessive ? tag.possessive : tag.label;
    })
    .replace(/\btoday['’]?s\b/gi, base.possessive)
    .replace(/\btomorrow['’]?s\b/gi, next.possessive)
    .replace(/\byesterday['’]?s\b/gi, prev.possessive)
    .replace(/\btonight['’]?s\b/gi, `${base.weekday} night`)
    .replace(/\bthis\s+morning\b/gi, `${base.weekday} morning`)
    .replace(/\bthis\s+afternoon\b/gi, `${base.weekday} afternoon`)
    .replace(/\bthis\s+evening\b/gi, `${base.weekday} evening`)
    .replace(/\btoday\b/gi, base.label)
    .replace(/\btonight\b/gi, `${base.weekday} night`)
    .replace(/\btomorrow\b/gi, next.label)
    .replace(/\byesterday\b/gi, prev.label)
    .replace(/\bthis\s+week\b/gi, `the week of ${base.label}`)
    .replace(/\bnext\s+week\b/gi, `the week after ${base.label}`)
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Strip machine-style `[YYYY-MM-DD HH:MM]` prefixes from AI-generated recap
 * bullets. Also strips short human time tags like `[Sat 27 Jun 9:30am]`
 * that the backend adds for the timeline view — used by surfaces that don't
 * render the timeline chip.
 */
export function stripRecapDatePrefix(text: string): string {
  if (!text) return text;
  const machine = text.match(/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\]\s*/);
  const bracket = machine ?? text.match(/^\[([^\[\]]{1,30})\]\s*/);
  const rawTag = bracket?.[1] ?? null;
  let out = bracket ? text.slice(bracket[0].length).trim() : text.trim();
  out = stripRecapSpeakerPrefix(out);
  out = rewriteRawChatEcho(out);
  out = resolveRelativeDateWords(out, rawTag);
  out = sanitizeRecapBullet(out);
  return out;
}

/**
 * Strip URLs, internal app route paths (e.g. /events/abc-123), raw UUIDs,
 * surrounding quote characters, and trailing "view event"/"open link" CTAs.
 * Caps the bullet at 140 chars on a word boundary. The summariser is asked to
 * paraphrase, but this guard catches stale cache entries or any line the model
 * leaks verbatim.
 */
const RECAP_ITEM_MAX_CHARS = 140;
const INTERNAL_ROUTE_RE = /\/(?:events?|messages?|chats?|clubs?|teams?|groups?|threads?|broadcasts?|polls?|files?|vault|photos?)\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)*\/?/gi;
const UUID_RE = /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi;
const URL_RE = /\bhttps?:\/\/\S+/gi;
const WWW_RE = /\bwww\.[^\s)]+/gi;
const VIEW_EVENT_FRAG_RE = /\b(?:view|open|see|tap|click)\s+(?:event|details|link|here|message|thread)\b[^.!?]*/gi;

export function sanitizeRecapBullet(text: string): string {
  if (!text) return text;
  let t = text;
  t = t.replace(URL_RE, "");
  t = t.replace(WWW_RE, "");
  t = t.replace(INTERNAL_ROUTE_RE, "");
  t = t.replace(UUID_RE, "");
  t = t.replace(VIEW_EVENT_FRAG_RE, "");
  // Drop directional quote glyphs and unwrap balanced straight-quoted spans so
  // bullets read as paraphrase rather than literal quotes.
  t = t.replace(/[“”„‟«»]/g, "");
  t = t.replace(/(^|\s)"([^"]{0,400})"(?=\s|[.,;!?]|$)/g, (_m, lead, inner) => `${lead}${inner}`);
  t = t.replace(/\s+([,.;:!?])/g, "$1");
  t = t.replace(/\s{2,}/g, " ").trim();
  t = t.replace(/[\s,;:–-]+$/g, "").trim();
  if (t.length > RECAP_ITEM_MAX_CHARS) {
    const slice = t.slice(0, RECAP_ITEM_MAX_CHARS);
    const lastSpace = slice.lastIndexOf(" ");
    t = (lastSpace > 80 ? slice.slice(0, lastSpace) : slice).replace(/[\s,;:–-]+$/g, "") + "…";
  }
  return t;
}

/**
 * Remove accidental speaker labels from recap bullets. This is a UI-level guard
 * for legacy cached summaries/digests; server prompts still own the real
 * summarisation quality.
 */
export function stripRecapSpeakerPrefix(text: string): string {
  if (!text) return text;
  return text
    .replace(/^([A-Z][\w'’.-]+(?:\s+[A-Z][\w'’.-]+){0,2})\s*[:\-–]\s+/u, "")
    .replace(/^(?:Person|Player|Member|Parent|Coach|Volunteer|User|Speaker|Child)\s+\d+\s*[:\-–]\s+/i, "")
    .trim();
}

/**
 * Last-resort display guard for old cached recap rows where the model/digest
 * leaked raw chat wording. This does not replace server-side summarisation, but
 * it prevents obvious verbatim lines like "Yep I can" or "Could someone..."
 * from being shown while legacy cache entries expire.
 */
export function rewriteRawChatEcho(text: string): string {
  if (!text) return text;
  let t = text.replace(/\s+/g, " ").trim();
  // Strip any leaked pseudonyms from the privacy scrubber so users never see
  // "Child 9" / "Person 4" in a recap. These are internal labels.
  t = t
    .replace(/\bChild\s+\d+\b/gi, "a child")
    .replace(/\b(?:Person|Player|Member|Parent|Coach|Volunteer|User|Speaker)\s+\d+\b/gi, "someone");
  const lower = t.toLowerCase();

  if (/\balso interested\b.*\bdepending on days\b/i.test(t)) {
    return "Another member is interested if the dates work";
  }
  if (/\b(?:could|can)\s+someone\b.*\b(?:linesperson|line\s*person|ref(?:eree)?)\b/i.test(t)) {
    return "A match official was requested";
  }
  if (/^(?:yep|yes|yeah)\b.*\bi can\b.*\b(?:this week|today|do it|cover)/i.test(t) || /^i can\b/i.test(t)) {
    return "A volunteer confirmed they can cover the match official role";
  }
  if (/^sorry\b.*\b(?:would have loved|can't|cannot|unavailable)\b/i.test(t) || /\bi would have loved to\b/i.test(t)) {
    return "One member declined the match official request";
  }
  if (/\b(?:three|3)\s+out\b.*\bsaturday\b/i.test(t)) {
    return "Three players are out for Saturday, so squad numbers are tight and a replacement may be needed";
  }
  if (/\bgame\s+(?:has\s+)?moved\b/i.test(t) && /\bsummit\b/i.test(t)) {
    const time = t.match(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i)?.[0]?.replace(/\s+/g, "") ?? null;
    const game = `Saturday's game has moved to Summit${time ? ` at ${time}` : ""}`;
    if (/\btwo day tournament\b|\btwo-day tournament\b|\bgepps\s+cross\b/i.test(t)) {
      return `${game}; interest was also requested for a two-day tournament at Gepps Cross in the first week of holidays`;
    }
    return game;
  }

  // Generic guard: if a long line still reads like a chat message, remove
  // chatty lead-ins so it is at least less transcript-like.
  if (t.split(/\s+/).length > 12 && /\b(?:please|anyone|let me know|hi folks|team,|sorry|yep|also interested)\b/i.test(lower)) {
    return t
      .replace(/^(?:hi folks|hi team|team),?\s+/i, "")
      .replace(/\bplease\b/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  return t;
}

/**
 * Final UI guard for stale cached recaps or model slips. If there is no message
 * send-date tag to anchor relative wording, remove the relative phrase rather
 * than showing an inaccurate date.
 */
export function stripRelativeDateWords(text: string): string {
  if (!text) return text;
  return text
    .replace(new RegExp(`\\b(?:this|next|last)\\s+(${WEEKDAY_WORD_RE_SOURCE})(['’]s)?\\b`, "gi"), (_match, weekday: string, possessive = "") => `${weekday}${possessive}`)
    .replace(/\b(?:today|tonight|tomorrow|yesterday)['’]?s\s+/gi, "")
    .replace(/\b(?:this\s+morning|this\s+afternoon|this\s+evening|today|tonight|tomorrow|yesterday|this\s+week|next\s+week)\b/gi, "")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\b(for|on|at)\s+([,.;:]|$)/gi, "")
    .trim();
}

/**
 * Parse a leading bracket time tag (e.g. "[Sat 27 Jun 9:30am] Coach asked …")
 * and split it from the bullet text. Used by the recap timeline UIs.
 */
export function parseRecapTimeTag(text: string): { time: string | null; text: string } {
  if (!text) return { time: null, text: "" };
  const machine = text.match(/^\[(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\]\s*/);
  const bracket = machine ?? text.match(/^\[([^\[\]]{1,30})\]\s*/);
  if (!bracket) {
    return { time: null, text: sanitizeRecapBullet(stripRelativeDateWords(rewriteRawChatEcho(stripRecapSpeakerPrefix(text.trim())))) };
  }

  const rawTag = bracket[1].trim();
  const isLegacyRelativeTag = /\b(?:today|yest|yesterday|tomorrow)\b/i.test(rawTag) || /^\d{1,2}(?::\d{2})?\s*(?:am|pm)$/i.test(rawTag);
  const tagDate = parseRecapTagDate(rawTag);
  const isFutureEventTag = !!tagDate && isAfterEndOfToday(tagDate);
  const body = text.slice(bracket[0].length).trim();
  return {
    time: isLegacyRelativeTag || isFutureEventTag ? null : rawTag,
    text: sanitizeRecapBullet(resolveRelativeDateWords(rewriteRawChatEcho(stripRecapSpeakerPrefix(body)), isLegacyRelativeTag ? null : rawTag)),
  };
}
