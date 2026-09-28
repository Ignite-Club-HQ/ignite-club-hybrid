import { useState } from "react";
import { format } from "date-fns";
import {
  Download,
  ExternalLink,
  FileSpreadsheet,
  FileText,
  FolderDown,
  FolderOpen,
  HardDrive,
  MoreVertical,
  Pencil,
  RotateCcw,
  Sheet,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Sheet as UISheet,
  SheetContent as UISheetContent,
  SheetHeader as UISheetHeader,
  SheetTitle as UISheetTitle,
} from "@/components/ui/sheet";
import { HighlightedText } from "@/components/vault/HighlightedText";
import { VaultPhotoItem } from "@/components/vault/VaultPhotoItem";
import { formatVaultFileSize, getVaultExternalLinkInfo, isVaultDocumentFile, isVaultSpreadsheetFile } from "@/features/vault/vaultFilePresentation";
import { toast } from "sonner";

import type { VaultFile, VaultPhoto } from "@/components/vault/VaultTypes";

// Helper function to download and open in external service
function downloadAndOpenExternal(
  fileUrl: string, 
  fileName: string, 
  serviceUrl: string,
  serviceName: string,
  instructions: string,
  showToast: (msg: string, opts?: { description?: string }) => void
): void {
  // Download the file first
  const link = document.createElement('a');
  link.href = fileUrl;
  link.download = fileName;
  link.click();
  
  // Show toast with instructions
  showToast("File downloaded!", {
    description: `Opening ${serviceName}... ${instructions}`
  });
  
  // Open the service after a brief delay
  setTimeout(async () => {
    const { safeOpenUrl } = await import("@/lib/safeOpenUrl");
    safeOpenUrl(serviceUrl);
  }, 500);
}

// Helper function to open a file in Google Sheets
function openInGoogleSheets(fileUrl: string, fileName: string, showToast: (msg: string, opts?: { description?: string }) => void): void {
  downloadAndOpenExternal(
    fileUrl, 
    fileName, 
    "https://reference.invalid",
    "Google Sheets",
    "Use File > Import to open your downloaded file.",
    showToast
  );
}

// Helper function to open a file in Google Drive
function openInGoogleDrive(fileUrl: string, fileName: string, showToast: (msg: string, opts?: { description?: string }) => void): void {
  downloadAndOpenExternal(
    fileUrl, 
    fileName, 
    "https://reference.invalid",
    "Google Drive",
    "Click 'New' > 'File upload' to upload your downloaded file.",
    showToast
  );
}

// Helper function to open a file in Dropbox
function openInDropbox(fileUrl: string, fileName: string, showToast: (msg: string, opts?: { description?: string }) => void): void {
  downloadAndOpenExternal(
    fileUrl, 
    fileName, 
    "https://reference.invalid",
    "Dropbox",
    "Click 'Upload' to add your downloaded file.",
    showToast
  );
}

export interface ContentSectionProps {
  photos: VaultPhoto[];
  files: VaultFile[];
  onPhotoClick: (index: number) => void;
  canDeletePhoto: (photo: VaultPhoto) => boolean;
  canDeleteFile: (file: VaultFile) => boolean;
  canRenamePhoto?: (photo: VaultPhoto) => boolean;
  canRenameFile?: (file: VaultFile) => boolean;
  canMoveFile?: (file: VaultFile) => boolean;
  onDeletePhoto: (id: string) => void;
  onDeleteFile: (id: string) => void;
  onRenamePhoto?: (photo: VaultPhoto) => void;
  onRenameFile?: (file: VaultFile) => void;
  onMoveFile?: (file: VaultFile) => void;
  onDownloadPhoto?: (url: string, filename: string) => void;
  // Selection mode props
  selectionMode?: boolean;
  selectedPhotos?: Set<string>;
  selectedFiles?: Set<string>;
  onTogglePhotoSelection?: (id: string) => void;
  onToggleFileSelection?: (id: string) => void;
  // Trash mode props
  isTrashView?: boolean;
  onRestorePhoto?: (id: string) => void;
  onRestoreFile?: (id: string) => void;
  onPermanentDeletePhoto?: (id: string) => void;
  onPermanentDeleteFile?: (id: string) => void;
  searchQuery?: string;
}

