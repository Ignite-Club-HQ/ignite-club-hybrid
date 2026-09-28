import { Suspense } from "react";
import { Capacitor } from "@capacitor/core";
import {
  ArrowLeft,
  CheckSquare,
  CloudDownload,
  Download,
  FileArchive,
  FolderDown,
  FolderOpen,
  FolderPlus,
  HardDrive,
  Link2,
  Loader2,
  MoreVertical,
  Plus,
  RefreshCw,
  Sheet,
  ShoppingCart,
  Trash2,
  Upload,
  X,
  ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Collapsible, CollapsibleContent } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { FolderView, VaultExportProgress } from "@/features/vault/useVaultExport";
import type { VaultStorageBreakdown as VaultStorageBreakdownData } from "@/features/vault/vaultStorageRepository";
import { VaultStorageBarRow } from "./VaultStorageBarRow";
import { VaultStorageTeamProjection } from "./VaultContentRenderer";

const VaultStorageBreakdown = lazyWithRetry(() =>
  import("@/components/vault/VaultStorageBreakdown").then((module) => ({
    default: module.VaultStorageBreakdown,
  })),
);

const DRIVE_IMPORT_ALLOWED_CLUB_IDS = new Set<string>([
  "966bdaec-ebf1-46da-b2b3-cc53bf05c422", // Bridgewater Soccer Club
  "493ee2e3-c834-487d-93be-d1c8a0dbc4a8", // Basket Range Cricket Club
  "36231b76-5313-478e-b8d5-23ac4f5e8b10", // Riverside FC
]);

export interface VaultHierarchyNode {
  key: string;
  label: string;
  onClick?: () => void;
}

export interface VaultHeaderModel {
  currentView: FolderView;
  hierarchyNodes: readonly VaultHierarchyNode[];
  onRootBack: () => void;
  onInnerBack: () => void;
}

export interface VaultStorageModel {
  visible: boolean;
  PRO_STORAGE_LIMIT: number;
  totalClubStorageUsed: number;
  purchasedStorageGb: number;
  isStorageLimitReached: boolean;
  currentTeamStorageUsed: number;
  storageBreakdown: VaultStorageBreakdownData | undefined;
  formatStorageSize: (bytes: number) => string;
  isClubAdmin: boolean;
  actions: {
    openLargeFiles: () => void;
    setStoragePurchaseDialogOpen: (open: boolean) => void;
  };
}

export interface VaultSelectionExportModel {
  photoCount: number;
  fileCount: number;
  subfolderCount: number;
  showTrash: boolean;
  selectionMode: boolean;
  selectedCount: number;
  isExporting: boolean;
  exportProgress: VaultExportProgress;
  isClubAdmin: boolean;
  isAppAdmin: boolean;
  actions: {
    setSelectionMode: (enabled: boolean) => void;
    selectAll: () => void;
    exitSelectionMode: () => void;
    initiateExport: (type: "zip" | "download" | "zipAll") => void;
    cancelExport: () => void;
    setBulkDeleteDialogOpen: (open: boolean) => void;
    setShowTrash: (show: boolean) => void;
  };
}

export interface VaultPrimaryActionModel {
  canUpload: boolean;
  isClubAdmin: boolean;
  currentView: FolderView;
  resolvingDriveTitles: boolean;
  actions: {
    setUploadDialogOpen: (open: boolean) => void;
    setNewFolderDialogOpen: (open: boolean) => void;
    setAddLinkDialogOpen: (open: boolean) => void;
    setGoogleDriveImportOpen: (open: boolean) => void;
    setLinkDriveFolderOpen: (open: boolean) => void;
    handleResolveDriveTitles: () => void;
  };
}

export interface VaultTopSectionProps {
  header: VaultHeaderModel;
  storage: VaultStorageModel;
  selectionExport: VaultSelectionExportModel;
  primaryActions: VaultPrimaryActionModel;
}

interface VaultMoreMenuItemsProps {
  selectionExport: VaultSelectionExportModel;
  primaryActions: VaultPrimaryActionModel;
  includeDriveActions: boolean;
}

