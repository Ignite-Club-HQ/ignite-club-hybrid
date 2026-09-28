/**
 * iCalendar (.ics) export utilities.
 * Generates RFC 5545 compatible files that work with Google Calendar,
 * Outlook, Apple Calendar and any other standards-compliant client.
 */
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { Filesystem, Directory, Encoding } from "@capacitor/filesystem";

export interface IcsEventInput {
  id: string;
  title: string;
  type?: string | null;
  event_date: string; // ISO date or full ISO datetime
  start_time?: string | null; // "HH:MM" or "HH:MM:SS"
  end_time?: string | null;   // "HH:MM" or "HH:MM:SS"
  description?: string | null;
  location_name?: string | null;
  address?: string | null;
  suburb?: string | null;
  state?: string | null;
  postcode?: string | null;
  is_cancelled?: boolean | null;
  updated_at?: string | null;
  url?: string | null; // public link to event
}

const PRODID = "-//Ignite Club//Schedule Export//EN";
const CRLF = "\r\n";

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

/** Convert a JS Date to a UTC ICS timestamp (YYYYMMDDTHHmmssZ). */
function toIcsUtc(date: Date): string {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Build a Date from a YYYY-MM-DD (or ISO) date plus an optional HH:MM[:SS]. */
function combineDateAndTime(eventDate: string, time?: string | null): Date {
  // event_date may be "2025-01-15" or a full ISO string. Normalise to date part.
  const datePart = eventDate.includes("T") ? eventDate.split("T")[0] : eventDate;
  const t = (time || "00:00:00").split(":");
  const hh = parseInt(t[0] || "0", 10);
  const mm = parseInt(t[1] || "0", 10);
  const ss = parseInt(t[2] || "0", 10);
  // Interpret as local time — calendars will receive UTC but the wall-clock time
  // a user typed in the app is what they expect to see in their calendar.
  const [y, mo, d] = datePart.split("-").map((s) => parseInt(s, 10));
  return new Date(y, (mo || 1) - 1, d || 1, hh, mm, ss);
}

/** Escape text per RFC 5545 §3.3.11 (TEXT). */
function escapeIcsText(input: string): string {
  return input
    .replace(/\\/g, "\\\\")
    .replace(/\r\n|\r|\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

/** Fold long lines at 75 octets per RFC 5545 §3.1. */
function foldLine(line: string): string {
  if (line.length <= 75) return line;
  const chunks: string[] = [];
  let i = 0;
  while (i < line.length) {
    chunks.push((i === 0 ? "" : " ") + line.slice(i, i + 74));
    i += 74;
  }
  return chunks.join(CRLF);
}

function buildLocation(e: IcsEventInput): string | null {
  const parts = [
    e.location_name,
    e.address,
    [e.suburb, e.state, e.postcode].filter(Boolean).join(" "),
  ]
    .map((p) => (p ? String(p).trim() : ""))
    .filter(Boolean);
  return parts.length ? parts.join(", ") : null;
}

function eventToVEvent(e: IcsEventInput): string {
  const start = combineDateAndTime(e.event_date, e.start_time);
  // Default duration: 1 hour if no end time provided.
  const end = e.end_time
    ? combineDateAndTime(e.event_date, e.end_time)
    : new Date(start.getTime() + 60 * 60 * 1000);
  const dtStamp = toIcsUtc(new Date());
  const lastModified = e.updated_at ? toIcsUtc(new Date(e.updated_at)) : dtStamp;

  const lines: string[] = [
    "BEGIN:VEVENT",
    `UID:${e.id}@ignite.invalid`,
    `DTSTAMP:${dtStamp}`,
    `LAST-MODIFIED:${lastModified}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(e.title || "Event")}`,
  ];

  const location = buildLocation(e);
  if (location) lines.push(`LOCATION:${escapeIcsText(location)}`);

  const descParts: string[] = [];
  if (e.description) descParts.push(e.description);
  if (e.url) descParts.push(`View in Ignite: ${e.url}`);
  if (descParts.length) {
    lines.push(`DESCRIPTION:${escapeIcsText(descParts.join("\n\n"))}`);
  }
  if (e.url) lines.push(`URL:${e.url}`);

  if (e.type) lines.push(`CATEGORIES:${escapeIcsText(e.type)}`);
  if (e.is_cancelled) lines.push("STATUS:CANCELLED");

  lines.push("END:VEVENT");
  return lines.map(foldLine).join(CRLF);
}

/** Build a complete .ics document for one or many events. */
export function buildIcs(events: IcsEventInput[], calendarName = "Ignite Schedule"): string {
  const header = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeIcsText(calendarName)}`,
  ]
    .map(foldLine)
    .join(CRLF);
  const body = events.map(eventToVEvent).join(CRLF);
  return [header, body, "END:VCALENDAR"].join(CRLF) + CRLF;
}

/** Sanitise a string for use as a filename. */
function sanitiseFilename(name: string): string {
  return name.replace(/[^a-z0-9-_]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "event";
}

/**
 * Trigger download / share of an .ics file.
 * - Web: triggers a normal browser download.
 * - Native (Capacitor): writes to Cache directory and opens the share sheet
 *   so users can save into Apple/Google/Outlook Calendar.
 */
export async function downloadIcs(filenameBase: string, ics: string): Promise<void> {
  const filename = `${sanitiseFilename(filenameBase)}.ics`;

  if (Capacitor.isNativePlatform()) {
    try {
      const res = await Filesystem.writeFile({
        path: filename,
        data: ics,
        directory: Directory.Cache,
        encoding: Encoding.UTF8,
      });
      await Share.share({
        title: filenameBase,
        url: res.uri,
        dialogTitle: "Add to Calendar",
      });
      return;
    } catch (err) {
      // Fall through to data-URL fallback below.
      console.warn("[icsExport] Native share failed, falling back", err);
    }
  }

  // Detect sandboxed iframe (e.g. Lovable preview) where downloads + popups are blocked.
  const inSandboxedIframe = (() => {
    try {
      return window.self !== window.top;
    } catch {
      return true;
    }
  })();

  // In a sandboxed preview, skip the (silently failing) download and surface
  // the .ics content via a global event so a UI fallback dialog can show it.
  if (inSandboxedIframe) {
    const dataUrl = `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
    window.dispatchEvent(
      new CustomEvent("ics-preview-fallback", {
        detail: { filename, ics, dataUrl },
      }),
    );
    return;
  }

  // Web fallback: blob download.
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
  } catch (err) {
    console.warn("[icsExport] Anchor download failed", err);
  }

  // Defer revoke so the browser has time to start the download.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Convenience: build + download for a single event. */
export async function exportEventIcs(event: IcsEventInput): Promise<void> {
  const ics = buildIcs([event], event.title || "Event");
  await downloadIcs(event.title || "event", ics);
}

/** Convenience: build + download for a collection of events. */
export async function exportEventsIcs(
  events: IcsEventInput[],
  calendarName = "Ignite Schedule",
  filenameBase = "ignite-schedule",
): Promise<void> {
  const ics = buildIcs(events, calendarName);
  await downloadIcs(filenameBase, ics);
}
