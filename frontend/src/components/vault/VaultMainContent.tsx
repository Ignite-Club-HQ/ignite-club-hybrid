import { ChevronRight, FolderOpen, Loader2, Lock, Search, X } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { getFolderColorClass } from "@/components/TeamFoldersManager";
import type { FolderView } from "@/features/vault/useVaultExport";
import {
  VaultContentRenderer,
  type ContentSectionProps,
  type TrashSectionProps,
} from "@/components/vault/VaultContentRenderer";

export interface VaultSearchModel {
  query: string;
  isFetchingRecursive: boolean;
  folderMatchCount: number;
  photoMatchCount: number;
  fileMatchCount: number;
  onQueryChange: (value: string) => void;
}

export interface VaultRootClubSummary {
  id: string;
  name: string;
  is_pro?: boolean | null;
}

export interface VaultRootPickerModel {
  isLoadingClubs: boolean;
  clubs: VaultRootClubSummary[] | undefined;
  activeClubFilter: string | null;
  onSelectClub: (club: VaultRootClubSummary) => void;
}

export interface VaultTeamSummary {
  id: string;
  name: string;
  folder_id?: string | null;
}

export interface VaultTeamFolderSummary {
  id: string;
  name: string;
  color: string;
}

export interface VaultMiniLeagueSummary {
  id: string;
  name: string;
}

export interface VaultClubNavigationModel {
  teams: VaultTeamSummary[] | undefined;
  teamFolders: VaultTeamFolderSummary[] | undefined;
  miniLeagues: VaultMiniLeagueSummary[] | undefined;
  onSelectTeam: (team: VaultTeamSummary) => void;
  onSelectMiniLeague: (league: VaultMiniLeagueSummary) => void;
}

export type VaultFolderSummary = { id: string; name: string };

export type VaultContentRendererView =
  | { mode: "content"; content: ContentSectionProps }
  | { mode: "trash"; trash: TrashSectionProps };

export interface VaultContentBranchModel {
  folders: VaultFolderSummary[] | undefined;
  searchQuery: string;
  contentRendererView: VaultContentRendererView;
  miniLeagueContent: ContentSectionProps;
  actions: {
    onNavigateToFolder: (folder: VaultFolderSummary) => void;
    onShareFolder: (folder: VaultFolderSummary) => void;
    onExportFolder: (folder: VaultFolderSummary) => void;
    onRenameFolder: (folder: VaultFolderSummary) => void;
    onDeleteFolder: (folder: VaultFolderSummary) => void;
    canEditFolder: (folder: VaultFolderSummary) => boolean;
  };
}

export interface VaultMainContentProps {
  currentView: FolderView;
  showTrash: boolean;
  search: VaultSearchModel;
  rootPicker: VaultRootPickerModel;
  clubNavigation: VaultClubNavigationModel;
  content: VaultContentBranchModel;
}