function VaultMoreMenuItems({
  selectionExport,
  primaryActions,
  includeDriveActions,
}: VaultMoreMenuItemsProps) {
  const {
    photoCount,
    fileCount,
    subfolderCount,
    showTrash,
    isClubAdmin,
    isAppAdmin,
    actions: { setSelectionMode, initiateExport, setShowTrash },
  } = selectionExport;
  const {
    currentView,
    resolvingDriveTitles,
    actions: {
      setLinkDriveFolderOpen,
      handleResolveDriveTitles,
    },
  } = primaryActions;
  const canUseDrive =
    includeDriveActions && isClubAdmin && Capacitor.getPlatform() !== 'ios' && 'clubId' in currentView && DRIVE_IMPORT_ALLOWED_CLUB_IDS.has(currentView.clubId);

  return (
    <>
      {(photoCount > 0 || fileCount > 0) && !showTrash && (
        <DropdownMenuItem onClick={() => setSelectionMode(true)}>
          <CheckSquare className="h-4 w-4 mr-2" />
          Select
        </DropdownMenuItem>
      )}
      {(photoCount > 0 || fileCount > 0 || subfolderCount > 0) && (
        <>
          <DropdownMenuItem onClick={() => initiateExport('zip')}>
            <FileArchive className="h-4 w-4 mr-2" />
            Export as ZIP
          </DropdownMenuItem>
          {subfolderCount > 0 && (
            <DropdownMenuItem onClick={() => initiateExport('zipAll')}>
              <FolderDown className="h-4 w-4 mr-2" />
              ZIP All (with subfolders)
            </DropdownMenuItem>
          )}
        </>
      )}
      {(isClubAdmin || isAppAdmin) && (
        <DropdownMenuItem onClick={() => setShowTrash(!showTrash)}>
          {showTrash ? (
            <>
              <FolderOpen className="h-4 w-4 mr-2" />
              View Files
            </>
          ) : (
            <>
              <Trash2 className="h-4 w-4 mr-2" />
              View Trash
            </>
          )}
        </DropdownMenuItem>
      )}
      {includeDriveActions && canUseDrive && (
        <DropdownMenuItem onClick={() => setLinkDriveFolderOpen(true)}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Sync with Drive folder
        </DropdownMenuItem>
      )}
      {includeDriveActions && isClubAdmin && (
        <DropdownMenuItem
          onClick={handleResolveDriveTitles}
          disabled={resolvingDriveTitles}
        >
          {resolvingDriveTitles ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Sheet className="h-4 w-4 mr-2" />
          )}
          Fetch real Google titles
        </DropdownMenuItem>
      )}
    </>
  );
}