export function ContentSection({ 
  photos, 
  files, 
  onPhotoClick,
  canDeletePhoto,
  canDeleteFile,
  canRenamePhoto,
  canRenameFile,
  canMoveFile,
  onDeletePhoto,
  onDeleteFile,
  onRenamePhoto,
  onRenameFile,
  onMoveFile,
  onDownloadPhoto,
  selectionMode = false,
  selectedPhotos,
  selectedFiles,
  onTogglePhotoSelection,
  onToggleFileSelection,
  isTrashView = false,
  onRestorePhoto,
  onRestoreFile,
  onPermanentDeletePhoto,
  onPermanentDeleteFile,
  searchQuery,
}: ContentSectionProps) {
  const hasContent = photos.length > 0 || files.length > 0;
  const [actionSheetFile, setActionSheetFile] = useState<any | null>(null);

  if (!hasContent) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">{isTrashView ? "Trash is empty" : "This folder is empty"}</p>
          <p className="text-sm text-muted-foreground mt-1">{isTrashView ? "Deleted files will appear here" : "Upload photos or files to get started"}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {photos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Photos ({photos.length})</h2>
          <div className="grid grid-cols-3 gap-2">
            {photos.map((photo, index) => (
              <VaultPhotoItem
                key={photo.id}
                photo={photo}
                index={index}
                onPhotoClick={selectionMode ? () => onTogglePhotoSelection?.(photo.id) : onPhotoClick}
                canDelete={canDeletePhoto(photo)}
                onDelete={onDeletePhoto}
                onDownload={onDownloadPhoto}
                canRename={canRenamePhoto?.(photo)}
                onRename={onRenamePhoto}
                selectionMode={selectionMode}
                isSelected={selectedPhotos?.has(photo.id) || false}
                onToggleSelection={onTogglePhotoSelection}
              />
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Files ({files.length})</h2>
          <div className="space-y-2">
            {files.map((file) => {
              const isExternalLink = file.is_external_link;
              const externalLinkInfo = isExternalLink ? getVaultExternalLinkInfo(file.file_url) : null;
              
              return (
              <Card 
                key={file.id} 
                className="group cursor-pointer"
                onClick={() => {
                  // External links go to the browser; stored files hand off to
                  // the native viewer so the real file name is shown.
                  if (isExternalLink) {
                    import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(file.file_url));
                  } else {
                    import("@/lib/safeOpenFile").then(({ safeOpenFile }) =>
                      safeOpenFile(file.file_url, {
                        fileName: file.name || undefined,
                        mimeType: file.file_type || undefined,
                      }),
                    ).catch(() => {});
                  }
                }}
              >
                <CardContent className="p-3 flex items-center gap-3">
                  {isExternalLink && externalLinkInfo ? (
                    <div className="p-2 rounded-lg bg-muted flex items-center justify-center text-lg">
                      {externalLinkInfo.icon}
                    </div>
                  ) : (
                    <div className={`p-2 rounded-lg ${isVaultSpreadsheetFile(file.name || '') ? 'bg-green-500/10' : 'bg-primary/10'}`}>
                      {isVaultSpreadsheetFile(file.name || '') ? (
                        <FileSpreadsheet className="h-4 w-4 text-green-600" />
                      ) : (
                        <FileText className="h-4 w-4 text-primary" />
                      )}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">
                      <HighlightedText text={file.name} query={searchQuery} />
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {isExternalLink && externalLinkInfo ? (
                        <span className={externalLinkInfo.color}>{externalLinkInfo.type}</span>
                      ) : (
                        <>
                          {format(new Date(file.created_at), "MMM d, yyyy")}
                          {file.file_size ? ` • ${formatVaultFileSize(file.file_size)}` : ''}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                      {isTrashView ? (
                        <>
                          {onRestoreFile && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-green-600 hover:text-green-700"
                              onClick={(e) => {
                                e.stopPropagation();
                                onRestoreFile(file.id);
                              }}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {onPermanentDeleteFile && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                onDeleteFile(file.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          )}
                        </>
                      ) : (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:text-foreground"
                          onClick={(e) => {
                            e.stopPropagation();
                            setActionSheetFile(file);
                          }}
                          aria-label="File actions"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                </CardContent>
              </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* File actions bottom sheet */}
      <UISheet open={!!actionSheetFile} onOpenChange={(o) => { if (!o) setActionSheetFile(null); }}>
        <UISheetContent side="bottom" className="rounded-t-xl pb-[max(env(safe-area-inset-bottom),1rem)]">
          {actionSheetFile && (() => {
            const file = actionSheetFile;
            const isExternalLink = file.is_external_link;
            const externalLinkInfo = isExternalLink ? getVaultExternalLinkInfo(file.file_url) : null;
            const close = () => setActionSheetFile(null);
            const Item = ({ icon: Icon, label, onClick, destructive = false }: { icon: any; label: string; onClick: () => void; destructive?: boolean }) => (
              <button
                type="button"
                onClick={() => { onClick(); close(); }}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-lg text-left text-sm hover:bg-accent active:bg-accent transition-colors ${destructive ? 'text-destructive' : 'text-foreground'}`}
              >
                <Icon className="h-5 w-5" />
                <span>{label}</span>
              </button>
            );
            return (
              <>
                <UISheetHeader className="text-left">
                  <UISheetTitle className="truncate">{file.name}</UISheetTitle>
                </UISheetHeader>
                <div className="mt-2 flex flex-col gap-1">
                  {isExternalLink ? (
                    <Item
                      icon={ExternalLink}
                      label={`Open ${externalLinkInfo?.type || 'Link'}`}
                      onClick={() => import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(file.file_url))}
                    />
                  ) : (
                    <>
                      <Item
                        icon={ExternalLink}
                        label="Open"
                        onClick={() =>
                          import("@/lib/safeOpenFile").then(({ safeOpenFile }) =>
                            safeOpenFile(file.file_url, {
                              fileName: file.name || undefined,
                              mimeType: file.file_type || undefined,
                            }),
                          ).catch(() => {})
                        }
                      />
                      <Item
                        icon={Download}
                        label="Download"
                        onClick={async () => {
                          const { resolveSignedUrl } = await import("@/hooks/useSignedPhotoUrl");
                          const href = await resolveSignedUrl(file.file_url);
                          const a = document.createElement('a');
                          a.href = href;
                          a.download = file.name || '';
                          a.rel = 'noopener';
                          a.target = '_blank';
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                        }}
                      />
                    </>
                  )}
                  {!isExternalLink && isVaultSpreadsheetFile(file.name || '') && (
                    <Item
                      icon={Sheet}
                      label="Open in Google Sheets"
                      onClick={() => openInGoogleSheets(file.file_url, file.name || 'spreadsheet', toast)}
                    />
                  )}
                  {!isExternalLink && isVaultDocumentFile(file.name || '') && (
                    <Item
                      icon={HardDrive}
                      label="Open in Google Drive"
                      onClick={() => openInGoogleDrive(file.file_url, file.name || 'document', toast)}
                    />
                  )}
                  {canMoveFile?.(file) && onMoveFile && (
                    <Item icon={FolderDown} label="Move to Folder" onClick={() => onMoveFile(file)} />
                  )}
                  {canRenameFile?.(file) && onRenameFile && (
                    <Item icon={Pencil} label="Rename" onClick={() => onRenameFile(file)} />
                  )}
                  {canDeleteFile(file) && (
                    <Item icon={Trash2} label="Delete" destructive onClick={() => onDeleteFile(file.id)} />
                  )}
                </div>
              </>
            );
          })()}
        </UISheetContent>
      </UISheet>
    </div>
  );
}

