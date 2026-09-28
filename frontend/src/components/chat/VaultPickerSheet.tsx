import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Folder,
  FileText,
  FileImage,
  FileSpreadsheet,
  FileVideo,
  FileAudio,
  FileArchive,
  ChevronLeft,
  ChevronRight,
  Search,
  Loader2,
  X,
  CheckSquare,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { supabase } from "@/integrations/supabase/client";

export type VaultPickerItem =
  | { kind: "file" | "folder"; id: string; name: string }
  | { kind: "root"; scope: "team" | "club"; id: string; name: string };

interface VaultPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string | null | undefined;
  teamId?: string | null;
  onPick: (item: VaultPickerItem) => void;
  /** Optional bulk-share callback. When provided, the picker exposes a
   *  "Select" mode inside any folder so users can tick multiple files and
   *  subfolders and share them in one go. */
  onPickMany?: (items: VaultPickerItem[]) => void;
}

interface VaultFolder {
  id: string;
  name: string;
  parent_id: string | null;
  team_id: string | null;
  club_id: string;
}

interface VaultFile {
  id: string;
  name: string;
  file_type: string | null;
  file_size: number | null;
  folder_id: string | null;
  team_id: string | null;
  club_id: string;
  is_external_link: boolean;
}

function getIconForFile(name: string, fileType: string | null) {
  const lower = (name || "").toLowerCase();
  const type = (fileType || "").toLowerCase();
  if (type.startsWith("image/") || /\.(jpe?g|png|gif|webp|svg|heic)$/i.test(lower)) return FileImage;
  if (type.startsWith("video/") || /\.(mp4|mov|avi|webm)$/i.test(lower)) return FileVideo;
  if (type.startsWith("audio/") || /\.(mp3|wav|m4a)$/i.test(lower)) return FileAudio;
  if (/\.(xls|xlsx|csv|ods)$/i.test(lower)) return FileSpreadsheet;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return FileArchive;
  return FileText;
}

