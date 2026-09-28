import { format } from "date-fns";
import { FileText, FolderOpen, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Card, CardContent } from "@/components/ui/card";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { formatVaultFileSize } from "@/features/vault/vaultFilePresentation";
import type { VaultFile, VaultPhoto } from "@/components/vault/VaultTypes";

// Small component to render signed thumbnail for trash photos
function TrashPhotoThumbnail({ src, alt }: { src: string; alt: string }) {
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  const effectiveSrc = signedUrl || src;
  
  if (isLoading) {
    return <div className="h-12 w-12 rounded-lg bg-muted animate-pulse flex-shrink-0" />;
  }
  
  return (
    <img
      src={effectiveSrc}
      alt={alt}
      className="h-12 w-12 object-cover rounded-lg flex-shrink-0"
    />
  );
}

function TrashItemActions({
  id,
  onRestore,
  onPermanentDelete,
}: {
  id: string;
  onRestore: (id: string) => void;
  onPermanentDelete?: (id: string) => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Button
        variant="ghost"
        size="sm"
        className="text-green-600 hover:text-green-700 hover:bg-green-50"
        onClick={(e) => {
          e.stopPropagation();
          onRestore(id);
        }}
      >
        <RotateCcw className="h-4 w-4 mr-1" />
        Restore
      </Button>
      {onPermanentDelete && (
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={(e) => {
            e.stopPropagation();
            onPermanentDelete(id);
          }}
        >
          <Trash2 className="h-4 w-4 mr-1" />
          Delete
        </Button>
      )}
    </div>
  );
}

// Trash section component - shows all deleted items in a flat list with original location
export interface TrashSectionProps {
  photos: VaultPhoto[];
  files: VaultFile[];
  isLoading: boolean;
  onRestorePhoto: (id: string) => void;
  onRestoreFile: (id: string) => void;
  onPermanentDeletePhoto?: (id: string) => void;
  onPermanentDeleteFile?: (id: string) => void;
  onEmptyTrash?: () => void;
  isEmptyingTrash?: boolean;
}

export function TrashSection({
  photos,
  files,
  isLoading,
  onRestorePhoto,
  onRestoreFile,
  onPermanentDeletePhoto,
  onPermanentDeleteFile,
  onEmptyTrash,
  isEmptyingTrash,
}: TrashSectionProps) {
  const hasContent = photos.length > 0 || files.length > 0;

  const getLocationPath = (item: any): string => {
    const parts: string[] = [];
    if (item.team?.name) {
      parts.push(item.team.name);
    }
    if (item.folder?.name) {
      parts.push(item.folder.name);
    }
    if (parts.length === 0) {
      return item.team_id ? "Team root" : "Club root";
    }
    return parts.join(" / ");
  };

  if (isLoading) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Loader2 className="h-8 w-8 mx-auto text-muted-foreground mb-4 animate-spin" />
          <p className="text-muted-foreground">Loading trash...</p>
        </CardContent>
      </Card>
    );
  }

  if (!hasContent) {
    return (
      <Card className="border-dashed">
        <CardContent className="p-8 text-center">
          <Trash2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <p className="text-muted-foreground">Trash is empty</p>
          <p className="text-sm text-muted-foreground mt-1">Deleted files will appear here for recovery</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Auto-purge notice + Empty Trash */}
      <div className="flex items-center justify-between bg-muted/50 rounded-lg p-3">
        <p className="text-xs text-muted-foreground">
          Items in trash are automatically deleted after 30 days.
        </p>
        {onEmptyTrash && (
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="destructive"
                size="sm"
                disabled={isEmptyingTrash}
              >
                {isEmptyingTrash ? (
                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4 mr-1" />
                )}
                Empty Trash
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Empty Trash?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete all {photos.length + files.length} item{photos.length + files.length !== 1 ? 's' : ''} in the trash. Files will be removed from storage and cannot be recovered.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  onClick={onEmptyTrash}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  Yes, empty trash
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        )}
      </div>

      {photos.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Deleted Photos ({photos.length})</h2>
          <div className="space-y-2">
            {photos.map((photo) => (
              <Card key={photo.id} className="group">
                <CardContent className="p-3 flex items-center gap-3">
                  <TrashPhotoThumbnail src={photo.file_url} alt={photo.title || "Photo"} />
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{photo.title || "Untitled photo"}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FolderOpen className="h-3 w-3" />
                      {getLocationPath(photo)}
                    </p>
                    {photo.deleted_at && (
                      <p className="text-xs text-muted-foreground">
                        Deleted {format(new Date(photo.deleted_at), "MMM d, yyyy")}
                        {(() => {
                          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(photo.deleted_at).getTime()) / (1000 * 60 * 60 * 24)));
                          return ` • Auto-deletes in ${daysLeft}d`;
                        })()}
                      </p>
                    )}
                  </div>
                  <TrashItemActions id={photo.id} onRestore={onRestorePhoto} onPermanentDelete={onPermanentDeletePhoto} />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Deleted Files ({files.length})</h2>
          <div className="space-y-2">
            {files.map((file) => (
              <Card key={file.id} className="group">
                <CardContent className="p-3 flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-primary/10">
                    <FileText className="h-4 w-4 text-primary" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm truncate">{file.name}</p>
                    <p className="text-xs text-muted-foreground flex items-center gap-1">
                      <FolderOpen className="h-3 w-3" />
                      {getLocationPath(file)}
                    </p>
                    {file.deleted_at && (
                      <p className="text-xs text-muted-foreground">
                        Deleted {format(new Date(file.deleted_at), "MMM d, yyyy")}
                        {file.file_size ? ` • ${formatVaultFileSize(file.file_size)}` : ''}
                        {(() => {
                          const daysLeft = Math.max(0, 30 - Math.floor((Date.now() - new Date(file.deleted_at).getTime()) / (1000 * 60 * 60 * 24)));
                          return ` • Auto-deletes in ${daysLeft}d`;
                        })()}
                      </p>
                    )}
                  </div>
                  <TrashItemActions id={file.id} onRestore={onRestoreFile} onPermanentDelete={onPermanentDeleteFile} />
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
