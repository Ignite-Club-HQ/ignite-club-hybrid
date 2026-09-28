import { useState, useCallback, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { HardDrive, Folder, FileText, Image, Loader2, ChevronRight, Check, ArrowLeft, RefreshCw, UserCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog";

interface DriveFile {
  id: string;
  name: string;
  mimeType: string;
  size?: string;
  createdTime?: string;
  modifiedTime?: string;
}

interface SelectedDriveFile {
  file: DriveFile;
  folderPath: string;
}

interface SelectedDriveFolder {
  folder: DriveFile;
  folderPath: string;
}

interface GoogleDriveImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportComplete: () => void;
  targetFolderId: string | null;
  targetTeamId: string | null;
  targetClubId: string;
}

export function GoogleDriveImportDialog({
  open,
  onOpenChange,
  onImportComplete,
  targetFolderId,
  targetTeamId,
  targetClubId,
}: GoogleDriveImportDialogProps) {
  const [step, setStep] = useState<"connect" | "browse" | "importing">("connect");
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState<string | null>(null);
  const [googleEmail, setGoogleEmail] = useState<string | null>(null);
  const [folders, setFolders] = useState<DriveFile[]>([]);
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [currentFolderId, setCurrentFolderId] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState<{ id: string; name: string }[]>([]);
  const [selectedFiles, setSelectedFiles] = useState<Map<string, SelectedDriveFile>>(new Map());
  const [selectedFolders, setSelectedFolders] = useState<Map<string, SelectedDriveFolder>>(new Map());
  const [keepInSync, setKeepInSync] = useState(true);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0, currentFile: "" });

  // Get the redirect URI based on current origin
  // On native platforms, use production URL since the system browser handles OAuth
  const getRedirectUri = useCallback(() => {
    if (Capacitor.isNativePlatform()) {
      return 'https://reference.invalid';
    }
    return `${window.location.origin}/vault`;
  }, []);

  // Check for stored access token on open (from redirect flow)
  useEffect(() => {
    if (open) {
      const storedToken = sessionStorage.getItem('googleDriveAccessToken');
      const storedRefresh = sessionStorage.getItem('googleDriveRefreshToken');
      const storedEmail = sessionStorage.getItem('googleDriveGoogleEmail');
      if (storedToken) {
        sessionStorage.removeItem('googleDriveAccessToken');
        sessionStorage.removeItem('googleDriveRefreshToken');
        sessionStorage.removeItem('googleDriveGoogleEmail');
        setAccessToken(storedToken);
        setRefreshToken(storedRefresh);
        setGoogleEmail(storedEmail);
        setStep("browse");
        loadFolderContents(null, storedToken);
      }
    }
  }, [open]);

  // Clean up on close
  useEffect(() => {
    if (!open) {
      setStep("connect");
      setAccessToken(null);
      setRefreshToken(null);
      setGoogleEmail(null);
      setFolders([]);
      setFiles([]);
      setCurrentFolderId(null);
      setFolderPath([]);
      setSelectedFiles(new Map());
      setSelectedFolders(new Map());
      setKeepInSync(true);
      setImporting(false);
      setImportProgress({ current: 0, total: 0, currentFile: "" });
    }
  }, [open]);

  const startOAuth = async () => {
    try {
      setLoading(true);
      
      // Clear any stale tokens before starting new auth
      sessionStorage.removeItem('googleDriveAccessToken');
      sessionStorage.removeItem('googleDriveRefreshToken');
      sessionStorage.removeItem('googleDriveGoogleEmail');
      sessionStorage.removeItem('googleDriveImportPending');
      
      const { data, error } = await supabase.functions.invoke('google-drive-import?action=get-auth-url', {
        body: { redirectUri: getRedirectUri() },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Failed to get auth URL');
      }

      // Store state in sessionStorage to resume after redirect
      sessionStorage.setItem('googleDriveImportPending', JSON.stringify({
        targetFolderId,
        targetTeamId,
        targetClubId,
      }));

      // On native, open system browser for OAuth; on web, redirect
      if (Capacitor.isNativePlatform()) {
        import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(data.authUrl));
      } else {
        window.location.href = data.authUrl;
      }

    } catch (err) {
      console.error("OAuth start error:", err);
      toast.error("Failed to start Google authentication");
      setLoading(false);
    }
  };

  const loadFolderContents = async (folderId: string | null, token?: string) => {
    try {
      setLoading(true);
      const tokenToUse = token || accessToken;
      
      const { data, error } = await supabase.functions.invoke('google-drive-import?action=list-files', {
        body: { 
          accessToken: tokenToUse,
          folderId: folderId || undefined,
        },
      });

      if (error || data?.error) {
        throw new Error(data?.error || error?.message || 'Failed to load files');
      }

      setFolders(data.folders || []);
      setFiles(data.files || []);
      setCurrentFolderId(folderId);
    } catch (err) {
      console.error("Load folder error:", err);
      toast.error("Failed to load Drive contents");
    } finally {
      setLoading(false);
    }
  };

  const navigateToFolder = async (folder: DriveFile) => {
    setFolderPath([...folderPath, { id: folder.id, name: folder.name }]);
    await loadFolderContents(folder.id);
  };

  const navigateBack = async () => {
    if (folderPath.length > 0) {
      const newPath = [...folderPath];
      newPath.pop();
      setFolderPath(newPath);
      const parentId = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
      await loadFolderContents(parentId);
    }
  };

  const navigateToPath = async (index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    setFolderPath(newPath);
    const folderId = newPath.length > 0 ? newPath[newPath.length - 1].id : null;
    await loadFolderContents(folderId);
  };

  const getCurrentDrivePath = useCallback(() => folderPath.map((folder) => folder.name).join('/'), [folderPath]);

  const toggleFileSelection = (file: DriveFile) => {
    const newMap = new Map(selectedFiles);
    if (newMap.has(file.id)) {
      newMap.delete(file.id);
    } else {
      newMap.set(file.id, { file, folderPath: getCurrentDrivePath() });
    }
    setSelectedFiles(newMap);
  };

  const toggleFolderSelection = (folder: DriveFile) => {
    const newMap = new Map(selectedFolders);
    if (newMap.has(folder.id)) {
      newMap.delete(folder.id);
    } else {
      const currentPath = getCurrentDrivePath();
      const folderImportPath = [currentPath, folder.name].filter(Boolean).join('/');
      newMap.set(folder.id, { folder, folderPath: folderImportPath });
    }
    setSelectedFolders(newMap);
  };

  const selectAll = () => {
    const currentPath = getCurrentDrivePath();
    const nextFiles = new Map(selectedFiles);
    const nextFolders = new Map(selectedFolders);
    files.forEach((file) => nextFiles.set(file.id, { file, folderPath: currentPath }));
    folders.forEach((folder) => {
      const folderImportPath = [currentPath, folder.name].filter(Boolean).join('/');
      nextFolders.set(folder.id, { folder, folderPath: folderImportPath });
    });
    setSelectedFiles(nextFiles);
    setSelectedFolders(nextFolders);
  };

  const deselectAll = () => {
    setSelectedFiles(new Map());
    setSelectedFolders(new Map());
  };

  const getFileIcon = (mimeType: string) => {
    if (mimeType.startsWith('image/')) return <Image className="h-4 w-4 text-primary" />;
    if (mimeType === 'application/vnd.google-apps.folder') return <Folder className="h-4 w-4 text-primary" />;
    return <FileText className="h-4 w-4 text-muted-foreground" />;
  };

  const startImport = async () => {
    if (selectedFiles.size === 0 && selectedFolders.size === 0) {
      toast.error("Please select files or folders to import");
      return;
    }

    setStep("importing");
    setImporting(true);

    try {
      // Collect all files to import (including from selected folders)
      const filesToImport: { file: DriveFile; folderPath: string }[] = [];
      const listingFailures: { path: string; reason: string }[] = [];

      // Add directly selected files
      for (const { file, folderPath: relativePath } of selectedFiles.values()) {
        filesToImport.push({ file, folderPath: relativePath });
      }

      // Recursively collect files from selected folders. Show progress so the
      // user sees that we're still discovering files in deep folder trees.
      setImportProgress({ current: 0, total: 0, currentFile: "Scanning Drive folders..." });
      for (const { folder, folderPath: relativePath } of selectedFolders.values()) {
        await collectFolderFiles(folder.id, relativePath, filesToImport, listingFailures, (count) => {
          setImportProgress({ current: 0, total: 0, currentFile: `Scanning Drive folders... (${count} files found)` });
        });
      }

      console.log(`[Drive import] Collected ${filesToImport.length} files across ${selectedFolders.size} selected folders. Listing failures: ${listingFailures.length}`);

      if (listingFailures.length > 0) {
        const preview = listingFailures.slice(0, 3).map((f) => `• ${f.path}: ${f.reason}`).join('\n');
        const more = listingFailures.length > 3 ? `\n…and ${listingFailures.length - 3} more` : '';
        toast.error(`Couldn't read ${listingFailures.length} subfolder${listingFailures.length === 1 ? '' : 's'} from Drive`, {
          description: `${preview}${more}`,
          duration: 10000,
        });
      }

      setImportProgress({ current: 0, total: filesToImport.length, currentFile: "" });

      // Resolve user once up-front so failed inserts don't silently no-op
      const { data: userData } = await supabase.auth.getUser();
      const userId = userData.user?.id;
      if (!userId) {
        toast.error("You must be signed in to import files");
        setImporting(false);
        return;
      }

      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) {
        toast.error("Your session expired. Please sign in again.");
        setImporting(false);
        return;
      }

      // Prepare files first, then send them to the Edge Function in small
      // batches. This avoids hundreds of mobile client→function requests for
      // large club vault imports while keeping each server call short enough
      // for Edge Function limits.
      let successCount = 0;
      const failures: { name: string; reason: string }[] = [];
      const folderCache: Record<string, string> = {}; // path -> folder_id mapping
      const preparedFiles: { file: DriveFile; folderId: string | null }[] = [];

      for (let i = 0; i < filesToImport.length; i++) {
        const { file, folderPath: relativePath } = filesToImport[i];
        setImportProgress({ current: i + 1, total: filesToImport.length, currentFile: `Preparing ${file.name}` });

        try {
          // Ensure folder structure exists
          let uploadFolderId = targetFolderId;
          if (relativePath) {
            uploadFolderId = await ensureFolderPath(relativePath, folderCache);
          }

          // Pre-filter Google Workspace types we know we can't import so we
          // don't waste a round-trip and so the user sees a clear reason.
          const unsupportedGoogleType =
            file.mimeType?.startsWith('application/vnd.google-apps.') &&
            !file.mimeType.startsWith('application/vnd.google-apps.drive-sdk') &&
            ![
              'application/vnd.google-apps.document',
              'application/vnd.google-apps.spreadsheet',
              'application/vnd.google-apps.presentation',
              'application/vnd.google-apps.drawing',
            ].includes(file.mimeType);
          if (unsupportedGoogleType) {
            const friendly = file.mimeType.replace('application/vnd.google-apps.', '');
            failures.push({ name: file.name, reason: `Google ${friendly} files can't be imported` });
            continue;
          }

          preparedFiles.push({ file, folderId: uploadFolderId });
        } catch (fileError: any) {
          const reason = fileError?.message || "Unknown error";
          console.error(`Error preparing ${file.name}:`, fileError);
          failures.push({ name: file.name, reason });
        }
      }

      const importDriveBatch = async (batch: typeof preparedFiles) => {
        const importResponse = await fetch(
          `${String(import.meta.env.VITE_SUPABASE_URL ?? '').replace(/\/$/, '')}/functions/v1/google-drive-import?action=import-file`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
              apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '',
            },
            body: JSON.stringify({
              accessToken,
              files: batch,
              clubId: targetClubId,
              teamId: targetTeamId,
            }),
          }
        );

        let importData: any = null;
        try {
          importData = await importResponse.json();
        } catch {
          importData = { error: `HTTP ${importResponse.status}` };
        }

        if (!importResponse.ok || importData?.error) {
          throw new Error(importData?.error || `HTTP ${importResponse.status}`);
        }

        return Array.isArray(importData?.results) ? importData.results : [];
      };

      const batchSize = 3;
      for (let i = 0; i < preparedFiles.length; i += batchSize) {
        const batch = preparedFiles.slice(i, i + batchSize);
        setImportProgress({
          current: Math.min(i + batch.length, preparedFiles.length),
          total: preparedFiles.length,
          currentFile: `Importing ${batch[0]?.file.name ?? 'files'}`,
        });

        try {
          let results = await importDriveBatch(batch);
          results.forEach((result: any, index: number) => {
            if (result?.success) {
              successCount++;
            } else {
              failures.push({
                name: result?.fileName || batch[index]?.file.name || 'Unknown file',
                reason: result?.error || 'Import failed',
              });
            }
          });
        } catch (batchError: any) {
          await new Promise((resolve) => setTimeout(resolve, 750));
          try {
            const retryResults = await importDriveBatch(batch);
            retryResults.forEach((result: any, index: number) => {
              if (result?.success) {
                successCount++;
              } else {
                failures.push({
                  name: result?.fileName || batch[index]?.file.name || 'Unknown file',
                  reason: result?.error || 'Import failed',
                });
              }
            });
            continue;
          } catch (retryError: any) {
            if (batch.length > 1) {
              for (const item of batch) {
                try {
                  const singleResults = await importDriveBatch([item]);
                  const singleResult = singleResults[0];
                  if (singleResult?.success) {
                    successCount++;
                  } else {
                    failures.push({ name: singleResult?.fileName || item.file.name, reason: singleResult?.error || 'Import failed' });
                  }
                } catch (singleError: any) {
                  failures.push({ name: item.file.name, reason: singleError?.message || 'Import failed' });
                }
              }
              continue;
            }
          }

          const reason = batchError?.message || "Unknown error";
          console.error(`Error importing Drive batch:`, batchError);
          batch.forEach(({ file }) => failures.push({ name: file.name, reason }));
        }
      }

      if (successCount > 0) {
        toast.success(`Imported ${successCount} of ${filesToImport.length} file${filesToImport.length === 1 ? '' : 's'} to your vault`);
      }
      if (failures.length > 0) {
        const preview = failures.slice(0, 3).map((f) => `• ${f.name}: ${f.reason}`).join('\n');
        const more = failures.length > 3 ? `\n…and ${failures.length - 3} more` : '';
        toast.error(`${failures.length} file${failures.length === 1 ? '' : 's'} failed to import`, {
          description: `${preview}${more}`,
          duration: 8000,
        });
      } else if (successCount === 0) {
        toast.error("No files were imported");
      }

      // If "Keep in sync" is enabled, register a vault_drive_link for each
      // selected top-level Drive folder so the background sync job picks
      // up future additions/updates without the user needing a separate
      // "Link folder" step.
      if (keepInSync && selectedFolders.size > 0) {
        if (!refreshToken) {
          toast.warning(
            "Couldn't enable auto-sync — Google didn't return a refresh token. Tap 'Switch Account' and re-approve to enable sync.",
            { duration: 7000 }
          );
        } else {
          let linkedCount = 0;
          for (const { folder, folderPath: relativePath } of selectedFolders.values()) {
            // The folder cache key for a top-level selected folder is just its
            // name (see collectFolderFiles + ensureFolderPath). If the folder
            // contained no importable files the cache entry won't exist yet —
            // create the vault folder now so the sync link points at the right
            // destination.
            let vaultFolderId = folderCache[relativePath];
            if (!vaultFolderId) {
              vaultFolderId = (await ensureFolderPath(relativePath, folderCache)) ?? targetFolderId ?? undefined as any;
            }
            if (!vaultFolderId) continue;
            try {
              // Tag the vault folder with its Drive id (best-effort).
              await supabase
                .from('vault_folders')
                .update({ drive_folder_id: folder.id })
                .eq('id', vaultFolderId);

              const { error: linkErr } = await supabase
                .from('vault_drive_links')
                .insert({
                  club_id: targetClubId,
                  team_id: targetTeamId,
                  vault_folder_id: vaultFolderId,
                  drive_folder_id: folder.id,
                  drive_folder_name: folder.name,
                  refresh_token: refreshToken,
                  google_account_email: googleEmail,
                  created_by: userId,
                });
              if (linkErr) {
                // Duplicate = already linked; treat as success silently.
                if (!String(linkErr.message || '').toLowerCase().includes('duplicate')) {
                  console.error(`Failed to link ${folder.name} for sync:`, linkErr);
                }
              } else {
                linkedCount++;
              }
            } catch (e) {
              console.error(`Sync link error for ${folder.name}:`, e);
            }
          }
          if (linkedCount > 0) {
            toast.success(
              `Auto-sync enabled for ${linkedCount} folder${linkedCount === 1 ? '' : 's'} — new files in Drive will appear here automatically.`
            );
          }
        }
      }

      onImportComplete();
      onOpenChange(false);

    } catch (err) {
      console.error("Import error:", err);
      toast.error("Import failed");
    } finally {
      setImporting(false);
    }
  };

  const collectFolderFiles = async (
    folderId: string,
    pathPrefix: string,
    collected: { file: DriveFile; folderPath: string }[],
    listingFailures: { path: string; reason: string }[],
    onProgress?: (filesFoundSoFar: number) => void,
  ) => {
    // Retry list-files up to 3 times with backoff before giving up. Silent
    // listing failures were the root cause of subfolder files going missing.
    let lastErr: string | null = null;
    let data: any = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const { data: respData, error } = await supabase.functions.invoke('google-drive-import?action=list-files', {
          body: { accessToken, folderId },
        });
        if (error || respData?.error) {
          lastErr = respData?.error || error?.message || 'unknown error';
        } else {
          data = respData;
          lastErr = null;
          break;
        }
      } catch (e: any) {
        lastErr = e?.message || 'network error';
      }
      // Small backoff before retry (250ms, 750ms)
      await new Promise((r) => setTimeout(r, 250 + attempt * 500));
    }

    if (!data) {
      const reason = lastErr || 'unknown error';
      console.error(`collectFolderFiles: FAILED to list folder ${folderId} (${pathPrefix}): ${reason}`);
      listingFailures.push({ path: pathPrefix || 'folder', reason });
      return;
    }

    const folderFiles = (data?.files ?? []) as DriveFile[];
    const subfolders = (data?.folders ?? []) as DriveFile[];
    console.log(`collectFolderFiles: ${pathPrefix || '(root)'} -> ${folderFiles.length} files, ${subfolders.length} subfolders`);

    // Add files from this folder
    for (const file of folderFiles) {
      collected.push({ file, folderPath: pathPrefix });
    }
    onProgress?.(collected.length);

    // Recursively process subfolders
    for (const subfolder of subfolders) {
      await collectFolderFiles(
        subfolder.id,
        `${pathPrefix}/${subfolder.name}`,
        collected,
        listingFailures,
        onProgress,
      );
    }
  };

  const ensureFolderPath = async (relativePath: string, cache: Record<string, string>): Promise<string | null> => {
    if (cache[relativePath]) {
      return cache[relativePath];
    }

    const parts = relativePath.split('/').filter(Boolean);
    let parentId = targetFolderId;

    for (let i = 0; i < parts.length; i++) {
      const partPath = parts.slice(0, i + 1).join('/');

      if (cache[partPath]) {
        parentId = cache[partPath];
        continue;
      }

      const folderName = parts[i];

      // Look up an existing folder with the same name UNDER THE CORRECT PARENT
      // and matching team scope. Without these filters every subfolder with the
      // same name would collapse onto the first match and the Drive structure
      // would be lost on import.
      const { data: candidateFolders } = await supabase
        .from('vault_folders')
        .select('id, parent_id, team_id')
        .eq('name', folderName)
        .eq('club_id', targetClubId);

      const existing = (candidateFolders ?? []).find((f) => {
        const parentMatches = parentId
          ? f.parent_id === parentId
          : f.parent_id === null;
        const teamMatches = targetTeamId
          ? f.team_id === targetTeamId
          : f.team_id === null;
        return parentMatches && teamMatches;
      });

      if (existing) {
        cache[partPath] = existing.id;
        parentId = existing.id;
      } else {
        // Create folder
        const userId = (await supabase.auth.getUser()).data.user?.id;
        const { data: newFolder, error } = await supabase
          .from('vault_folders')
          .insert({
            name: folderName,
            club_id: targetClubId,
            team_id: targetTeamId,
            parent_id: parentId,
            created_by: userId,
          })
          .select('id')
          .single();

        if (error || !newFolder) {
          console.error("Failed to create folder:", error);
          return parentId;
        }

        cache[partPath] = newFolder.id;
        parentId = newFolder.id;
      }
    }

    return parentId;
  };

  const selectedCount = selectedFiles.size + selectedFolders.size;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-2xl" fullScreen={step === "browse"}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2">
            <HardDrive className="h-5 w-5" />
            Import from Google Drive
          </ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        {step === "connect" && (
          <div className="py-8 flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <HardDrive className="h-10 w-10 text-primary" />
            </div>
            <div className="text-center space-y-2">
              <p className="font-medium">Connect your Google Drive</p>
              <p className="text-sm text-muted-foreground">
                Sign in to browse and import files from your Drive
              </p>
            </div>
            <Button onClick={startOAuth} disabled={loading} size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Connecting...
                </>
              ) : (
                <>
                  <HardDrive className="h-4 w-4 mr-2" />
                  Connect Google Drive
                </>
              )}
            </Button>
          </div>
        )}

        {step === "browse" && (
          <div className="flex flex-col h-full min-h-0">
            {/* Breadcrumb navigation */}
            <div className="flex items-center gap-2 px-4 py-2 border-b overflow-x-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setFolderPath([]);
                  loadFolderContents(null);
                }}
                className="shrink-0"
              >
                <HardDrive className="h-4 w-4 mr-1" />
                My Drive
              </Button>
              {folderPath.map((folder, index) => (
                <div key={folder.id} className="flex items-center shrink-0">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => navigateToPath(index)}
                  >
                    {folder.name}
                  </Button>
                </div>
              ))}
            </div>

            {/* Selection toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
              <div className="flex items-center gap-2">
                {folderPath.length > 0 && (
                  <Button variant="ghost" size="sm" onClick={navigateBack}>
                    <ArrowLeft className="h-4 w-4 mr-1" />
                    Back
                  </Button>
                )}
                <Button variant="ghost" size="sm" onClick={() => loadFolderContents(currentFolderId)}>
                  <RefreshCw className="h-4 w-4" />
                </Button>
                <Button 
                  variant="ghost" 
                  size="sm" 
                  onClick={() => {
                    setAccessToken(null);
                    setRefreshToken(null);
                    setGoogleEmail(null);
                    setStep("connect");
                    setFolders([]);
                    setFiles([]);
                    setCurrentFolderId(null);
                    setFolderPath([]);
                    setSelectedFiles(new Map());
                    setSelectedFolders(new Map());
                  }}
                  className="text-muted-foreground"
                >
                  <UserCircle className="h-4 w-4 mr-1" />
                  Switch Account
                </Button>
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={selectAll}>
                  Select All
                </Button>
                {selectedCount > 0 && (
                  <Button variant="ghost" size="sm" onClick={deselectAll}>
                    Clear ({selectedCount})
                  </Button>
                )}
              </div>
            </div>

            {/* File list */}
            <ScrollArea className="flex-1 min-h-0">
              {loading ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  <p className="text-muted-foreground">Loading...</p>
                </div>
              ) : folders.length === 0 && files.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <Folder className="h-12 w-12 text-muted-foreground" />
                  <p className="text-muted-foreground">This folder is empty</p>
                </div>
              ) : (
                <div className="p-4 space-y-1">
                  {/* Folders */}
                  {folders.map((folder) => (
                    <Card
                      key={folder.id}
                      className={`cursor-pointer transition-colors ${
                        selectedFolders.has(folder.id) ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                      }`}
                    >
                      <CardContent className="p-3 flex items-center gap-3">
                        <Checkbox
                          checked={selectedFolders.has(folder.id)}
                          onCheckedChange={() => toggleFolderSelection(folder)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        <div
                          className="flex items-center gap-3 flex-1"
                          onClick={() => navigateToFolder(folder)}
                        >
                          <Folder className="h-5 w-5 text-primary" />
                          <span className="font-medium">{folder.name}</span>
                        </div>
                        <ChevronRight className="h-4 w-4 text-muted-foreground" />
                      </CardContent>
                    </Card>
                  ))}

                  {/* Files */}
                  {files.map((file) => (
                    <Card
                      key={file.id}
                      className={`cursor-pointer transition-colors ${
                        selectedFiles.has(file.id) ? 'border-primary bg-primary/5' : 'hover:bg-accent/50'
                      }`}
                      onClick={() => toggleFileSelection(file)}
                    >
                      <CardContent className="p-3 flex items-center gap-3">
                        <Checkbox
                          checked={selectedFiles.has(file.id)}
                          onCheckedChange={() => toggleFileSelection(file)}
                          onClick={(e) => e.stopPropagation()}
                        />
                        {getFileIcon(file.mimeType)}
                        <span className="flex-1 truncate">{file.name}</span>
                        {file.size && (
                          <span className="text-xs text-muted-foreground">
                            {formatBytes(parseInt(file.size))}
                          </span>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </ScrollArea>

            {/* Footer with import button */}
            <div className="border-t p-4 space-y-3">
              {selectedFolders.size > 0 && (
                <label className="flex items-start gap-2 cursor-pointer">
                  <Checkbox
                    checked={keepInSync}
                    onCheckedChange={(v) => setKeepInSync(v === true)}
                    disabled={!refreshToken}
                    className="mt-0.5"
                  />
                  <span className="text-sm">
                    <span className="font-medium">Keep in sync</span>
                    <span className="text-muted-foreground">
                      {' '}— automatically import new and updated files added to{' '}
                      {selectedFolders.size === 1 ? 'this folder' : 'these folders'} in Drive.
                    </span>
                    {!refreshToken && (
                      <span className="block text-xs text-amber-600 mt-1">
                        Tap "Switch Account" and re-approve to enable auto-sync.
                      </span>
                    )}
                  </span>
                </label>
              )}
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">
                  {selectedCount} item{selectedCount !== 1 ? 's' : ''} selected
                </p>
                <div className="flex gap-2">
                  <Button variant="outline" onClick={() => onOpenChange(false)}>
                    Cancel
                  </Button>
                  <Button onClick={startImport} disabled={selectedCount === 0}>
                    <Check className="h-4 w-4 mr-2" />
                    Import {selectedCount > 0 ? `(${selectedCount})` : ''}
                  </Button>
                </div>
              </div>
            </div>
          </div>
        )}

        {step === "importing" && (
          <div className="py-8 flex flex-col items-center gap-6">
            <div className="w-20 h-20 rounded-full bg-primary/10 flex items-center justify-center">
              <Loader2 className="h-10 w-10 text-primary animate-spin" />
            </div>
            <div className="text-center space-y-2 w-full px-4">
              <p className="font-medium">
                {importProgress.total === 0 ? "Scanning Drive..." : "Importing files..."}
              </p>
              <p className="text-sm text-muted-foreground truncate">
                {importProgress.currentFile || "Preparing..."}
              </p>
              {importProgress.total > 0 && (
                <div className="mt-4">
                  <Progress
                    value={(importProgress.current / importProgress.total) * 100}
                    className="h-2"
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    {importProgress.current} of {importProgress.total} files
                  </p>
                </div>
              )}
            </div>
          </div>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}
