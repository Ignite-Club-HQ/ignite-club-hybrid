import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";

export type ChatSharedMediaType = "team" | "club" | "group" | "dm" | "broadcast";

export type SharedMediaKind = "photo" | "file" | "link";

export interface SharedMediaItem {
  /** Composite id: messageId or messageId:childKey for derived file/link items */
  id: string;
  /** Underlying message id */
  message_id: string;
  kind: SharedMediaKind;
  /** Photo url when kind === 'photo' */
  image_url: string;
  /** External URL when kind === 'link' */
  url?: string;
  /** Display label for files/links */
  label?: string;
  /** Optional sub-label (filename ext, hostname, etc.) */
  sublabel?: string;
  /** Vault file id / folder id when kind === 'file' (for opening) */
  vaultFileId?: string;
  vaultFolderId?: string;
  vaultRootScope?: "team" | "club";
  vaultRootId?: string;
  created_at: string;
  author_id: string;
  author_name: string | null;
  author_avatar: string | null;
}

interface RawRow {
  id: string;
  image_url: string | null;
  text: string | null;
  created_at: string;
  author_id: string;
}

const TABLE_AND_FILTER: Record<ChatSharedMediaType, { table: string; column: string | null }> = {
  team: { table: "team_messages", column: "team_id" },
  club: { table: "club_messages", column: "club_id" },
  group: { table: "group_messages", column: "group_id" },
  dm: { table: "direct_messages", column: "conversation_id" },
  broadcast: { table: "broadcast_messages", column: null },
};

const DEFAULT_LIMIT = 12;

