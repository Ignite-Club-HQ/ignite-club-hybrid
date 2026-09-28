import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Pin, ChevronRight, EyeOff } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { hapticSelectionTick } from "@/lib/haptics";
import type { PinnedVaultRecord } from "@/hooks/useChatPinnedVault";

interface PinnedVaultBannerProps {
  record: PinnedVaultRecord | null;
  /** When admin and disabled, render a subtle "hidden" hint so they can re-enable from the menu. */
  isAdmin?: boolean;
  /** Retained for API compatibility; the compact banner no longer renders an unpin control. */
  onUnpin?: () => void;
}

interface ResolvedTarget {
  label: string;
  href: string;
  count: number;
}

async function resolveTarget(record: PinnedVaultRecord): Promise<ResolvedTarget | null> {
  if (record.vault_file_id) {
    const { data } = await supabase
      .from("vault_files")
      .select("id, name")
      .eq("id", record.vault_file_id)
      .maybeSingle();
    if (!data) return null;
    // Single file — no count badge needed.
    return { label: data.name ?? "Vault file", href: `/vault?file=${data.id}`, count: 0 };
  }
  if (record.vault_folder_id) {
    const [folderRes, countRes] = await Promise.all([
      supabase.from("vault_folders").select("id, name").eq("id", record.vault_folder_id).maybeSingle(),
      supabase
        .from("vault_files")
        .select("id", { count: "exact", head: true })
        .eq("folder_id", record.vault_folder_id)
        .is("deleted_at", null),
    ]);
    if (!folderRes.data) return null;
    return {
      label: folderRes.data.name ?? "Vault folder",
      href: `/vault/folder/${folderRes.data.id}`,
      count: countRes.count ?? 0,
    };
  }
  if (record.root_scope && record.root_id) {
    if (record.root_scope === "team") {
      const { data } = await supabase
        .from("teams")
        .select("id, name")
        .eq("id", record.root_id)
        .maybeSingle();
      if (!data) return null;
      // Whole-vault pin — omit count (too broad to be useful).
      return { label: `${data.name ?? "Team"} vault`, href: `/vault?team=${data.id}`, count: 0 };
    }
    const { data } = await supabase
      .from("clubs")
      .select("id, name")
      .eq("id", record.root_id)
      .maybeSingle();
    if (!data) return null;
    return { label: `${data.name ?? "Club"} vault`, href: `/vault?club=${data.id}`, count: 0 };
  }
  return null;
}

export function PinnedVaultBanner({ record, isAdmin = false }: PinnedVaultBannerProps) {
  const navigate = useNavigate();

  const cacheKey = useMemo(() => {
    if (!record) return "none";
    return [
      record.id,
      record.vault_file_id ?? "",
      record.vault_folder_id ?? "",
      record.root_scope ?? "",
      record.root_id ?? "",
    ].join("|");
  }, [record]);

  const { data: target } = useQuery({
    queryKey: ["chat-pinned-vault-target", cacheKey],
    enabled: !!record,
    queryFn: () => (record ? resolveTarget(record) : null),
    staleTime: 60 * 1000,
  });

  if (!record) return null;

  if (!record.enabled) {
    if (!isAdmin) return null;
    return (
      <div className="w-full flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-b border-border text-[11px] text-muted-foreground">
        <EyeOff className="h-3 w-3" />
        Pinned vault hidden — re-enable from the chat menu
      </div>
    );
  }

  if (!target) return null;

  const handleClick = () => {
    hapticSelectionTick();
    navigate(target.href, { state: { fromChat: true } });
  };

  const countLabel = target.count > 0 ? ` (${target.count})` : "";

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={`Open Pinned Vault${countLabel}: ${target.label}`}
      className="group w-full flex items-center gap-2.5 px-3 py-1.5 bg-primary/5 border-b border-primary/15 text-left touch-manipulation active:bg-primary/10 transition-colors shrink-0"
    >
      <div className="h-6 w-6 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
        <Pin className="h-3 w-3 text-primary" strokeWidth={2.5} />
      </div>
      <div className="flex-1 min-w-0 flex items-baseline gap-1.5">
        <span className="text-[12px] font-semibold text-primary shrink-0">
          Pinned Vault{countLabel}
        </span>
        <span className="text-[12px] text-muted-foreground truncate min-w-0">
          {target.label}
        </span>
      </div>
      <ChevronRight className="h-4 w-4 text-primary/70 shrink-0" strokeWidth={2.25} />
    </button>
  );
}
