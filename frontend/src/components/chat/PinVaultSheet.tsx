import { useMemo, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { ChevronRight, ChevronLeft, Folder, Loader2, Pin, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  useChatPinnedVault,
  type PinnedVaultChatType,
  type PinnedVaultTarget,
} from "@/hooks/useChatPinnedVault";

interface PinVaultSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatType: PinnedVaultChatType;
  chatId: string;
  /** The club this chat belongs to (always provided for club/group/team chats). */
  clubId: string | null | undefined;
  /** Team id if the chat is a team chat or a team-scoped group. */
  teamId?: string | null;
}

interface FolderRow {
  id: string;
  name: string;
  team_id: string | null;
  has_children?: boolean;
}

interface Crumb {
  id: string | null; // null = root
  name: string;
}

export function PinVaultSheet({
  open,
  onOpenChange,
  chatType,
  chatId,
  clubId,
  teamId,
}: PinVaultSheetProps) {
  const { record, save, isSaving, toggleEnabled, remove } = useChatPinnedVault(
    chatType,
    chatId,
    // Sheet is a secondary consumer — only run the query while open, and never
    // own the realtime channel (the parent chat page already subscribes).
    { enabled: open, subscribe: false },
  );

  // Local working copy
  const [pendingTarget, setPendingTarget] = useState<PinnedVaultTarget | null>(null);

  // Breadcrumb stack — last element is the current folder we're browsing
  // (null root means top-level folders).
  const [crumbs, setCrumbs] = useState<Crumb[]>([{ id: null, name: "All folders" }]);
  const currentCrumb = crumbs[crumbs.length - 1];
  const currentFolderId = currentCrumb.id;

  // Reset navigation each time the sheet opens.
  useEffect(() => {
    if (open) {
      setCrumbs([{ id: null, name: "All folders" }]);
      setPendingTarget(null);
    }
  }, [open]);

  const currentSelection: PinnedVaultTarget = pendingTarget ?? {
    vault_file_id: record?.vault_file_id ?? null,
    vault_folder_id: record?.vault_folder_id ?? null,
    root_scope: record?.root_scope ?? null,
    root_id: record?.root_id ?? null,
  };

  // Folders for the current level (root or inside a specific parent).
  const foldersQuery = useQuery({
    queryKey: ["pin-vault-sheet-folders", clubId, teamId ?? "club", currentFolderId ?? "root"],
    enabled: open && !!clubId,
    queryFn: async (): Promise<{ club: FolderRow[]; team: FolderRow[] }> => {
      if (!clubId) return { club: [], team: [] };
      let query = supabase
        .from("vault_folders")
        .select("id, name, team_id, parent_id")
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("name", { ascending: true });
      query = currentFolderId === null
        ? query.is("parent_id", null)
        : query.eq("parent_id", currentFolderId);
      const { data, error } = await query;
      if (error) {
        console.warn("[PinVaultSheet] folders error", error);
        return { club: [], team: [] };
      }
      const rows = (data ?? []) as { id: string; name: string; team_id: string | null }[];

      // Hydrate has_children for each row in one query so we know whether
      // to render the drill-down chevron.
      const ids = rows.map((r) => r.id);
      let childIds = new Set<string>();
      if (ids.length > 0) {
        const { data: children } = await supabase
          .from("vault_folders")
          .select("parent_id")
          .in("parent_id", ids)
          .is("deleted_at", null);
        childIds = new Set((children ?? []).map((c: { parent_id: string | null }) => c.parent_id!).filter(Boolean));
      }
      const hydrated: FolderRow[] = rows.map((r) => ({
        ...r,
        has_children: childIds.has(r.id),
      }));

      // Only split into team / club groups at the root level.
      if (currentFolderId === null) {
        return {
          club: hydrated.filter((r) => !r.team_id),
          team: teamId ? hydrated.filter((r) => r.team_id === teamId) : [],
        };
      }
      return { club: hydrated, team: [] };
    },
  });

  const selectionMatches = (t: PinnedVaultTarget) =>
    (t.vault_folder_id ?? null) === (currentSelection.vault_folder_id ?? null)
    && (t.vault_file_id ?? null) === (currentSelection.vault_file_id ?? null)
    && (t.root_scope ?? null) === (currentSelection.root_scope ?? null)
    && (t.root_id ?? null) === (currentSelection.root_id ?? null);

  const handleChoose = (t: PinnedVaultTarget) => {
    setPendingTarget(t);
  };

  const handleDrillIn = (f: FolderRow) => {
    setCrumbs((prev) => [...prev, { id: f.id, name: f.name }]);
  };

  const handleBack = () => {
    setCrumbs((prev) => (prev.length > 1 ? prev.slice(0, -1) : prev));
  };

  const handleCrumb = (idx: number) => {
    setCrumbs((prev) => prev.slice(0, idx + 1));
  };

  const handleSave = () => {
    const t = currentSelection;
    if (!t.vault_file_id && !t.vault_folder_id && !(t.root_scope && t.root_id)) return;
    save({ ...t, enabled: record?.enabled ?? true }, {
      onSuccess: () => {
        setPendingTarget(null);
        onOpenChange(false);
      },
    });
  };

  const handleRemove = () => {
    remove(undefined, {
      onSuccess: () => {
        setPendingTarget(null);
        onOpenChange(false);
      },
    });
  };

  const hasSelection =
    !!currentSelection.vault_file_id
    || !!currentSelection.vault_folder_id
    || !!(currentSelection.root_scope && currentSelection.root_id);

  const folders = foldersQuery.data;
  const atRoot = currentFolderId === null;

  const rootOptions = useMemo(() => {
    const out: { key: string; label: string; sublabel: string; target: PinnedVaultTarget }[] = [];
    if (clubId) {
      out.push({
        key: `root-club-${clubId}`,
        label: "Whole club vault",
        sublabel: "All files & folders",
        target: { root_scope: "club", root_id: clubId },
      });
    }
    if (teamId) {
      out.push({
        key: `root-team-${teamId}`,
        label: "Whole team vault",
        sublabel: "All files & folders",
        target: { root_scope: "team", root_id: teamId },
      });
    }
    return out;
  }, [clubId, teamId]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="px-0 pb-0 rounded-t-2xl h-[85vh] flex flex-col bg-background"
      >
        <SheetHeader className="px-6 pb-3 border-b text-left shrink-0">
          <SheetTitle className="flex items-center gap-2">
            <Pin className="h-4 w-4 text-primary" />
            Pinned vault
          </SheetTitle>
          <SheetDescription>
            Pin a vault folder or the whole vault to the top of this chat. You can switch it off
            any time without losing the selection.
          </SheetDescription>
        </SheetHeader>

        {record && (
          <div className="px-6 py-3 border-b flex items-center justify-between gap-3 shrink-0">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">Show in chat</p>
              <p className="text-xs text-muted-foreground">
                Hide the pinned vault for everyone without removing it.
              </p>
            </div>
            <Switch
              checked={record.enabled}
              onCheckedChange={(v) => toggleEnabled(v)}
              aria-label="Toggle pinned vault visibility"
            />
          </div>
        )}

        {/* Breadcrumb / back row — only when drilled in */}
        {!atRoot && (
          <div className="px-4 py-2 border-b flex items-center gap-1 text-xs shrink-0 overflow-x-auto">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 px-2"
              onClick={handleBack}
            >
              <ChevronLeft className="h-3.5 w-3.5 mr-1" />
              Back
            </Button>
            <div className="flex items-center gap-1 min-w-0 text-muted-foreground">
              {crumbs.map((c, i) => (
                <div key={`${c.id ?? "root"}-${i}`} className="flex items-center gap-1 min-w-0">
                  {i > 0 && <ChevronRight className="h-3 w-3 shrink-0" />}
                  <button
                    type="button"
                    onClick={() => handleCrumb(i)}
                    className={`truncate hover:text-foreground ${
                      i === crumbs.length - 1 ? "text-foreground font-medium" : ""
                    }`}
                  >
                    {c.name}
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        <ScrollArea className="flex-1 min-h-0">
          <div className="px-6 py-4 space-y-5">
            {atRoot && rootOptions.length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  Whole vault
                </h3>
                <ul className="space-y-1.5">
                  {rootOptions.map((opt) => {
                    const selected = selectionMatches(opt.target);
                    return (
                      <li key={opt.key}>
                        <button
                          type="button"
                          onClick={() => handleChoose(opt.target)}
                          className={`w-full flex items-center gap-3 rounded-lg border p-3 text-left transition-colors ${
                            selected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-card hover:bg-accent"
                          }`}
                        >
                          <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                            <Folder className="h-4 w-4 text-primary" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium text-foreground truncate">
                              {opt.label}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">
                              {opt.sublabel}
                            </p>
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {foldersQuery.isLoading && (
              <div className="flex items-center justify-center py-4">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            )}

            {folders && folders.team.length > 0 && atRoot && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  Team folders
                </h3>
                <FolderList
                  folders={folders.team}
                  isSelected={(f) => selectionMatches({ vault_folder_id: f.id })}
                  onChoose={(f) => handleChoose({ vault_folder_id: f.id })}
                  onDrillIn={handleDrillIn}
                />
              </section>
            )}

            {folders && folders.club.length > 0 && (
              <section>
                <h3 className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold mb-2">
                  {atRoot ? "Club folders" : "Subfolders"}
                </h3>
                <FolderList
                  folders={folders.club}
                  isSelected={(f) => selectionMatches({ vault_folder_id: f.id })}
                  onChoose={(f) => handleChoose({ vault_folder_id: f.id })}
                  onDrillIn={handleDrillIn}
                />
              </section>
            )}

            {folders
              && (atRoot ? rootOptions.length === 0 : true)
              && folders.team.length === 0
              && folders.club.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                {atRoot
                  ? "No vault folders yet. Create one from the Vault page first."
                  : "No subfolders here."}
              </p>
            )}
          </div>
        </ScrollArea>

        <div className="border-t px-6 py-3 flex items-center gap-2 bg-background shrink-0">
          {record && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleRemove}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              Remove
            </Button>
          )}
          <div className="flex-1" />
          <Button type="button" variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={!hasSelection || isSaving}
            onClick={handleSave}
          >
            {isSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FolderList({
  folders,
  isSelected,
  onChoose,
  onDrillIn,
}: {
  folders: FolderRow[];
  isSelected: (f: FolderRow) => boolean;
  onChoose: (f: FolderRow) => void;
  onDrillIn: (f: FolderRow) => void;
}) {
  return (
    <ul className="space-y-1.5">
      {folders.map((f) => {
        const selected = isSelected(f);
        return (
          <li key={f.id}>
            <div
              className={`w-full flex items-stretch rounded-lg border overflow-hidden transition-colors ${
                selected
                  ? "border-primary bg-primary/10"
                  : "border-border bg-card hover:bg-accent"
              }`}
            >
              <button
                type="button"
                onClick={() => onChoose(f)}
                className="flex items-center gap-3 p-3 text-left flex-1 min-w-0"
              >
                <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0">
                  <Folder className="h-4 w-4 text-muted-foreground" />
                </div>
                <p className="text-sm font-medium text-foreground truncate flex-1">{f.name}</p>
              </button>
              <button
                type="button"
                onClick={() => onDrillIn(f)}
                className="px-3 flex items-center justify-center border-l border-border/60 text-muted-foreground hover:text-foreground hover:bg-accent shrink-0"
                aria-label={`Open ${f.name}`}
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
