import { supabase } from "@/integrations/supabase/client";

/**
 * Auto-sync chat attachments (images and external links) to the relevant file vault.
 *
 * Folder strategy (highest priority first):
 *   1. Role-restricted group chat (e.g. "Coaches", "Team Admins", "Committee") →
 *      one folder per chat group, named after the group, club-level, with the
 *      group's allowed_roles persisted on the folder so only those roles see it.
 *   2. Club Admin Chat (member ↔ club admin DM) → a single "Club Admin Chat"
 *      folder per club, restricted to club admins.
 *   3. Team chat → team-level "Chat Images" / "Chat Links" folders.
 *   4. Club-wide chat (no team, no group) → club-level "Chat Images" /
 *      "Chat Links" folders.
 *
 * Called fire-and-forget after a chat message is successfully sent.
 */

// app_role values that, when present in a chat group's allowed_roles, mean the
// chat is role-restricted (and therefore deserves its own dedicated subfolder).
// Open groups that simply mirror club / team membership are NOT considered
// restricted and continue to use the generic Chat Images / Chat Links folders.
const RESTRICTED_ROLE_MARKERS = new Set([
  "club_admin",
  "committee_member",
  "coach",
  "team_admin",
  "league_admin",
]);

function isRestrictedGroup(allowedRoles?: string[] | null): boolean {
  if (!allowedRoles || allowedRoles.length === 0) return false;
  return allowedRoles.some((r) => RESTRICTED_ROLE_MARKERS.has(r));
}

export async function syncChatAttachmentToVault({
  imageUrl,
  text,
  userId,
  clubId,
  teamId,
  chatGroupId,
  chatGroupName,
  chatGroupAllowedRoles,
  isClubAdminChat,
}: {
  imageUrl: string | null;
  text: string;
  userId: string;
  clubId: string;
  teamId?: string | null;
  /** Set when sending in a chat group — used to scope the folder to that group. */
  chatGroupId?: string | null;
  chatGroupName?: string | null;
  chatGroupAllowedRoles?: string[] | null;
  /** Set true for Club Admin Chat (member ↔ club admin DM). */
  isClubAdminChat?: boolean;
}) {
  try {
    const imageEntries: {
      file_url: string;
      name: string;
      file_type: string | null;
      is_external_link: boolean;
      file_size: number | null;
    }[] = [];

    const linkEntries: typeof imageEntries = [];

    // 1. If there's an image attachment, add it
    if (imageUrl) {
      const fileName = extractFileName(imageUrl) || `chat-attachment-${Date.now()}`;
      const fileType = guessFileType(imageUrl);
      imageEntries.push({
        file_url: imageUrl,
        name: fileName,
        file_type: fileType,
        is_external_link: false,
        file_size: null,
      });
    }

    // 2. Extract any URLs from the message text that look like files/documents
    const fileUrls = extractFileUrls(text);
    for (const url of fileUrls) {
      const fileName = extractFileName(url) || url;
      linkEntries.push({
        file_url: url,
        name: fileName,
        file_type: guessFileType(url),
        is_external_link: true,
        file_size: null,
      });
    }

    if (imageEntries.length === 0 && linkEntries.length === 0) return;

    // Check for duplicates
    const allUrls = [...imageEntries, ...linkEntries].map((e) => e.file_url);
    const { data: existing } = await supabase
      .from("vault_files")
      .select("file_url")
      .eq("club_id", clubId)
      .in("file_url", allUrls);

    const existingUrls = new Set((existing || []).map((e) => e.file_url));
    const newImages = imageEntries.filter((e) => !existingUrls.has(e.file_url));
    const newLinks = linkEntries.filter((e) => !existingUrls.has(e.file_url));
    if (newImages.length === 0 && newLinks.length === 0) return;

    // Resolve target folder(s) based on chat type.
    const groupIsRestricted = isRestrictedGroup(chatGroupAllowedRoles);

    // Case 1: dedicated folder per chat group (any group chat gets its own
    // folder, named after the group). Role-restricted groups persist their
    // allowed_roles so visibility matches the chat; open groups leave
    // restricted_roles null and inherit standard chat-folder visibility.
    if (chatGroupId && chatGroupName) {
      const folderId = await getOrCreateGroupFolder(
        clubId,
        chatGroupName,
        userId,
        chatGroupId,
        groupIsRestricted ? (chatGroupAllowedRoles as string[]) : null
      );
      await insertVaultRows(folderId, clubId, userId, null, [
        ...newImages,
        ...newLinks,
      ]);
      return;
    }

    // Case 2: Club Admin Chat — single shared folder per club, club admins only.
    if (isClubAdminChat) {
      const folderId = await getOrCreateRestrictedFolder(
        clubId,
        "Club Admin Chat",
        userId,
        ["club_admin"]
      );
      await insertVaultRows(folderId, clubId, userId, null, [
        ...newImages,
        ...newLinks,
      ]);
      return;
    }

    // Case 3 & 4: existing behavior — generic Chat Images / Chat Links folders.
    if (newImages.length > 0) {
      const folderId = await getOrCreateFolder(clubId, "Chat Images", userId, teamId || null);
      await insertVaultRows(folderId, clubId, userId, teamId || null, newImages);
    }

    if (newLinks.length > 0) {
      const folderId = await getOrCreateFolder(clubId, "Chat Links", userId, teamId || null);
      await insertVaultRows(folderId, clubId, userId, teamId || null, newLinks);
    }
  } catch (err) {
    console.warn("chatVaultSync error:", err);
  }
}