function VaultPageHeader({ model }: { model: VaultHeaderModel }) {
  const { currentView, hierarchyNodes: nodes, onRootBack, onInnerBack } = model;

  if (currentView.type === "root") {
    return (
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="shrink-0 h-10 w-10"
            onClick={onRootBack}
            aria-label="Go back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <div className="p-2 rounded-lg bg-primary/10">
              <FolderOpen className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-lg font-semibold">Vault</h1>
              <p className="text-xs text-muted-foreground">Club file storage</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const current = nodes[nodes.length - 1];
  const parents = nodes.slice(0, -1);

  return (
    <div className="flex items-center gap-1 min-w-0">
      <Button
        variant="ghost"
        size="icon"
        className="shrink-0 -ml-2 h-10 w-10"
        onClick={onInnerBack}
        aria-label="Go back"
      >
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div className="min-w-0 flex-1">
        <h1 className="text-lg font-semibold leading-tight truncate">
          {current?.label ?? "Vault"}
        </h1>
        {parents.length > 0 && (
          <div className="mt-0.5 flex flex-wrap items-center gap-x-1 text-xs text-muted-foreground">
            {parents.map((node, i) => (
              <span key={node.key} className="flex items-center gap-1 min-w-0">
                <button
                  type="button"
                  onClick={node.onClick}
                  className="px-1.5 py-0.5 -mx-1 rounded-md hover:bg-muted active:bg-muted/70 transition-colors max-w-[160px] truncate text-foreground/70 hover:text-foreground touch-manipulation"
                >
                  {node.label}
                </button>
                {i < parents.length - 1 && (
                  <ChevronRight className="h-3 w-3 shrink-0 opacity-60" />
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function VaultStoragePanel({
  model,
  selectionExport,
  primaryActions,
}: {
  model: VaultStorageModel;
  selectionExport: VaultSelectionExportModel;
  primaryActions: VaultPrimaryActionModel;
}) {
  const {
    visible,
    PRO_STORAGE_LIMIT,
    totalClubStorageUsed,
    purchasedStorageGb,
    isStorageLimitReached,
    currentTeamStorageUsed,
    storageBreakdown,
    formatStorageSize,
    isClubAdmin,
    actions: { openLargeFiles, setStoragePurchaseDialogOpen },
  } = model;
  const { selectionMode, isExporting } = selectionExport;
  const { canUpload, currentView } = primaryActions;

  if (!visible) return null;

  const storagePercentage = PRO_STORAGE_LIMIT > 0
    ? Math.min(100, Math.max(0, (totalClubStorageUsed / PRO_STORAGE_LIMIT) * 100))
    : 0;

  return (
    <Collapsible className="w-full">
      <div className="bg-card border rounded-lg p-3">
        <VaultStorageBarRow
          storagePercentage={storagePercentage}
          usageLabel={`${formatStorageSize(totalClubStorageUsed)} / ${5 + (purchasedStorageGb || 0)} GB`}
          isStorageLimitReached={isStorageLimitReached}
          actions={
            !canUpload && !selectionMode && !isExporting ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Storage actions">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-popover">
                  <VaultMoreMenuItems
                    selectionExport={selectionExport}
                    primaryActions={primaryActions}
                    includeDriveActions={false}
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null
          }
        />

        <CollapsibleContent className="mt-3 pt-3 border-t">
          <div className="space-y-3">
            {currentView.type === "team" && currentTeamStorageUsed > 0 && (
              <div className="pb-3 border-b">
                <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
                  <span className="font-medium text-foreground">This Team</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-base font-semibold text-foreground">
                    {formatStorageSize(currentTeamStorageUsed)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    ({Math.round((currentTeamStorageUsed / totalClubStorageUsed) * 100)}% of club storage)
                  </span>
                </div>
              </div>
            )}

            {storageBreakdown && (storageBreakdown.photos > 0 || storageBreakdown.documents > 0) && (
              <Suspense fallback={null}>
                <VaultStorageBreakdown
                  photos={storageBreakdown.photos}
                  documents={storageBreakdown.documents}
                  formatStorageSize={formatStorageSize}
                />
              </Suspense>
            )}

            <VaultStorageTeamProjection
              byTeam={storageBreakdown?.byTeam || []}
              totalStorage={totalClubStorageUsed}
              formatStorageSize={formatStorageSize}
            />

            {(isClubAdmin || (totalClubStorageUsed / PRO_STORAGE_LIMIT) >= 0.8) && (
              <div className="pt-3 border-t flex items-center gap-2">
                {(totalClubStorageUsed / PRO_STORAGE_LIMIT) >= 0.8 && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={openLargeFiles}
                        >
                          <HardDrive className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Manage Large Files</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}

                {isClubAdmin && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="icon"
                          className="h-8 w-8"
                          onClick={() => setStoragePurchaseDialogOpen(true)}
                        >
                          <ShoppingCart className="h-4 w-4" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>{purchasedStorageGb > 0 ? "Manage Storage" : "Buy Storage"}</TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}

function VaultActionToolbar({
  selectionExport,
  primaryActions,
}: {
  selectionExport: VaultSelectionExportModel;
  primaryActions: VaultPrimaryActionModel;
}) {
  const {
    photoCount,
    fileCount,
    showTrash,
    selectionMode,
    selectedCount,
    isExporting,
    exportProgress,
    isClubAdmin,
    isAppAdmin,
    actions: {
      selectAll,
      exitSelectionMode,
      initiateExport,
      cancelExport,
      setBulkDeleteDialogOpen,
    },
  } = selectionExport;
  const {
    canUpload,
    currentView,
    actions: {
      setUploadDialogOpen,
      setNewFolderDialogOpen,
      setAddLinkDialogOpen,
      setGoogleDriveImportOpen,
    },
  } = primaryActions;
  const canUseDrive =
    isClubAdmin && Capacitor.getPlatform() !== 'ios' && 'clubId' in currentView && DRIVE_IMPORT_ALLOWED_CLUB_IDS.has(currentView.clubId);

  return (
    <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
      <TooltipProvider>
        {(photoCount > 0 || fileCount > 0) && !showTrash && selectionMode && (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="outline" size="sm" onClick={selectAll}>
                  <CheckSquare className="h-4 w-4 mr-1" />
                  Select All
                </Button>
              </TooltipTrigger>
              <TooltipContent>Select all photos and files</TooltipContent>
            </Tooltip>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="sm" onClick={exitSelectionMode}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </TooltipTrigger>
              <TooltipContent>Exit selection mode</TooltipContent>
            </Tooltip>
            {selectedCount > 0 && (
              isExporting ? (
                <>
                  <Button variant="outline" size="sm" disabled className="min-w-[80px]">
                    <Loader2 className="h-4 w-4 animate-spin mr-1" />
                    <span className="text-xs">{exportProgress.current}/{exportProgress.total}</span>
                  </Button>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="destructive" size="sm" onClick={cancelExport}>
                        <X className="h-4 w-4" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Cancel export</TooltipContent>
                  </Tooltip>
                </>
              ) : (
                <>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="default" size="sm" onClick={() => initiateExport('zip')}>
                        <FileArchive className="h-4 w-4 mr-1" />
                        Export ({selectedCount})
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Export {selectedCount} selected items as ZIP</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button variant="outline" size="sm" onClick={() => initiateExport('download')}>
                        <Download className="h-4 w-4 mr-1" />
                        Download ({selectedCount})
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Download {selectedCount} selected items individually</TooltipContent>
                  </Tooltip>
                  {(isClubAdmin || isAppAdmin) && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => setBulkDeleteDialogOpen(true)}
                        >
                          <Trash2 className="h-4 w-4 mr-1" />
                          Delete ({selectedCount})
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Delete {selectedCount} selected items</TooltipContent>
                    </Tooltip>
                  )}
                </>
              )
            )}
          </>
        )}

        {!selectionMode && isExporting && (
          <>
            <Button variant="outline" size="sm" disabled className="min-w-[80px]">
              <Loader2 className="h-4 w-4 animate-spin mr-1" />
              <span className="text-xs">{exportProgress.current}/{exportProgress.total}</span>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="destructive" size="sm" onClick={cancelExport}>
                  <X className="h-4 w-4 mr-1" />
                  Cancel
                </Button>
              </TooltipTrigger>
              <TooltipContent>Cancel export</TooltipContent>
            </Tooltip>
          </>
        )}

        {!selectionMode && !isExporting && (
          <>
            {canUpload && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button size="sm" onClick={() => setUploadDialogOpen(true)}>
                    <Upload className="h-4 w-4 mr-1" /> Upload
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Upload photos or files</TooltipContent>
              </Tooltip>
            )}

            {canUpload && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Plus className="h-4 w-4 mr-1" /> Add
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-popover">
                  <DropdownMenuItem onClick={() => setNewFolderDialogOpen(true)}>
                    <FolderPlus className="h-4 w-4 mr-2" />
                    New Folder
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setAddLinkDialogOpen(true)}>
                    <Link2 className="h-4 w-4 mr-2" />
                    Add Link
                  </DropdownMenuItem>
                  {canUseDrive && (
                    <DropdownMenuItem onClick={() => setGoogleDriveImportOpen(true)}>
                      <CloudDownload className="h-4 w-4 mr-2" />
                      Import from Drive
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {canUpload && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-9 w-9">
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="bg-popover">
                  <VaultMoreMenuItems
                    selectionExport={selectionExport}
                    primaryActions={primaryActions}
                    includeDriveActions
                  />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
      </TooltipProvider>
    </div>
  );
}

export function VaultTopSection({
  header,
  storage,
  selectionExport,
  primaryActions,
}: VaultTopSectionProps) {
  if (header.currentView.type === "root") {
    return <VaultPageHeader model={header} />;
  }

  return (
    <div className="flex flex-col gap-3">
      <VaultPageHeader model={header} />
      <VaultStoragePanel
        model={storage}
        selectionExport={selectionExport}
        primaryActions={primaryActions}
      />
      <VaultActionToolbar
        selectionExport={selectionExport}
        primaryActions={primaryActions}
      />
    </div>
  );
}
