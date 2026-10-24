import { EVENT_TOKEN_PATTERN } from "@/lib/chatEventToken";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds, fetchProfilesWithCache } from "@/lib/profileCache";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveLatestMessagesPage } from "@/live/features/messaging";
import { useAuth } from "@/hooks/useAuth";

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
const ALL_TOKEN_RE = new RegExp(String.raw`${EVENT_TOKEN_PATTERN}|\[(?:vault|vaultfolder|vaultroot:(?:team|club)):[0-9a-f-]{36}\]`, "gi");

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
  options?: { limit?: number; enabled?: boolean; clubId?: string; teamId?: string; miniLeagueId?: string; competitionId?: string }
) {
  const { user, initialized } = useAuth();
  const icp = isFeatureRoutedToIcp("messaging");
  const rawLimit = options?.limit;
  // Defensive normalisation: fall back to the default for any non-positive,
  // non-finite or fractional value so callers can never trigger an unbounded
  // query or receive an unexpected result count.
  const limit =
    typeof rawLimit === "number" && Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.floor(rawLimit)
      : DEFAULT_LIMIT;
  const enabled = (options?.enabled ?? true) && !!chatId && (!icp || (!!user && initialized));


  const mediaQuery = useQuery({
    queryKey: ["chat-shared-media", chatType, chatId, limit, user?.id, icp],
    queryFn: async (): Promise<SharedMediaItem[]> => {
      // ICP branch: conversation ids are the canister's native identifier
      // for every chat type here (club/team ids double as conversation ids
      // by the same convention the chat pages already use; group/dm ids are
      // real conversation ids). Vault tokens use the same parser as legacy
      // messages, with destination-authorized metadata reads below.
      if (isFeatureRoutedToIcp("messaging") && chatId) {
        return withFeatureBackend("messaging", {
          supabase: async () => [],
          icp: async (ctx) => {
            const page = await listLiveLatestMessagesPage(ctx, chatId, null, Math.min(100, Math.max(60, limit)));
            const messages = [...page.messages];
            // Full viewer scans a bounded recent window; previews use one page.
            let cursor = page.next_sequence?.[0];
            for (let i = 1; limit > 100 && cursor !== undefined && i < 6; i++) {
              const older = await listLiveLatestMessagesPage(ctx, chatId, Number(cursor), 100);
              messages.push(...older.messages);
              const next = older.next_sequence?.[0];
              if (next === cursor) break;
              cursor = next;
            }
            const items: SharedMediaItem[] = [];
            for (const m of messages) {
              const createdAt = new Date(Number(m.created_at_ms)).toISOString();
              const authorId = m.sender.toText();
              const base = {
                message_id: m.id,
                created_at: createdAt,
                author_id: authorId,
                author_name: null,
                author_avatar: null,
              };
              const attachment = m.attachment?.[0];
              if (attachment && attachment.kind === "image" && attachment.url?.[0]) {
                items.push({
                  ...base,
                  id: `${m.id}:photo`,
                  kind: "photo",
                  image_url: attachment.url[0],
                });
              }
              for (const match of (m.body ?? "").matchAll(VAULT_FILE_RE)) {
                items.push({ ...base, id: `${m.id}:vf:${match[1]}`, kind: "file", image_url: "", label: "Vault file", sublabel: "File", vaultFileId: match[1] });
              }
              for (const match of (m.body ?? "").matchAll(VAULT_FOLDER_RE)) {
                items.push({ ...base, id: `${m.id}:vfd:${match[1]}`, kind: "file", image_url: "", label: "Folder", sublabel: "Folder", vaultFolderId: match[1] });
              }
              for (const match of (m.body ?? "").matchAll(VAULT_ROOT_RE)) {
                const scope = match[1] as "club" | "team";
                items.push({ ...base, id: `${m.id}:vr:${scope}:${match[2]}`, kind: "file", image_url: "", label: scope === "team" ? "Team vault" : "Club vault", vaultRootScope: scope, vaultRootId: match[2] });
              }
              const seenUrls = new Set<string>();
              for (const match of (m.body ?? "").matchAll(URL_RE)) {
                const url = match[0].replace(/[).,;!?]+$/, "");
                if (seenUrls.has(url)) continue;
                seenUrls.add(url);
                items.push({
                  ...base,
                  id: `${m.id}:link:${seenUrls.size}`,
                  kind: "link",
                  image_url: "",
                  url,
                  label: url,
                  sublabel: hostnameOf(url),
                });
              }
            }
            items.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
            const result = [...new Map(items.map(item => [item.id, item])).values()].slice(0, limit);
            return result;
          }}, chatType === "dm" || chatType === "broadcast" ? { shared: "person" } : options?.clubId ? { clubId: options.clubId } : chatType === "team" ? { teamId: chatId } : chatType === "club" ? { clubId: chatId } : { conversationId: chatId });
      }

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
  // Optional labels never hold the actual attachments behind directory/Vault reads.
  const rows = mediaQuery.data ?? [];
  const { data: enriched } = useQuery({
    queryKey: ["chat-shared-media-labels", user?.id, chatType, chatId, limit, rows.map(row => `${row.id}:${row.image_url}:${row.url ?? ""}`).join(","), options?.clubId, options?.competitionId],
    enabled: enabled && icp && rows.length > 0,
    queryFn: async () => {
      const [profiles, vault] = await Promise.all([
        fetchProfilesWithCache([...new Set(rows.map(row => row.author_id))]).catch(() => new Map()),
        import("@/live/features/vault"),
      ]);
      return Promise.all(rows.map(async row => {
        const item = { ...row };
        const profile = profiles.get(item.author_id);
        item.author_name = profile?.display_name ?? null;
        item.author_avatar = profile?.avatar_url ?? null;
        const fileId = item.vaultFileId, folderId = item.vaultFolderId;
        if (fileId || folderId) {
          try {
            const metadata = await withFeatureBackend("vault", {
              supabase: async () => null,
              icp: ctx => fileId ? vault.getLiveVaultFile(ctx, fileId) : folderId ? vault.getLiveVaultFolder(ctx, folderId, options?.competitionId) : Promise.resolve(null),
            }, options?.clubId ? { clubId: options.clubId } : fileId ? { vaultFileId: fileId } : { vaultFolderId: folderId ?? "" });
            if (metadata) item.label = metadata.name;
          } catch { /* Navigation still requires destination authorization. */ }
        }
        return item;
      }));
    },
    staleTime: 60_000,
  });
  const enrichedById = new Map(enriched?.map(item => [item.id, item]));
  return { ...mediaQuery, data: icp && mediaQuery.data ? mediaQuery.data.map(item => {
    const label = enrichedById.get(item.id);
    return label ? { ...item, label: label.label ?? item.label, author_name: label.author_name, author_avatar: label.author_avatar } : item;
  }) : mediaQuery.data };
}