const VAULT_FILE_RE = /\[vault:([0-9a-f-]{36})\]/gi;
const VAULT_FOLDER_RE = /\[vaultfolder:([0-9a-f-]{36})\]/gi;
const VAULT_ROOT_RE = /\[vaultroot:(team|club):([0-9a-f-]{36})\]/gi;
const URL_RE = /https?:\/\/[^\s)]+/gi;
const ALL_TOKEN_RE = /\[(?:event|vault|vaultfolder|vaultroot:(?:team|club)):[0-9a-f-]{36}\]/gi;

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function useChatSharedMedia(
  chatType: ChatSharedMediaType,
  chatId: string | undefined,
  options?: { limit?: number; enabled?: boolean }
) {
  const rawLimit = options?.limit;
  // Defensive normalisation: fall back to the default for any non-positive,
  // non-finite or fractional value so callers can never trigger an unbounded
  // query or receive an unexpected result count.
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.floor(rawLimit)
      : DEFAULT_LIMIT;
  const enabled = (options?.enabled ?? true) && !!chatId;


  return useQuery({
    queryKey: ["chat-shared-media", chatType, chatId, limit],
    queryFn: async (): Promise<SharedMediaItem[]> => {
      const { table, column } = TABLE_AND_FILTER[chatType];

      // Fetch larger window of recent messages so we can also derive file & link items
      // from text content (not just image_url rows).
      const fetchLimit = Math.max(limit * 3, 60);

      let query = (supabase as any)
        .from(table)
        .select("id, image_url, text, created_at, author_id")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(fetchLimit);

      if (column && chatId) {
        query = query.eq(column, chatId);
      }

      const { data, error } = await query;
      if (error) {
        console.warn("[useChatSharedMedia] error:", error);
        return [];
      }

      const rows = (data as RawRow[] | null) ?? [];

      // Pre-load profiles
      const authorIds = Array.from(new Set(rows.map((r) => r.author_id)));
      const profileMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();
      if (authorIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(authorIds);
        for (const p of profiles ?? []) {
          profileMap.set(p.id, { display_name: p.display_name, avatar_url: p.avatar_url });
        }
      }

      // Collect vault file & folder ids referenced across all rows for batch lookup
      const allFileIds = new Set<string>();
      const allFolderIds = new Set<string>();
      for (const r of rows) {
        const t = r.text ?? "";
        for (const m of t.matchAll(VAULT_FILE_RE)) allFileIds.add(m[1]);
        for (const m of t.matchAll(VAULT_FOLDER_RE)) allFolderIds.add(m[1]);
      }

      const fileNameMap = new Map<string, { name: string; type: string | null }>();
      const folderNameMap = new Map<string, string>();
      if (allFileIds.size > 0) {
        const { data: files } = await supabase
          .from("vault_files")
          .select("id, name, file_type")
          .in("id", Array.from(allFileIds));
        for (const f of files ?? []) {
          fileNameMap.set(f.id, { name: f.name, type: (f as any).file_type ?? null });
        }
      }
      if (allFolderIds.size > 0) {
        const { data: folders } = await supabase
          .from("vault_folders")
          .select("id, name")
          .in("id", Array.from(allFolderIds));
        for (const f of folders ?? []) folderNameMap.set(f.id, f.name);
      }

      const items: SharedMediaItem[] = [];

      for (const r of rows) {
        const author = profileMap.get(r.author_id);
        const base = {
          message_id: r.id,
          created_at: r.created_at,
          author_id: r.author_id,
          author_name: author?.display_name ?? null,
          author_avatar: author?.avatar_url ?? null,
        };

        // Photo
        if (r.image_url) {
          items.push({
            ...base,
            id: `${r.id}:photo`,
            kind: "photo",
            image_url: r.image_url,
          });
        }

        const text = r.text ?? "";

        // Vault files
        const seenFiles = new Set<string>();
        for (const m of text.matchAll(VAULT_FILE_RE)) {
          const id = m[1];
          if (seenFiles.has(id)) continue;
          seenFiles.add(id);
          const meta = fileNameMap.get(id);
          items.push({
            ...base,
            id: `${r.id}:vf:${id}`,
            kind: "file",
            image_url: "",
            label: meta?.name ?? "Vault file",
            sublabel: meta?.type ?? "File",
            vaultFileId: id,
          });
        }

        // Vault folders
        const seenFolders = new Set<string>();
        for (const m of text.matchAll(VAULT_FOLDER_RE)) {
          const id = m[1];
          if (seenFolders.has(id)) continue;
          seenFolders.add(id);
          items.push({
            ...base,
            id: `${r.id}:vfd:${id}`,
            kind: "file",
            image_url: "",
            label: folderNameMap.get(id) ?? "Folder",
            sublabel: "Folder",
            vaultFolderId: id,
          });
        }

        // Vault roots
        for (const m of text.matchAll(VAULT_ROOT_RE)) {
          const scope = m[1] as "team" | "club";
          const rid = m[2];
          items.push({
            ...base,
            id: `${r.id}:vr:${scope}:${rid}`,
            kind: "file",
            image_url: "",
            label: scope === "team" ? "Team vault" : "Club vault",
            sublabel: "Vault root",
            vaultRootScope: scope,
            vaultRootId: rid,
          });
        }

        // Links — strip tokens first so we don't capture token chars
        const clean = text.replace(ALL_TOKEN_RE, " ");
        const seenUrls = new Set<string>();
        for (const m of clean.matchAll(URL_RE)) {
          const url = m[0].replace(/[).,;!?]+$/, "");
          if (seenUrls.has(url)) continue;
          seenUrls.add(url);
          items.push({
            ...base,
            id: `${r.id}:link:${seenUrls.size}`,
            kind: "link",
            image_url: "",
            url,
            label: url,
            sublabel: hostnameOf(url),
          });
        }
      }

      // Sort newest first, keep stable order
      items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

      // Enforce the caller-requested result cap AFTER derivation. A single
      // source message can produce multiple items (photo + links + vault
      // refs), so bounding only the source-message query is not enough —
      // callers rely on the returned length being <= limit for chat's
      // fixed-size Shared Media strips.
      return items.slice(0, limit);

    },
    enabled,
    staleTime: 60 * 1000,
  });
}
