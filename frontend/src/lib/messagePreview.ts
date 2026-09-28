// Shared utilities for formatting chat message previews in inbox/list views.
// Replaces raw tokens like @[Name](id), [event:uuid], [poll:uuid] with
// human-readable text so previews never expose internal IDs.

import { isVideoUrl } from "./videoUtils";

const MENTION_RE = /@\[([^\]]+)\]\(([^)]+)\)/g;
const EVENT_TOKEN_RE = /\[event:([0-9a-f-]{36})\]/gi;
const POLL_TOKEN_RE = /\[poll:([0-9a-f-]{36})\]/gi;
const BOARD_TOKEN_RE = /\[board:([0-9a-f-]{36})\]/gi;
const NEWS_TOKEN_RE = /\[news:([0-9a-f-]{36})\]/gi;
const GALLERY_TOKEN_RE = /\[gallery:([0-9a-f-]{36})\]/gi;
const GALLERY_PROMPT_TOKEN_RE = /\[galleryprompt:([0-9a-f-]{36})\]/gi;
const PUBLISH_TOKEN_RE = /\[publish:([0-9a-f-]{36})\]/gi;
const VAULT_FILE_TOKEN_RE = /\[vault:([0-9a-f-]{36})\]/gi;
const VAULT_FOLDER_TOKEN_RE = /\[vaultfolder:([0-9a-f-]{36})\]/gi;
const VAULT_ROOT_TOKEN_RE = /\[vaultroot:(team|club):([0-9a-f-]{36})\]/gi;
// Markdown-style links: [label](url)
const MD_LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g;

type NameLookup = Map<string, string> | Record<string, string>;

export interface MessagePreviewOptions {
  eventTitles?: NameLookup;
  vaultFolderNames?: NameLookup;
  vaultFileNames?: NameLookup;
}

/**
 * Replace mention tokens "@[Name](id)" with "@Name".
 */
export function stripMentionFormatting(text: string): string {
  return text.replace(MENTION_RE, "@$1");
}

function extractIds(re: RegExp, text: string | null | undefined): string[] {
  if (!text) return [];
  const ids: string[] = [];
  const local = new RegExp(re.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = local.exec(text)) !== null) {
    if (m[1]) ids.push(m[1].toLowerCase());
  }
  return ids;
}

/**
 * Extract all event UUIDs referenced in a message body.
 * Useful for prefetching event titles before rendering a preview.
 */
export function extractEventIds(text: string | null | undefined): string[] {
  return extractIds(EVENT_TOKEN_RE, text);
}

/**
 * Extract all vault folder UUIDs referenced in a message body so previews
 * can resolve and display the actual folder name.
 */
export function extractVaultFolderIds(text: string | null | undefined): string[] {
  return extractIds(VAULT_FOLDER_TOKEN_RE, text);
}

/**
 * Extract all vault file UUIDs referenced in a message body so previews
 * can resolve and display the actual file name.
 */
export function extractVaultFileIds(text: string | null | undefined): string[] {
  return extractIds(VAULT_FILE_TOKEN_RE, text);
}

function makeLookup(map?: NameLookup) {
  return (id: string): string | undefined => {
    if (!map) return undefined;
    if (map instanceof Map) return map.get(id.toLowerCase()) ?? map.get(id);
    return map[id.toLowerCase()] ?? map[id];
  };
}

/**
 * Convert a raw chat message body into a clean single-line preview suitable
 * for inbox / conversation list rows. Removes raw IDs and replaces tokens
 * with friendly placeholders.
 *
 * Pass name lookup maps so referenced events / vault folders / vault files
 * render with their real names instead of the generic placeholder.
 */
export function formatMessagePreview(
  text: string | null | undefined,
  optionsOrEventTitles?: MessagePreviewOptions | NameLookup,
): string {
  if (!text) return "";

  // Backwards compatibility: previous signature accepted an event-titles map
  // directly as the second argument. Detect this when the value is a Map, or
  // a plain object whose keys are NOT the known option names.
  const isOptionsObject = (v: unknown): v is MessagePreviewOptions => {
    if (!v || typeof v !== "object" || v instanceof Map) return false;
    const keys = Object.keys(v);
    if (keys.length === 0) return true; // empty {} treated as options
    return keys.some((k) =>
      k === "eventTitles" || k === "vaultFolderNames" || k === "vaultFileNames",
    );
  };

  const options: MessagePreviewOptions = isOptionsObject(optionsOrEventTitles)
    ? optionsOrEventTitles
    : optionsOrEventTitles
    ? { eventTitles: optionsOrEventTitles as NameLookup }
    : {};

  const lookupEvent = makeLookup(options.eventTitles);
  const lookupFolder = makeLookup(options.vaultFolderNames);
  const lookupFile = makeLookup(options.vaultFileNames);

  let out = text;

  out = out.replace(EVENT_TOKEN_RE, (_match, id: string) => {
    const title = lookupEvent(id);
    return title ? ` 📅 ${title} ` : " 📅 Event ";
  });
  out = out.replace(POLL_TOKEN_RE, " 📊 Poll ");
  out = out.replace(BOARD_TOKEN_RE, " 🏟️ Live board ");
  out = out.replace(NEWS_TOKEN_RE, " 📰 Club news ");
  out = out.replace(GALLERY_PROMPT_TOKEN_RE, " 📸 Reminder: add team photos ");
  out = out.replace(GALLERY_TOKEN_RE, " 📸 New team photos ");
  out = out.replace(PUBLISH_TOKEN_RE, " ");
  out = out.replace(VAULT_ROOT_TOKEN_RE, (_m, scope: string) =>
    scope?.toLowerCase() === "team" ? " 🗂️ Team vault " : " 🗂️ Club vault ",
  );
  out = out.replace(VAULT_FOLDER_TOKEN_RE, (_m, id: string) => {
    const name = lookupFolder(id);
    return name ? ` 📁 ${name} ` : " 📁 Folder ";
  });
  out = out.replace(VAULT_FILE_TOKEN_RE, (_m, id: string) => {
    const name = lookupFile(id);
    return name ? ` 📎 ${name} ` : " 📎 File ";
  });
  out = out.replace(MD_LINK_RE, "$1");
  out = stripMentionFormatting(out);
  out = out.replace(/\s+/g, " ").trim();

  return out;
}

/**
 * Returns a preview string, falling back to "Image" if the message is image-only.
 */
export function getMessagePreviewText(
  text: string | null | undefined,
  imageUrl?: string | null,
  optionsOrEventTitles?: MessagePreviewOptions | NameLookup,
): string {
  const formatted = formatMessagePreview(text, optionsOrEventTitles);
  if (formatted) return formatted;
  if (imageUrl) return isVideoUrl(imageUrl) ? "🎬 Video" : "Image";
  return "";
}
