import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { readHomeSectionSnapshot, writeHomeSectionSnapshot } from "@/lib/homeSectionSnapshot";

export interface ClubLinkRow {
  id: string;
  club_id: string;
  title: string;
  subtitle: string | null;
  url: string;
  icon: string;
  open_mode: string;
  sort_order: number;
  is_active: boolean;
}

export interface ClubPolicyDoc {
  id: string;
  name: string;
  file_url: string;
  file_type: string | null;
  is_external_link: boolean | null;
  club_id: string | null;
}

/**
 * Club-managed quick links (registration, clothing, policies pages, ...).
 * RLS already restricts rows to clubs the viewer belongs to, so an optional
 * clubId only narrows an already-authorized set — it is never the security
 * boundary.
 */
export function useClubQuickLinks(clubId?: string | null) {
  return useQuery<ClubLinkRow[]>({
    queryKey: ["club-quick-links", clubId ?? "all"],
    queryFn: async () => {
      let query = supabase
        .from("club_links")
        .select("id, club_id, title, subtitle, url, icon, open_mode, sort_order, is_active")
        .eq("is_active", true)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true });

      if (clubId) query = query.eq("club_id", clubId);

      const { data, error } = await query;
      if (error) throw error;
      const rows = (data || []) as ClubLinkRow[];
      writeHomeSectionSnapshot("club-links", clubId, rows);
      return rows;
    },
    // Paint last known links immediately so the Home tile grid appears with
    // the rest of the page rather than seconds later.
    placeholderData: () =>
      readHomeSectionSnapshot<ClubLinkRow[]>("club-links", clubId) ?? undefined,
    staleTime: 5 * 60 * 1000,
  });
}

const POLICY_FOLDER_PATTERNS = ["polic", "child safety", "code of conduct"];

/**
 * Documents stored in a club-scoped Vault folder whose name looks like a
 * policy folder ("Policies", "Club Policies", "Child Safety Policy", ...).
 * Vault RLS decides visibility; unauthorized viewers simply get nothing.
 */
export function useClubPolicyDocs(clubId?: string | null) {
  return useQuery<ClubPolicyDoc[]>({
    queryKey: ["club-policy-docs", clubId ?? "all"],
    queryFn: async () => {
      let folderQuery = supabase
        .from("vault_folders")
        .select("id, name, club_id")
        .is("deleted_at", null)
        .not("club_id", "is", null)
        .is("team_id", null)
        .is("chat_group_id", null);

      if (clubId) folderQuery = folderQuery.eq("club_id", clubId);

      const { data: folders, error: folderError } = await folderQuery;
      if (folderError) throw folderError;

      const policyFolderIds = (folders || [])
        .filter((f) => {
          const name = (f.name || "").toLowerCase();
          return POLICY_FOLDER_PATTERNS.some((p) => name.includes(p));
        })
        .map((f) => f.id);

      if (policyFolderIds.length === 0) {
        writeHomeSectionSnapshot("club-policy-docs", clubId, []);
        return [];
      }

      const { data: files, error: fileError } = await supabase
        .from("vault_files")
        .select("id, name, file_url, file_type, is_external_link, club_id")
        .is("deleted_at", null)
        .in("folder_id", policyFolderIds)
        .order("name", { ascending: true });

      if (fileError) throw fileError;
      const rows = (files || []) as ClubPolicyDoc[];
      writeHomeSectionSnapshot("club-policy-docs", clubId, rows);
      return rows;
    },
    placeholderData: () =>
      readHomeSectionSnapshot<ClubPolicyDoc[]>("club-policy-docs", clubId) ?? undefined,
    staleTime: 5 * 60 * 1000,
  });
}
