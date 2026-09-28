import { CheckSquare, Download, FileArchive, FileText, FolderOpen, Loader2, Square } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import type { VaultExportAction, VaultExportPreviewData, VaultFolderExportData } from "@/features/vault/useVaultExport";

interface VaultExportDialogsProps {
  previewOpen: boolean;
  onPreviewOpenChange: (open: boolean) => void;
  previewData: VaultExportPreviewData;
  excludedFolders: ReadonlySet<string>;
  filteredData: { photos: unknown[]; files: unknown[] };
  onToggleFolderExclusion: (path: string) => void;
  onConfirmWithSubfolders: () => void;
  confirmOpen: boolean;
  onConfirmOpenChange: (open: boolean) => void;
  pendingAction: VaultExportAction | null;
  summary: { photoCount: number; fileCount: number; isSelection: boolean };
  onClearPendingAction: () => void;
  onConfirm: () => void;
  folderOpen: boolean;
  onFolderOpenChange: (open: boolean) => void;
  folderData: VaultFolderExportData | null;
  onTogglePhoto: (id: string) => void;
  onToggleFile: (id: string) => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  onExportSelected: () => void;
}

export function VaultExportDialogs({
  previewOpen, onPreviewOpenChange, previewData, excludedFolders, filteredData,
  onToggleFolderExclusion, onConfirmWithSubfolders, confirmOpen, onConfirmOpenChange,
  pendingAction, summary, onClearPendingAction, onConfirm, folderOpen,
  onFolderOpenChange, folderData, onTogglePhoto, onToggleFile, onSelectAll,
  onDeselectAll, onExportSelected,
}: VaultExportDialogsProps) {
  return (
    <>
      <Dialog open={previewOpen} onOpenChange={onPreviewOpenChange}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Export All Folders</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {previewData.loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Scanning folders...</span></div>
            ) : (
              <>
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Photos to export:</span><span className="font-medium">{filteredData.photos.length}</span></div>
                  <div className="flex justify-between text-sm"><span className="text-muted-foreground">Files to export:</span><span className="font-medium">{filteredData.files.length}</span></div>
                  <div className="flex justify-between text-sm border-t pt-2 mt-2"><span className="font-medium">Total:</span><span className="font-medium">{filteredData.photos.length + filteredData.files.length} items</span></div>
                </div>
                {previewData.folderBreakdown.length > 0 && (
                  <div className="space-y-2">
                    <h4 className="text-sm font-medium text-muted-foreground">Select folders to include</h4>
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {previewData.folderBreakdown.map((folder) => {
                        const isExcluded = excludedFolders.has(folder.path);
                        return (
                          <div key={folder.path} className={`flex items-center justify-between text-sm py-1.5 px-2 rounded cursor-pointer transition-colors ${isExcluded ? "bg-muted/20 opacity-60" : "bg-muted/30 hover:bg-muted/50"}`} onClick={() => onToggleFolderExclusion(folder.path)}>
                            <div className="flex items-center gap-2 min-w-0 flex-1">
                              <Checkbox checked={!isExcluded} onCheckedChange={() => onToggleFolderExclusion(folder.path)} onClick={(event) => event.stopPropagation()} />
                              <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className={`truncate ${isExcluded ? "line-through" : ""}`}>{folder.path}</span>
                            </div>
                            <span className="text-muted-foreground shrink-0 ml-2">{folder.photoCount + folder.fileCount} items</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
                <div className="flex gap-2 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => onPreviewOpenChange(false)}>Cancel</Button>
                  <Button className="flex-1" onClick={onConfirmWithSubfolders} disabled={filteredData.photos.length + filteredData.files.length === 0}><FileArchive className="h-4 w-4 mr-1" />Export ZIP</Button>
                </div>
              </>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={onConfirmOpenChange}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm Export</AlertDialogTitle>
            <AlertDialogDescription>
              {summary.isSelection
                ? `You are about to export ${summary.photoCount + summary.fileCount} selected item${summary.photoCount + summary.fileCount !== 1 ? "s" : ""}.`
                : pendingAction?.type === "zipAll"
                  ? "This will export all files in the current folder and its subfolders as a ZIP file."
                  : `You are about to export ${summary.photoCount} photo${summary.photoCount !== 1 ? "s" : ""} and ${summary.fileCount} file${summary.fileCount !== 1 ? "s" : ""} from the current folder.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="bg-muted/50 rounded-lg p-3 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-muted-foreground">Photos:</span><span className="font-medium">{summary.photoCount}</span></div>
            <div className="flex justify-between"><span className="text-muted-foreground">Files:</span><span className="font-medium">{summary.fileCount}</span></div>
            <div className="flex justify-between border-t pt-1 mt-1"><span className="font-medium">Total:</span><span className="font-medium">{summary.photoCount + summary.fileCount} items</span></div>
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={onClearPendingAction}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onConfirm}><FileArchive className="h-4 w-4 mr-1" />Export</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={folderOpen} onOpenChange={onFolderOpenChange}>
        <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
          <DialogHeader><DialogTitle className="flex items-center gap-2"><Download className="h-5 w-5" />Export: {folderData?.folderName}</DialogTitle></DialogHeader>
          <div className="flex-1 overflow-hidden flex flex-col">
            {folderData?.loading ? (
              <div className="flex items-center justify-center py-8"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /><span className="ml-2 text-muted-foreground">Loading folder contents...</span></div>
            ) : folderData ? (
              <>
                <div className="flex items-center justify-between mb-3 gap-2">
                  <div className="flex items-center gap-2">
                    <Button variant="outline" size="sm" onClick={onSelectAll}><CheckSquare className="h-4 w-4 mr-1" />Select All</Button>
                    <Button variant="outline" size="sm" onClick={onDeselectAll}><Square className="h-4 w-4 mr-1" />Deselect All</Button>
                  </div>
                  <span className="text-sm text-muted-foreground">{folderData.selectedPhotos.size + folderData.selectedFiles.size} selected</span>
                </div>
                <div className="flex-1 overflow-y-auto space-y-3">
                  {folderData.photos.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground">Photos ({folderData.photos.length})</h3>
                      {folderData.photos.map((photo) => (
                        <div key={photo.id} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-accent/50 ${folderData.selectedPhotos.has(photo.id) ? "bg-accent/50" : ""}`} onClick={() => onTogglePhoto(photo.id)}>
                          <Checkbox checked={folderData.selectedPhotos.has(photo.id)} onCheckedChange={() => onTogglePhoto(photo.id)} />
                          <img src={photo.file_url} alt={photo.title || "Photo"} className="h-10 w-10 object-cover rounded" />
                          <span className="text-sm truncate flex-1">{photo.title || "Untitled photo"}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {folderData.files.length > 0 && (
                    <div className="space-y-2">
                      <h3 className="text-sm font-medium text-muted-foreground">Files ({folderData.files.length})</h3>
                      {folderData.files.map((file) => (
                        <div key={file.id} className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-accent/50 ${folderData.selectedFiles.has(file.id) ? "bg-accent/50" : ""}`} onClick={() => onToggleFile(file.id)}>
                          <Checkbox checked={folderData.selectedFiles.has(file.id)} onCheckedChange={() => onToggleFile(file.id)} />
                          <div className="p-2 rounded-lg bg-primary/10"><FileText className="h-4 w-4 text-primary" /></div>
                          <span className="text-sm truncate flex-1">{file.name}</span>
                        </div>
                      ))}
                    </div>
                  )}
                  {folderData.photos.length === 0 && folderData.files.length === 0 && <div className="text-center py-8 text-muted-foreground"><FolderOpen className="h-10 w-10 mx-auto mb-2 opacity-50" /><p>This folder is empty</p></div>}
                </div>
                <div className="pt-4 border-t mt-4"><Button className="w-full" onClick={onExportSelected} disabled={folderData.selectedPhotos.size + folderData.selectedFiles.size === 0}><FileArchive className="h-4 w-4 mr-1" />Export {folderData.selectedPhotos.size + folderData.selectedFiles.size} Items as ZIP</Button></div>
              </>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
