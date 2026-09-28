import { FolderOpen, ChevronRight, Share2, Pencil, Trash2, Download } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { SwipeableRow } from "@/components/ui/swipeable-row";
import { HighlightedText } from "@/components/vault/HighlightedText";

interface VaultFolderCardProps {
  folder: { id: string; name: string };
  onNavigate: () => void;
  onShare?: () => void;
  onRename?: () => void;
  onDelete?: () => void;
  onExport?: () => void;
  canEdit?: boolean;
  searchQuery?: string;
}

export function VaultFolderCard({
  folder,
  onNavigate,
  onShare,
  onRename,
  onDelete,
  onExport,
  canEdit = false,
  searchQuery,
}: VaultFolderCardProps) {
  // Build swipe actions for all available actions (replaces three-dot menu to avoid scroll interference)
  const swipeActions = [];
  if (canEdit && onRename) {
    swipeActions.push({
      label: "Rename",
      icon: <Pencil className="h-4 w-4" />,
      onClick: onRename,
      className: "bg-blue-500 text-white",
    });
  }
  if (canEdit && onDelete) {
    swipeActions.push({
      label: "Delete",
      icon: <Trash2 className="h-4 w-4" />,
      onClick: onDelete,
      className: "bg-destructive text-destructive-foreground",
    });
  }
  if (onExport) {
    swipeActions.push({
      label: "Export",
      icon: <Download className="h-4 w-4" />,
      onClick: onExport,
      className: "bg-primary text-primary-foreground",
    });
  }
  if (onShare) {
    swipeActions.push({
      label: "Share",
      icon: <Share2 className="h-4 w-4" />,
      onClick: onShare,
      className: "bg-secondary text-secondary-foreground",
    });
  }

  const cardContent = (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors group"
      onClick={onNavigate}
      role="link"
      aria-label={`Open folder ${folder.name}`}
    >
      <CardContent className="p-4 flex items-center gap-3">
        <div className="flex items-center gap-3 flex-1">
          <div className="p-2 rounded-lg bg-primary/10">
            <FolderOpen className="h-5 w-5 text-primary" aria-hidden="true" />
          </div>
          <p className="font-medium">
            <HighlightedText text={folder.name} query={searchQuery} />
          </p>
        </div>
        
        <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
      </CardContent>
    </Card>
  );

  if (swipeActions.length > 0) {
    return (
      <SwipeableRow
        enabled
        actions={swipeActions}
        actionsWidth={swipeActions.length * 70}
      >
        {cardContent}
      </SwipeableRow>
    );
  }

  return cardContent;
}
