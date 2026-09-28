import { useState } from "react";
import {
  Download,
  MoreVertical,
  Pencil,
  Trash2,
  CheckSquare,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";

// Photo item with three-dot menu for actions
export function VaultPhotoItem({
  photo,
  index,
  onPhotoClick,
  canDelete,
  onDelete,
  onDownload,
  canRename,
  onRename,
  selectionMode = false,
  isSelected = false,
  onToggleSelection,
}: {
  photo: any;
  index: number;
  onPhotoClick: (index: number) => void;
  canDelete: boolean;
  onDelete: (id: string) => void;
  onDownload?: (url: string, filename: string) => void;
  canRename?: boolean;
  onRename?: (photo: any) => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggleSelection?: (id: string) => void;
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);

  // Use file_url or image_url (mini-league photos use image_url)
  const rawPhotoUrl = photo.file_url || photo.image_url;
  
  // Get signed URL for private bucket photos
  const { signedUrl, isLoading: isLoadingSignedUrl } = useSignedPhotoUrl(rawPhotoUrl);
  const photoUrl = signedUrl || rawPhotoUrl;
  
  // If no URL is available, show error state
  if (!rawPhotoUrl) {
    return (
      <div className="aspect-square rounded-lg bg-muted flex items-center justify-center">
        <span className="text-xs text-muted-foreground">No image</span>
      </div>
    );
  }
  
  // Show loading state while fetching signed URL or loading image
  if (isLoadingSignedUrl || (!isLoaded && !hasError)) {
    return (
      <>
        {/* Only start preloading once we have a signed URL */}
        {!isLoadingSignedUrl && photoUrl && (
          <img
            src={photoUrl}
            alt=""
            style={{ position: 'absolute', left: '-9999px', width: '1px', height: '1px' }}
            onLoad={() => setIsLoaded(true)}
            onError={() => {
              console.error('[VaultPhotoItem] Failed to load image:', photoUrl);
              setHasError(true);
            }}
          />
        )}
        {/* Placeholder skeleton while loading */}
        <div className="aspect-square rounded-lg bg-muted animate-pulse" />
      </>
    );
  }
  
  // Show error state if image failed to load
  if (hasError) {
    return (
      <div className="aspect-square rounded-lg bg-muted flex items-center justify-center">
        <span className="text-xs text-muted-foreground text-center px-2">Failed to load</span>
      </div>
    );
  }

  const hasActions = onDownload || (canRename && onRename) || canDelete;

  return (
    <div className={`relative group ${selectionMode && isSelected ? 'ring-2 ring-primary rounded-lg' : ''}`}>
      <img
        src={photoUrl}
        alt={photo.title || "Photo"}
        className={`aspect-square object-cover rounded-lg cursor-pointer transition-opacity select-none hover:opacity-90 ${selectionMode && isSelected ? 'opacity-75' : ''}`}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => selectionMode ? onToggleSelection?.(photo.id) : onPhotoClick(index)}
      />
      {/* Selection checkbox overlay */}
      {selectionMode && (
        <div 
          className="absolute top-1.5 left-1.5 z-10"
          onClick={(e) => { e.stopPropagation(); onToggleSelection?.(photo.id); }}
        >
          <div className={`h-6 w-6 rounded-full border-2 flex items-center justify-center transition-colors ${
            isSelected 
              ? 'bg-primary border-primary text-primary-foreground' 
              : 'bg-background/80 border-muted-foreground/50'
          }`}>
            {isSelected && <CheckSquare className="h-3.5 w-3.5" />}
          </div>
        </div>
      )}
      {/* Three-dot menu for actions - hide in selection mode */}
      {!selectionMode && hasActions && (
        <div className="absolute top-1 right-1">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="secondary"
                size="icon"
                className="h-6 w-6 opacity-0 group-hover:opacity-100 transition-opacity"
                onClick={(e) => e.stopPropagation()}
              >
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="bg-popover">
              {onDownload && (
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onDownload(photoUrl, photo.title || `photo-${photo.id}.jpg`);
                }}>
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </DropdownMenuItem>
              )}
              {canRename && onRename && (
                <DropdownMenuItem onClick={(e) => {
                  e.stopPropagation();
                  onRename(photo);
                }}>
                  <Pencil className="h-4 w-4 mr-2" />
                  Rename
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem 
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(photo.id);
                  }}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}
    </div>
  );
}
