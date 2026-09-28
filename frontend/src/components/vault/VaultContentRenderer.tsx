import { ChevronDown, FolderOpen } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Progress } from "@/components/ui/progress";
import { VaultFolderCard } from "@/components/vault/VaultFolderCard";
import { ContentSection, type ContentSectionProps } from "@/components/vault/VaultContentSection";
import type { VaultFile, VaultPhoto } from "@/components/vault/VaultTypes";
import { TrashSection, type TrashSectionProps } from "@/components/vault/VaultTrashSection";
import { VaultPhotoItem } from "@/components/vault/VaultPhotoItem";

export { ContentSection, TrashSection, VaultPhotoItem };
export type { ContentSectionProps, TrashSectionProps, VaultFile, VaultPhoto };



export type VaultStorageTeamProjection = {
  teamId: string | null;
  teamName: string;
  size: number;
};

export function VaultStorageTeamProjection({
  byTeam,
  totalStorage,
  formatStorageSize,
}: {
  byTeam: readonly VaultStorageTeamProjection[];
  totalStorage: number;
  formatStorageSize: (bytes: number) => string;
}) {
  if (byTeam.length === 0) return null;

  return (
    <Collapsible className="pt-3 border-t">
      <CollapsibleTrigger className="flex items-center justify-between w-full text-xs font-medium text-muted-foreground hover:text-foreground transition-colors group">
        <span>Storage by Team</span>
        <ChevronDown className="h-3 w-3 transition-transform group-data-[state=open]:rotate-180" />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-2 space-y-2">
        {byTeam.slice(0, 5).map((team) => {
          const percentage = totalStorage > 0
            ? Math.min(100, (team.size / totalStorage) * 100)
            : 0;
          return (
            <div key={team.teamId || "club"} className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <div className="flex items-center gap-1.5 min-w-0">
                  <FolderOpen className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="truncate">{team.teamName}</span>
                </div>
                <span className="text-muted-foreground shrink-0">
                  {formatStorageSize(team.size)} ({Math.round(percentage)}%)
                </span>
              </div>
              <Progress
                value={percentage}
                className="h-1.5 w-full bg-white dark:bg-muted [&>div]:bg-primary"
              />
            </div>
          );
        })}
        {byTeam.length > 5 && (
          <span className="text-xs text-muted-foreground">+{byTeam.length - 5} more teams</span>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}

export type VaultContentRendererProps = {
  folders: Array<{ id: string; name: string }>;
  searchQuery?: string;
  onNavigateToFolder: (folder: { id: string; name: string }) => void;
  onShareFolder: (folder: { id: string; name: string }) => void;
  onExportFolder: (folder: { id: string; name: string }) => void;
  onRenameFolder: (folder: { id: string; name: string }) => void;
  onDeleteFolder: (folder: { id: string; name: string }) => void;
  canEditFolder: (folder: { id: string; name: string }) => boolean;
} & (
  | { mode: "content"; content: ContentSectionProps }
  | { mode: "trash"; trash: TrashSectionProps }
);

export function VaultContentRenderer(props: VaultContentRendererProps) {
  const {
    folders,
    searchQuery,
    onNavigateToFolder,
    onShareFolder,
    onExportFolder,
    onRenameFolder,
    onDeleteFolder,
    canEditFolder,
  } = props;
  return (
    <>
      {props.mode === "content" && folders.length > 0 && (
        <div className="space-y-3">
          <h2 className="text-sm font-medium text-muted-foreground">Folders</h2>
          {folders.map((folder) => (
            <VaultFolderCard
              key={folder.id}
              folder={folder}
              searchQuery={searchQuery}
              onNavigate={() => onNavigateToFolder(folder)}
              onShare={() => onShareFolder(folder)}
              onExport={() => onExportFolder(folder)}
              onRename={() => onRenameFolder(folder)}
              onDelete={() => onDeleteFolder(folder)}
              canEdit={canEditFolder(folder)}
            />
          ))}
        </div>
      )}
      {props.mode === "content" ? (
        <ContentSection {...props.content} />
      ) : (
        <TrashSection {...props.trash} />
      )}
    </>
  );
}