async function insertVaultRows(
  folderId: string | null,
  clubId: string,
  userId: string,
  teamId: string | null,
  entries: {
    file_url: string;
    name: string;
    file_type: string | null;
    is_external_link: boolean;
    file_size: number | null;
  }[]
) {
  if (entries.length === 0) return;
  const rows = entries.map((e) => ({
    ...e,
    club_id: clubId,
    team_id: teamId,
    uploaded_by: userId,
    folder_id: folderId,
  }));
  const { error } = await supabase.from("vault_files").insert(rows);
  if (error) console.warn("Failed to sync chat attachment to vault:", error);
}

// Cache folder IDs to avoid repeated lookups within a session.
const folderCache = new Map<string, string>();

async function getOrCreateFolder(
  clubId: string,
  folderName: string,
  userId: string,
  teamId?: string | null
): Promise<string | null> {
  const cacheKey = `${clubId}:${teamId || "club"}:generic:${folderName}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  let query = supabase
    .from("vault_folders")
    .select("id")
    .eq("club_id", clubId)
    .eq("name", folderName)
    .is("parent_id", null)
    .is("chat_group_id", null)
    .is("restricted_roles", null)
    .is("deleted_at", null);

  if (teamId) {
    query = query.eq("team_id", teamId);
  } else {
    query = query.is("team_id", null);
  }

  const { data } = await query.maybeSingle();

  if (data) {
    folderCache.set(cacheKey, data.id);
    return data.id;
  }

  const insertData = {
    club_id: clubId,
    name: folderName,
    created_by: userId,
    team_id: teamId || null,
  };

  const { data: newFolder, error } = await supabase
    .from("vault_folders")
    .insert(insertData as any)
    .select("id")
    .single();

  if (error || !newFolder) {
    console.warn("Failed to create vault folder:", error);
    return null;
  }

  folderCache.set(cacheKey, newFolder.id);
  return newFolder.id;
}

async function getOrCreateGroupFolder(
  clubId: string,
  folderName: string,
  userId: string,
  chatGroupId: string,
  allowedRoles: string[] | null
): Promise<string | null> {
  const cacheKey = `${clubId}:group:${chatGroupId}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  // Look up by chat_group_id (stable even if the group is renamed or
  // the folder lives nested under a parent folder).
  const { data } = await supabase
    .from("vault_folders")
    .select("id")
    .eq("club_id", clubId)
    .eq("chat_group_id", chatGroupId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (data) {
    folderCache.set(cacheKey, data.id);
    return data.id;
  }

  const { data: newFolder, error } = await supabase
    .from("vault_folders")
    .insert({
      club_id: clubId,
      name: folderName,
      created_by: userId,
      team_id: null,
      chat_group_id: chatGroupId,
      restricted_roles: (allowedRoles && allowedRoles.length > 0
        ? allowedRoles
        : null) as any,
    } as any)
    .select("id")
    .single();

  if (error || !newFolder) {
    console.warn("Failed to create chat group vault folder:", error);
    return null;
  }

  folderCache.set(cacheKey, newFolder.id);
  return newFolder.id;
}

async function getOrCreateRestrictedFolder(
  clubId: string,
  folderName: string,
  userId: string,
  allowedRoles: string[]
): Promise<string | null> {
  const cacheKey = `${clubId}:restricted:${folderName}`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  const { data } = await supabase
    .from("vault_folders")
    .select("id")
    .eq("club_id", clubId)
    .eq("name", folderName)
    .is("team_id", null)
    .is("parent_id", null)
    .is("chat_group_id", null)
    .not("restricted_roles", "is", null)
    .is("deleted_at", null)
    .maybeSingle();

  if (data) {
    folderCache.set(cacheKey, data.id);
    return data.id;
  }

  const { data: newFolder, error } = await supabase
    .from("vault_folders")
    .insert({
      club_id: clubId,
      name: folderName,
      created_by: userId,
      team_id: null,
      restricted_roles: allowedRoles as any,
    } as any)
    .select("id")
    .single();

  if (error || !newFolder) {
    console.warn("Failed to create restricted vault folder:", error);
    return null;
  }

  folderCache.set(cacheKey, newFolder.id);
  return newFolder.id;
}

// File extensions we consider worth syncing as external links
const FILE_EXTENSIONS = /\.(pdf|doc|docx|xls|xlsx|ppt|pptx|csv|zip|rar|txt|rtf|odt|ods|odp|png|jpg|jpeg|gif|webp|svg|mp4|mov|avi|mp3|wav)$/i;

function extractFileUrls(text: string): string[] {
  if (!text) return [];
  const urlRegex = /(?:https?:\/\/)[^\s]+/gi;
  const matches = text.match(urlRegex) || [];
  return matches.filter(
    (url) =>
      FILE_EXTENSIONS.test(url) ||
      url.includes("drive.google.com") ||
      url.includes("docs.google.com") ||
      url.includes("sheets.google.com") ||
      url.includes("slides.google.com") ||
      url.includes("forms.google.com") ||
      url.includes("goo.gl") ||
      url.includes("dropbox.com")
  );
}

// Generic action segments that appear at the end of Google file URLs and are
// NOT real filenames. Strip these before treating a path segment as a name.
const GOOGLE_ACTION_SEGMENTS = new Set([
  "edit",
  "view",
  "preview",
  "comment",
  "copy",
  "template",
  "htmlview",
  "pub",
  "embed",
  "viewform",
  "formresponse",
]);

function extractFileName(url: string): string | null {
  try {
    // Google links never carry the document title in the URL — always defer to
    // the friendly type-based label so we never end up with "edit" / "view".
    const googleLabel = googleDocLabel(url);
    if (googleLabel) return googleLabel;

    const pathname = new URL(url).pathname;
    const segments = pathname.split("/").filter(Boolean);
    // Walk from the end, skipping generic action words, until we find a
    // segment that looks like a real filename.
    for (let i = segments.length - 1; i >= 0; i--) {
      const seg = segments[i];
      if (GOOGLE_ACTION_SEGMENTS.has(seg.toLowerCase())) continue;
      if (seg.includes(".")) return decodeURIComponent(seg);
      // Otherwise: not a filename; fall through and bail.
      break;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Return a friendly label for a Google Drive / Docs / Sheets / Slides / Forms
 * URL, e.g. "Google Sheet (1aB2cD)" or "Google Drive folder (1aB2cD)".
 *
 * Handles all common URL shapes:
 *   • https://reference.invalid<id>/edit
 *   • https://reference.invalid<id>/viewform
 *   • https://reference.invalid<id>/view
 *   • https://reference.invalid<id>
 *   • https://reference.invalid<id>
 *   • https://reference.invalid<id>
 *   • https://reference.invalid<id>&export=download
 *   • https://reference.invalid<id>
 *   • https://reference.invalid<id>
 *   • Short links: https://reference.invalid and https://reference.invalid
 *
 * Returns `null` for non-Google URLs.
 */
function googleDocLabel(url: string): string | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    if (
      !host.endsWith("google.com") &&
      !host.endsWith("goo.gl") &&
      !host.endsWith("googleusercontent.com")
    ) {
      return null;
    }

    const path = u.pathname.toLowerCase();
    let kind: string | null = null;
    let isFolder = false;

    if (path.includes("/spreadsheets/")) kind = "Google Sheet";
    else if (path.includes("/document/")) kind = "Google Doc";
    else if (path.includes("/presentation/")) kind = "Google Slides";
    else if (path.includes("/forms/")) kind = "Google Form";
    else if (path.includes("/drawings/")) kind = "Google Drawing";
    else if (path.includes("/folders/") || path.includes("/folderview")) {
      kind = "Google Drive folder";
      isFolder = true;
    } else if (host === "goo.gl" || host.endsWith(".goo.gl")) {
      kind = "Google share link";
    } else if (host.startsWith("drive.") || host.endsWith("googleusercontent.com")) {
      kind = "Google Drive file";
    } else if (host.startsWith("docs.")) {
      kind = "Google Doc";
    } else {
      return null;
    }

    // Try to extract a stable ID for disambiguation. Order matters:
    //   1. /folders/<id>   (Drive folder)
    //   2. /d/e/<id>       (Forms with response keys)
    //   3. /d/<id>         (most Docs/Sheets/Slides/Drive file URLs)
    //   4. ?id=<id>        (open / uc / thumbnail / older share links)
    let id: string | null = null;
    const folderMatch = u.pathname.match(/\/folders\/([a-zA-Z0-9_-]+)/);
    const deMatch = u.pathname.match(/\/d\/e\/([a-zA-Z0-9_-]+)/);
    const dMatch = u.pathname.match(/\/d\/([a-zA-Z0-9_-]+)/);
    const fileMatch = u.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
    const idParam = u.searchParams.get("id");

    if (isFolder && folderMatch) id = folderMatch[1];
    else if (fileMatch) id = fileMatch[1];
    else if (deMatch) id = deMatch[1];
    else if (dMatch) id = dMatch[1];
    else if (folderMatch) id = folderMatch[1];
    else if (idParam) id = idParam;

    if (id) {
      const shortId = id.slice(0, 6);
      return `${kind} (${shortId})`;
    }
    return kind;
  } catch {
    return null;
  }
}

function guessFileType(url: string): string | null {
  const lower = url.toLowerCase();
  if (/\.(jpg|jpeg)/.test(lower)) return "image/jpeg";
  if (/\.png/.test(lower)) return "image/png";
  if (/\.gif/.test(lower)) return "image/gif";
  if (/\.webp/.test(lower)) return "image/webp";
  if (/\.pdf/.test(lower)) return "application/pdf";
  if (/\.doc(x)?/.test(lower)) return "application/msword";
  if (/\.xls(x)?/.test(lower)) return "application/vnd.ms-excel";
  if (/\.ppt(x)?/.test(lower)) return "application/vnd.ms-powerpoint";
  if (/\.csv/.test(lower)) return "text/csv";
  if (/\.mp4/.test(lower)) return "video/mp4";
  if (/\.mp3/.test(lower)) return "audio/mpeg";
  if (url.includes("drive.google.com") || url.includes("docs.google.com")) return "link/google-drive";
  if (url.includes("dropbox.com")) return "link/dropbox";
  return null;
}