function VaultSearchBar({ search }: { search: VaultSearchModel }) {
  const {
    query,
    isFetchingRecursive,
    folderMatchCount,
    photoMatchCount,
    fileMatchCount,
    onQueryChange,
  } = search;

  return (
    <div className="space-y-2">
      <div
        className={`relative rounded-md transition-shadow ${
          isFetchingRecursive ? "ring-2 ring-primary/40 ring-offset-0 animate-pulse" : ""
        }`}
      >
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none">
          {isFetchingRecursive ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Search className="h-4 w-4" />
          )}
        </span>
        <Input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="Search folders and files..."
          className="pl-9 pr-9"
          aria-busy={isFetchingRecursive}
        />
        {query && (
          <button
            type="button"
            onClick={() => onQueryChange("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 rounded-md hover:bg-accent"
            aria-label="Clear search"
          >
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        )}
      </div>
      {query.trim() && (
        <p
          className="text-xs text-muted-foreground px-1 flex items-center gap-1.5"
          role="status"
          aria-live="polite"
        >
          {isFetchingRecursive ? (
            <>
              <Loader2 className="h-3 w-3 animate-spin text-primary" />
              <span>Searching all nested folders…</span>
            </>
          ) : (
            (() => {
              const total = folderMatchCount + photoMatchCount + fileMatchCount;
              if (total === 0) {
                return <span>No matches for "{query}"</span>;
              }
              return (
                <span>
                  {total} {total === 1 ? "match" : "matches"} across all subfolders
                </span>
              );
            })()
          )}
        </p>
      )}
    </div>
  );
}

function VaultRootClubPicker({ rootPicker }: { rootPicker: VaultRootPickerModel }) {
  const { isLoadingClubs, clubs, activeClubFilter, onSelectClub } = rootPicker;

  return (
    <div className="space-y-3">
      {isLoadingClubs ? (
        <div className="flex flex-col items-center justify-center py-12 gap-3">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-muted-foreground">Loading clubs...</p>
        </div>
      ) : !clubs || clubs.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="p-8 text-center">
            <FolderOpen className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">No clubs found</p>
          </CardContent>
        </Card>
      ) : (
        (activeClubFilter ? clubs.filter(c => c.id === activeClubFilter) : clubs).map((club) => {
          const isPro = club.is_pro;
          return (
            <Card
              key={club.id}
              className="cursor-pointer hover:bg-accent/50 transition-colors"
              onClick={() => onSelectClub(club)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <FolderOpen className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1">
                  <p className="font-medium">{club.name}</p>
                  {!isPro && (
                    <p className="text-xs text-muted-foreground">Pro feature — Upgrade to unlock vault</p>
                  )}
                </div>
                {!isPro ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </CardContent>
            </Card>
          );
        })
      )}
    </div>
  );
}

function VaultTeamCard({
  team,
  onSelectTeam,
}: {
  team: VaultTeamSummary;
  onSelectTeam: (team: VaultTeamSummary) => void;
}) {
  return (
    <Card
      className="cursor-pointer hover:bg-accent/50 transition-colors"
      onClick={() => onSelectTeam(team)}
    >
      <CardContent className="p-3 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-secondary">
          <FolderOpen className="h-4 w-4 text-secondary-foreground" />
        </div>
        <p className="font-medium flex-1 text-sm">{team.name}</p>
        <ChevronRight className="h-4 w-4 text-muted-foreground" />
      </CardContent>
    </Card>
  );
}

function VaultClubTeamNavigation({
  teams,
  teamFolders,
  onSelectTeam,
}: {
  teams: VaultTeamSummary[];
  teamFolders: VaultTeamFolderSummary[] | undefined;
  onSelectTeam: (team: VaultTeamSummary) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-muted-foreground">Teams</h2>

      {/* Render team folders with their teams */}
      {teamFolders && teamFolders.length > 0 && teamFolders.map((folder) => {
        const teamsInFolder = teams.filter(team => team.folder_id === folder.id);
        if (teamsInFolder.length === 0) return null;

        const colorInfo = getFolderColorClass(folder.color);

        return (
          <div key={folder.id} className="space-y-2">
            <div className={`flex items-center gap-2 px-2 py-1 rounded-lg ${colorInfo.bgClassName}`}>
              <FolderOpen className={`h-4 w-4 ${colorInfo.className}`} />
              <span className="text-sm font-medium">{folder.name}</span>
              <span className="text-xs text-muted-foreground">({teamsInFolder.length})</span>
            </div>
            <div className="pl-2 space-y-2">
              {teamsInFolder.map((team) => (
                <VaultTeamCard key={team.id} team={team} onSelectTeam={onSelectTeam} />
              ))}
            </div>
          </div>
        );
      })}

      {/* Uncategorized teams (no folder_id) */}
      {(() => {
        const uncategorizedTeams = teams.filter(team => !team.folder_id);
        if (uncategorizedTeams.length === 0) return null;

        // Show header only if there are team folders with teams
        const hasTeamFolders = teamFolders && teamFolders.some(folder =>
          teams.some(team => team.folder_id === folder.id)
        );

        return (
          <div className="space-y-2">
            {hasTeamFolders && (
              <div className="flex items-center gap-2 px-2 py-1 rounded-lg bg-muted/50">
                <FolderOpen className="h-4 w-4 text-muted-foreground" />
                <span className="text-sm font-medium text-muted-foreground">Other Teams</span>
                <span className="text-xs text-muted-foreground">({uncategorizedTeams.length})</span>
              </div>
            )}
            <div className={hasTeamFolders ? "pl-2 space-y-2" : "space-y-2"}>
              {uncategorizedTeams.map((team) => (
                <VaultTeamCard key={team.id} team={team} onSelectTeam={onSelectTeam} />
              ))}
            </div>
          </div>
        );
      })()}
    </div>
  );
}

function VaultClubMiniLeagueNavigation({
  miniLeagues,
  onSelectMiniLeague,
}: {
  miniLeagues: VaultMiniLeagueSummary[];
  onSelectMiniLeague: (league: VaultMiniLeagueSummary) => void;
}) {
  return (
    <div className="space-y-4">
      <h2 className="text-sm font-medium text-muted-foreground">Mini-Leagues</h2>
      <div className="space-y-2">
        {miniLeagues.map((league) => (
          <Card
            key={league.id}
            className="cursor-pointer hover:bg-accent/50 transition-colors"
            onClick={() => onSelectMiniLeague(league)}
          >
            <CardContent className="p-3 flex items-center gap-3">
              <div className="p-2 rounded-lg bg-accent">
                <FolderOpen className="h-4 w-4 text-accent-foreground" />
              </div>
              <p className="font-medium flex-1 text-sm">{league.name}</p>
              <ChevronRight className="h-4 w-4 text-muted-foreground" />
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

export function VaultMainContent({
  currentView,
  showTrash,
  search,
  rootPicker,
  clubNavigation,
  content,
}: VaultMainContentProps) {
  const { teams, teamFolders, miniLeagues, onSelectTeam, onSelectMiniLeague } = clubNavigation;
  const { folders, searchQuery, contentRendererView, miniLeagueContent, actions } = content;
  const {
    onNavigateToFolder,
    onShareFolder,
    onExportFolder,
    onRenameFolder,
    onDeleteFolder,
    canEditFolder,
  } = actions;

  return (
    <>
      {/* Search bar — filter folders, files, and photos in the current view */}
      {currentView.type !== "root" && !showTrash && <VaultSearchBar search={search} />}

      {currentView.type === "root" && <VaultRootClubPicker rootPicker={rootPicker} />}

      {currentView.type === "club" && (
        <div className="space-y-6">
          {/* Teams grouped by team folders - only show at root of club and not in trash view */}
          {!showTrash && !currentView.folderId && teams && teams.length > 0 && (
            <VaultClubTeamNavigation
              teams={teams}
              teamFolders={teamFolders}
              onSelectTeam={onSelectTeam}
            />
          )}

          {/* Mini-Leagues - only show at root of club and not in trash view */}
          {!showTrash && !currentView.folderId && miniLeagues && miniLeagues.length > 0 && (
            <VaultClubMiniLeagueNavigation
              miniLeagues={miniLeagues}
              onSelectMiniLeague={onSelectMiniLeague}
            />
          )}

          <VaultContentRenderer
            folders={folders || []}
            searchQuery={searchQuery}
            onNavigateToFolder={(folder) => onNavigateToFolder(folder)}
            onShareFolder={(folder) => onShareFolder(folder)}
            onExportFolder={(folder) => onExportFolder(folder)}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            canEditFolder={canEditFolder}
            {...contentRendererView}
          />
        </div>
      )}

      {currentView.type === "team" && (
        <div className="space-y-6">
          <VaultContentRenderer
            folders={folders || []}
            searchQuery={searchQuery}
            onNavigateToFolder={(folder) => onNavigateToFolder(folder)}
            onShareFolder={(folder) => onShareFolder(folder)}
            onExportFolder={(folder) => onExportFolder(folder)}
            onRenameFolder={onRenameFolder}
            onDeleteFolder={onDeleteFolder}
            canEditFolder={canEditFolder}
            {...contentRendererView}
          />
        </div>
      )}

      {currentView.type === "mini-league" && (
        <div className="space-y-6">
          <VaultContentRenderer
            folders={[]}
            searchQuery={searchQuery}
            onNavigateToFolder={() => undefined}
            onShareFolder={() => undefined}
            onExportFolder={() => undefined}
            onRenameFolder={() => undefined}
            onDeleteFolder={() => undefined}
            canEditFolder={() => false}
            mode="content"
            content={miniLeagueContent}
          />
        </div>
      )}
    </>
  );
}
