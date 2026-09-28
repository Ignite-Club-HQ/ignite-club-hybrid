import { memo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  FileText,
  FileSpreadsheet,
  FileImage,
  FileVideo,
  FileAudio,
  FileArchive,
  Folder,
  ExternalLink,
  Download,
  
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { safeOpenUrl } from "@/lib/safeOpenUrl";

interface VaultFileCardProps {
  fileId?: string;
  folderId?: string;
  /** When set, render a "vault root" card scoped to a team or club. */
  rootScope?: "team" | "club";
  rootId?: string;
}

function formatBytes(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function getIconForFile(name: string, fileType: string | null) {
  const lower = (name || "").toLowerCase();
  const type = (fileType || "").toLowerCase();
  if (type.startsWith("image/") || /\.(jpe?g|png|gif|webp|svg|heic)$/i.test(lower)) return FileImage;
  if (type.startsWith("video/") || /\.(mp4|mov|avi|webm|mkv)$/i.test(lower)) return FileVideo;
  if (type.startsWith("audio/") || /\.(mp3|wav|m4a|ogg)$/i.test(lower)) return FileAudio;
  if (/\.(xls|xlsx|csv|numbers|ods)$/i.test(lower)) return FileSpreadsheet;
  if (/\.(zip|rar|7z|tar|gz)$/i.test(lower)) return FileArchive;
  return FileText;
}

function getColorForFile(name: string, fileType: string | null): string {
  const lower = (name || "").toLowerCase();
  const type = (fileType || "").toLowerCase();
  if (type.startsWith("image/") || /\.(jpe?g|png|gif|webp|svg)$/i.test(lower)) return "text-blue-500";
  if (type.startsWith("video/") || /\.(mp4|mov)$/i.test(lower)) return "text-purple-500";
  if (type.startsWith("audio/") || /\.(mp3|wav)$/i.test(lower)) return "text-pink-500";
  if (/\.pdf$/i.test(lower)) return "text-red-500";
  if (/\.(xls|xlsx|csv)$/i.test(lower)) return "text-green-600";
  if (/\.(doc|docx)$/i.test(lower)) return "text-blue-600";
  if (/\.(ppt|pptx)$/i.test(lower)) return "text-orange-500";
  if (/\.(zip|rar|7z)$/i.test(lower)) return "text-amber-600";
  return "text-muted-foreground";
}

export const VaultFileCard = memo(function VaultFileCard({ fileId, folderId, rootScope, rootId }: VaultFileCardProps) {
  const navigate = useNavigate();

  // Folder card
  const folderQuery = useQuery({
    queryKey: ["vault-folder-card", folderId],
    queryFn: async () => {
      if (!folderId) return null;
      const { data, error } = await supabase
        .from("vault_folders")
        .select("id, name, club_id, team_id")
        .eq("id", folderId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!folderId,
    staleTime: 60 * 1000,
  });

  // File card
  const fileQuery = useQuery({
    queryKey: ["vault-file-card", fileId],
    queryFn: async () => {
      if (!fileId) return null;
      const { data, error } = await supabase
        .from("vault_files")
        .select("id, name, file_url, file_type, file_size, is_external_link, club_id, team_id, folder_id, deleted_at")
        .eq("id", fileId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!fileId,
    staleTime: 60 * 1000,
  });

  // Root card (entire team or club vault)
  const rootQuery = useQuery({
    queryKey: ["vault-root-card", rootScope, rootId],
    queryFn: async () => {
      if (!rootScope || !rootId) return null;
      if (rootScope === "team") {
        const { data, error } = await supabase
          .from("teams")
          .select("id, name, club_id")
          .eq("id", rootId)
          .maybeSingle();
        if (error) throw error;
        return data ? { name: data.name as string } : null;
      }
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name")
        .eq("id", rootId)
        .maybeSingle();
      if (error) throw error;
      return data ? { name: data.name as string } : null;
    },
    enabled: !!rootScope && !!rootId,
    staleTime: 60 * 1000,
  });

  if (rootScope && rootId) {
    if (rootQuery.isLoading) {
      // Match loaded card layout (h-10 icon + p-3 + 2 text rows ≈ 64px) so
      // the row doesn't grow when the vault root query resolves.
      return (
        <div
          aria-hidden="true"
          className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3 max-w-xs h-[64px]"
        >
          <div className="h-10 w-10 rounded-md bg-muted shrink-0 animate-pulse" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/2 rounded bg-muted/70 animate-pulse" />
          </div>
        </div>
      );
    }
    if (!rootQuery.data) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 max-w-xs">
          <Folder className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Vault unavailable</span>
        </div>
      );
    }
    const rootName = rootQuery.data.name;
    const handleOpenRoot = () => {
      const param = rootScope === "team" ? "team" : "club";
      navigate(`/vault?${param}=${rootId}`);
    };
    return (
      <button
        type="button"
        onClick={handleOpenRoot}
        className="flex items-center gap-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors p-3 max-w-xs w-full text-left active:scale-[0.99]"
        aria-label={`Open ${rootScope} vault for ${rootName}`}
      >
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Folder className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{rootName}</p>
          <p className="text-xs text-muted-foreground truncate">
            {rootScope === "team" ? "Team vault" : "Club vault"} · All files & folders
          </p>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    );
  }

  if (folderId) {
    if (folderQuery.isLoading) {
      return (
        <div
          aria-hidden="true"
          className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3 max-w-xs h-[64px]"
        >
          <div className="h-10 w-10 rounded-md bg-muted shrink-0 animate-pulse" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-2/3 rounded bg-muted animate-pulse" />
            <div className="h-3 w-1/3 rounded bg-muted/70 animate-pulse" />
          </div>
        </div>
      );
    }
    if (!folderQuery.data) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 max-w-xs">
          <Folder className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">Folder unavailable</span>
        </div>
      );
    }
    const folder = folderQuery.data;
    const handleOpen = () => {
      // Use the canonical folder deep-link route so VaultPage resolves
      // the full breadcrumb path (including parents) and lands inside
      // the actual subfolder rather than the club/team root.
      navigate(`/vault/folder/${folder.id}`);
    };
    return (
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors p-3 max-w-xs w-full text-left active:scale-[0.99]"
        aria-label={`Open folder ${folder.name}`}
      >
        <div className="h-10 w-10 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
          <Folder className="h-5 w-5 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{folder.name}</p>
          <p className="text-xs text-muted-foreground">Vault folder</p>
        </div>
        <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>
    );
  }

  if (fileId) {
    if (fileQuery.isLoading) {
      return (
        <div
          aria-hidden="true"
          className="flex items-center gap-3 rounded-lg border border-border bg-card/50 p-3 max-w-xs h-[64px]"
        >
          <div className="h-10 w-10 rounded-md bg-muted shrink-0 animate-pulse" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <div className="h-3.5 w-3/4 rounded bg-muted animate-pulse" />
            <div className="h-3 w-2/5 rounded bg-muted/70 animate-pulse" />
          </div>
        </div>
      );
    }
    if (!fileQuery.data || fileQuery.data.deleted_at) {
      return (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/40 p-3 max-w-xs">
          <FileText className="h-5 w-5 text-muted-foreground" />
          <span className="text-sm text-muted-foreground">File unavailable</span>
        </div>
      );
    }
    const file = fileQuery.data;
    const Icon = getIconForFile(file.name || "", file.file_type);
    const color = getColorForFile(file.name || "", file.file_type);
    const sizeLabel = formatBytes(file.file_size);

    const handleOpen = async () => {
      if (file.is_external_link) {
        safeOpenUrl(file.file_url);
        return;
      }
      try {
        // For storage-hosted files, hand off to the native viewer so the user
        // doesn't see a raw supabase URL in an in-app browser chrome.
        const { safeOpenFile } = await import("@/lib/safeOpenFile");
        await safeOpenFile(file.file_url, {
          fileName: file.name || undefined,
          mimeType: file.file_type || undefined,
        });
      } catch (err) {
        console.warn("Failed to open vault file:", err);
        toast.error("Could not open file");
      }
    };

    return (
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-center gap-3 rounded-lg border border-border bg-card hover:bg-accent transition-colors p-3 max-w-xs w-full text-left active:scale-[0.99]"
        aria-label={`Open file ${file.name}`}
      >
        <div className={`h-10 w-10 rounded-md bg-muted flex items-center justify-center shrink-0 ${color}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground truncate">{file.name}</p>
          <p className="text-xs text-muted-foreground truncate">
            {file.is_external_link ? "External link" : "Vault file"}
            {sizeLabel ? ` · ${sizeLabel}` : ""}
          </p>
        </div>
        {file.is_external_link ? (
          <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
        ) : (
          <Download className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
      </button>
    );
  }

  return null;
});