export function VaultPickerSheet({ open, onOpenChange, clubId, teamId, onPick, onPickMany }: VaultPickerSheetProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [pathStack, setPathStack] = useState<{ id: string | null; name: string }[]>([
    { id: null, name: "Vault" },
  ]);
  const [search, setSearch] = useState("");
  // Bulk-share mode (only meaningful when onPickMany is provided AND we are
  // inside a folder — root-level selection across team/club scopes is too
  // ambiguous, so we keep it confined to the current folder view).
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<Map<string, string>>(new Map());
  const [selectedFiles, setSelectedFiles] = useState<Map<string, string>>(new Map());

  // At the root, we offer a "share entire vault" card scoped to either the
  // team (when this is a team chat) or the whole club. Fetch the display name.
  const rootScope: "team" | "club" | null = teamId ? "team" : clubId ? "club" : null;
  const rootScopeId = teamId || clubId || null;
  const rootScopeQuery = useQuery({
    queryKey: ["vault-picker-root-name", rootScope, rootScopeId],
    queryFn: async () => {
      if (!rootScope || !rootScopeId) return null;
      if (rootScope === "team") {
        const { data, error } = await supabase
          .from("teams")
          .select("id, name")
          .eq("id", rootScopeId)
          .maybeSingle();
        if (error) throw error;
        return data?.name as string | null;
      }
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", rootScopeId)
        .maybeSingle();
      if (error) throw error;
      return data?.name as string | null;
    },
    enabled: open && !!rootScope && !!rootScopeId,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch folders in the current view
  const foldersQuery = useQuery({
    queryKey: ["vault-picker-folders", clubId, teamId, currentFolderId],
    queryFn: async () => {
      if (!clubId) return [] as VaultFolder[];
      let q = supabase
        .from("vault_folders")
        .select("id, name, parent_id, team_id, club_id")
        .eq("club_id", clubId)
        .order("name");

      if (currentFolderId) {
        q = q.eq("parent_id", currentFolderId);
      } else {
        q = q.is("parent_id", null);
        // At root, show club-wide folders plus this team's folders.
        // When there is no teamId (e.g. club-admin or club-wide chat),
        // only show club-wide folders — otherwise we'd list every team's
        // root folders (e.g. one "Team Admins" / "Coaches" per team).
        if (teamId) {
          q = q.or(`team_id.is.null,team_id.eq.${teamId}`);
        } else {
          q = q.is("team_id", null);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as VaultFolder[];
    },
    enabled: open && !!clubId,
    staleTime: 30 * 1000,
  });

  // Fetch files in the current folder
  const filesQuery = useQuery({
    queryKey: ["vault-picker-files", clubId, teamId, currentFolderId],
    queryFn: async () => {
      if (!clubId) return [] as VaultFile[];
      let q = supabase
        .from("vault_files")
        .select("id, name, file_type, file_size, folder_id, team_id, club_id, is_external_link")
        .eq("club_id", clubId)
        .is("deleted_at", null)
        .order("name");

      if (currentFolderId) {
        q = q.eq("folder_id", currentFolderId);
      } else {
        q = q.is("folder_id", null);
        if (teamId) {
          q = q.or(`team_id.is.null,team_id.eq.${teamId}`);
        } else {
          q = q.is("team_id", null);
        }
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as VaultFile[];
    },
    enabled: open && !!clubId,
    staleTime: 30 * 1000,
  });

  const folders = foldersQuery.data || [];
  const files = filesQuery.data || [];

  // Batch-fetch counts of child folders and files for every folder shown,
  // so each row can display "X folders · Y files" at a glance.
  const folderIds = useMemo(() => folders.map((f) => f.id), [folders]);

  const folderChildCountsQuery = useQuery({
    queryKey: ["vault-picker-folder-counts", clubId, folderIds.join(",")],
    queryFn: async () => {
      const counts = new Map<string, { folders: number; files: number }>();
      if (!clubId || folderIds.length === 0) return counts;

      const [{ data: subfolders, error: subErr }, { data: subfiles, error: fileErr }] = await Promise.all([
        supabase
          .from("vault_folders")
          .select("parent_id")
          .eq("club_id", clubId)
          .in("parent_id", folderIds),
        supabase
          .from("vault_files")
          .select("folder_id")
          .eq("club_id", clubId)
          .is("deleted_at", null)
          .in("folder_id", folderIds),
      ]);
      if (subErr) throw subErr;
      if (fileErr) throw fileErr;

      for (const id of folderIds) counts.set(id, { folders: 0, files: 0 });
      for (const row of subfolders || []) {
        const pid = (row as { parent_id: string | null }).parent_id;
        if (!pid) continue;
        const c = counts.get(pid);
        if (c) c.folders += 1;
      }
      for (const row of subfiles || []) {
        const fid = (row as { folder_id: string | null }).folder_id;
        if (!fid) continue;
        const c = counts.get(fid);
        if (c) c.files += 1;
      }
      return counts;
    },
    enabled: open && !!clubId && folderIds.length > 0,
    staleTime: 30 * 1000,
  });

  const folderCounts = folderChildCountsQuery.data;

  const filteredFolders = useMemo(() => {
    if (!search.trim()) return folders;
    const s = search.toLowerCase();
    return folders.filter((f) => f.name.toLowerCase().includes(s));
  }, [folders, search]);

  const filteredFiles = useMemo(() => {
    if (!search.trim()) return files;
    const s = search.toLowerCase();
    return files.filter((f) => f.name.toLowerCase().includes(s));
  }, [files, search]);

  const clearSelection = () => {
    setSelectedFolders(new Map());
    setSelectedFiles(new Map());
  };

  const enterFolder = (folder: VaultFolder) => {
    setCurrentFolderId(folder.id);
    setPathStack((prev) => [...prev, { id: folder.id, name: folder.name }]);
    setSearch("");
    setSelectionMode(false);
    clearSelection();
  };

  const goBack = () => {
    if (pathStack.length <= 1) return;
    const newStack = pathStack.slice(0, -1);
    setPathStack(newStack);
    setCurrentFolderId(newStack[newStack.length - 1].id);
    setSearch("");
    setSelectionMode(false);
    clearSelection();
  };

  const jumpToCrumb = (index: number) => {
    if (index < 0 || index >= pathStack.length) return;
    if (index === pathStack.length - 1) return; // already here
    const newStack = pathStack.slice(0, index + 1);
    setPathStack(newStack);
    setCurrentFolderId(newStack[newStack.length - 1].id);
    setSearch("");
    setSelectionMode(false);
    clearSelection();
  };

  const reset = () => {
    setCurrentFolderId(null);
    setPathStack([{ id: null, name: "Vault" }]);
    setSearch("");
    setSelectionMode(false);
    clearSelection();
  };

  const toggleFolderSelection = (folder: VaultFolder) => {
    setSelectedFolders((prev) => {
      const next = new Map(prev);
      if (next.has(folder.id)) next.delete(folder.id);
      else next.set(folder.id, folder.name);
      return next;
    });
  };

  const toggleFileSelection = (file: VaultFile) => {
    setSelectedFiles((prev) => {
      const next = new Map(prev);
      if (next.has(file.id)) next.delete(file.id);
      else next.set(file.id, file.name);
      return next;
    });
  };

  const selectionCount = selectedFolders.size + selectedFiles.size;

  const submitBulkSelection = () => {
    if (!onPickMany || selectionCount === 0) return;
    const items: VaultPickerItem[] = [
      ...Array.from(selectedFolders.entries()).map(
        ([id, name]) => ({ kind: "folder" as const, id, name }),
      ),
      ...Array.from(selectedFiles.entries()).map(
        ([id, name]) => ({ kind: "file" as const, id, name }),
      ),
    ];
    onPickMany(items);
    setSelectionMode(false);
    clearSelection();
  };

  const handleClose = (newOpen: boolean) => {
    if (!newOpen) reset();
    onOpenChange(newOpen);
  };

  const currentLabel = pathStack[pathStack.length - 1]?.name || "Vault";
  const isLoading = foldersQuery.isLoading || filesQuery.isLoading;
  const isEmpty = !isLoading && filteredFolders.length === 0 && filteredFiles.length === 0;
  const insideFolder = currentFolderId !== null;
  const currentFolderName = pathStack[pathStack.length - 1]?.name || "";

  return (
    <Sheet open={open} onOpenChange={handleClose}>
      <SheetContent
        side="bottom"
        className="h-[85vh] max-h-[85vh] flex flex-col overflow-hidden p-0 gap-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <SheetHeader className="px-4 pt-4 pb-3 pr-12 border-b border-border shrink-0">
          <div className="flex items-center gap-2">
            {pathStack.length > 1 && (
              <Button
                variant="ghost"
                size="icon"
                onClick={goBack}
                className="h-8 w-8 shrink-0"
                aria-label="Go back"
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
            )}
            <SheetTitle className="flex-1 text-left truncate text-base">
              {currentLabel}
            </SheetTitle>
            {/* Select / Done toggle — only inside a folder, when bulk pick is supported. */}
            {onPickMany && insideFolder && (
              <Button
                type="button"
                variant={selectionMode ? "secondary" : "ghost"}
                size="sm"
                onClick={() => {
                  if (selectionMode) clearSelection();
                  setSelectionMode((v) => !v);
                }}
                className="h-8 px-2 text-xs shrink-0 gap-1"
              >
                <CheckSquare className="h-3.5 w-3.5" />
                {selectionMode ? "Done" : "Select"}
              </Button>
            )}
          </div>

          {pathStack.length > 1 && (
            <nav
              aria-label="Folder breadcrumb"
              className="mt-1 -mx-1 flex items-center gap-0.5 overflow-x-auto whitespace-nowrap px-1 pb-0.5 scrollbar-thin"
              style={{ WebkitOverflowScrolling: "touch" }}
            >
              {pathStack.map((crumb, index) => {
                const isLast = index === pathStack.length - 1;
                return (
                  <div key={`${crumb.id ?? "root"}-${index}`} className="flex items-center shrink-0">
                    {index > 0 && (
                      <ChevronRight
                        className="h-3.5 w-3.5 text-muted-foreground/60 mx-0.5 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                    <button
                      type="button"
                      onClick={() => jumpToCrumb(index)}
                      disabled={isLast}
                      aria-current={isLast ? "page" : undefined}
                      className={`max-w-[140px] truncate rounded px-1.5 py-0.5 text-xs transition-colors ${
                        isLast
                          ? "font-semibold text-foreground cursor-default"
                          : "text-muted-foreground hover:bg-accent hover:text-foreground active:bg-accent/80"
                      }`}
                    >
                      {crumb.name}
                    </button>
                  </div>
                );
              })}
            </nav>
          )}

          <div className="relative mt-2">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search files and folders…"
              className="pl-9 pr-9"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 h-6 w-6 flex items-center justify-center rounded hover:bg-accent"
                aria-label="Clear search"
              >
                <X className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            )}
          </div>
        </SheetHeader>

        <div
          data-chat-scroll-lock="true"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 py-2"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        >
          {!clubId && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              Vault unavailable in this chat.
            </div>
          )}

          {clubId && isLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {/* Share entire team/club vault — only at root, not while searching */}
          {clubId && !isLoading && currentFolderId === null && !search.trim() && rootScope && rootScopeId && (
            <div className="mb-2">
              <button
                type="button"
                onClick={() =>
                  onPick({
                    kind: "root",
                    scope: rootScope,
                    id: rootScopeId,
                    name: rootScopeQuery.data || (rootScope === "team" ? "Team vault" : "Club vault"),
                  })
                }
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg border border-border bg-primary/5 hover:bg-primary/10 active:bg-primary/15 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                  <Folder className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    Share entire {rootScope === "team" ? "team" : "club"} vault
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {rootScopeQuery.data || (rootScope === "team" ? "This team" : "This club")} · All files & folders
                  </p>
                </div>
                <span className="text-xs font-medium text-primary shrink-0">Share</span>
              </button>
            </div>
          )}

          {/* Share THIS folder card — when user has navigated into a folder
              (hidden in selection mode to keep the focus on bulk picking). */}
          {clubId && !isLoading && insideFolder && currentFolderId && !search.trim() && !selectionMode && (
            <div className="mb-2">
              <button
                type="button"
                onClick={() =>
                  onPick({ kind: "folder", id: currentFolderId, name: currentFolderName })
                }
                className="flex items-center gap-3 w-full px-3 py-3 rounded-lg border border-border bg-primary/5 hover:bg-primary/10 active:bg-primary/15 transition-colors text-left"
              >
                <div className="h-10 w-10 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                  <Folder className="h-5 w-5 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-foreground truncate">
                    Share this folder
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {currentFolderName} · All files & subfolders
                  </p>
                </div>
                <span className="text-xs font-medium text-primary shrink-0">Share</span>
              </button>
            </div>
          )}

          {clubId && !isLoading && isEmpty && !(currentFolderId === null && !search.trim() && rootScope) && (
            <div className="text-center py-12 text-sm text-muted-foreground">
              {search ? "No matches found" : insideFolder ? "This folder has no subfolders or files yet" : "This folder is empty"}
            </div>
          )}

          {clubId && !isLoading && filteredFolders.length > 0 && (
            <div className="space-y-1 mb-2">
              {filteredFolders.map((folder) => {
                const counts = folderCounts?.get(folder.id);
                const subCount = counts?.folders ?? 0;
                const fileCount = counts?.files ?? 0;
                const isCountLoading = folderChildCountsQuery.isLoading;
                const totalCount = subCount + fileCount;
                const subtitle = isCountLoading
                  ? "Folder"
                  : totalCount === 0
                    ? "Empty folder"
                    : [
                        subCount > 0 ? `${subCount} ${subCount === 1 ? "folder" : "folders"}` : null,
                        fileCount > 0 ? `${fileCount} ${fileCount === 1 ? "file" : "files"}` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ");
                const isSelected = selectedFolders.has(folder.id);
                if (selectionMode) {
                  return (
                    <button
                      key={folder.id}
                      type="button"
                      onClick={() => toggleFolderSelection(folder)}
                      aria-pressed={isSelected}
                      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-md transition-colors text-left ${
                        isSelected ? "bg-primary/10" : "hover:bg-accent active:bg-accent/80"
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleFolderSelection(folder)}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <Folder className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {folder.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                      </div>
                    </button>
                  );
                }
                return (
                  <div key={folder.id} className="flex items-center gap-1 group">
                    <button
                      type="button"
                      onClick={() => enterFolder(folder)}
                      className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2.5 rounded-md hover:bg-accent active:bg-accent/80 transition-colors text-left"
                    >
                      <div className="h-9 w-9 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                        <Folder className="h-4 w-4 text-primary" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {folder.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">{subtitle}</p>
                      </div>
                    </button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        onPick({ kind: "folder", id: folder.id, name: folder.name })
                      }
                      className="h-8 px-3 text-xs shrink-0"
                    >
                      Share
                    </Button>
                  </div>
                );
              })}
            </div>
          )}

          {clubId && !isLoading && filteredFiles.length > 0 && (
            <div className="space-y-1">
              {filteredFiles.map((file) => {
                const Icon = getIconForFile(file.name, file.file_type);
                const isSelected = selectedFiles.has(file.id);
                if (selectionMode) {
                  return (
                    <button
                      key={file.id}
                      type="button"
                      onClick={() => toggleFileSelection(file)}
                      aria-pressed={isSelected}
                      className={`flex items-center gap-3 w-full px-3 py-2.5 rounded-md transition-colors text-left ${
                        isSelected ? "bg-primary/10" : "hover:bg-accent active:bg-accent/80"
                      }`}
                    >
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleFileSelection(file)}
                        onClick={(e) => e.stopPropagation()}
                        className="shrink-0"
                      />
                      <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground truncate">
                          {file.name}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {file.is_external_link ? "External link" : "File"}
                        </p>
                      </div>
                    </button>
                  );
                }
                return (
                  <button
                    key={file.id}
                    type="button"
                    onClick={() =>
                      onPick({ kind: "file", id: file.id, name: file.name })
                    }
                    className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-accent active:bg-accent/80 transition-colors text-left"
                  >
                    <div className="h-9 w-9 rounded-md bg-muted flex items-center justify-center shrink-0 text-muted-foreground">
                      <Icon className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-foreground truncate">
                        {file.name}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {file.is_external_link ? "External link" : "File"}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Sticky bulk-share footer — only visible while in selection mode. */}
        {onPickMany && selectionMode && (
          <div className="border-t border-border bg-background px-4 py-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] shrink-0">
            <div className="flex items-center gap-2">
              <p className="flex-1 text-sm text-muted-foreground truncate">
                {selectionCount === 0
                  ? "Tap items to select"
                  : `${selectionCount} ${selectionCount === 1 ? "item" : "items"} selected`}
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSelectionMode(false);
                  clearSelection();
                }}
                className="h-9"
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={submitBulkSelection}
                disabled={selectionCount === 0}
                className="h-9"
              >
                Share {selectionCount > 0 ? `(${selectionCount})` : ""}
              </Button>
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}
