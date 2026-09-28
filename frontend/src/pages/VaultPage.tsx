import { useState, useMemo, useCallback, useRef, useEffect, Suspense } from "react";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import { getShareUrl } from "@/lib/shareUtils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams, useNavigate, useSearchParams, useLocation } from "react-router-dom";
import { FolderOpen, Lock, Crown, ChevronRight, ArrowLeft, Loader2, X, Search } from "lucide-react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const UploadFilesDialog = lazyWithRetry(() => import("@/components/vault/UploadFilesDialog").then(m => ({ default: m.UploadFilesDialog })));
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { format } from "date-fns";
import { getFolderColorClass } from "@/components/TeamFoldersManager";
import { useDebounce } from "@/hooks/useDebounce";
import { VaultLightbox } from "@/components/vault/VaultLightbox";
import { downloadImage } from "@/lib/downloadImage";
const StoragePurchaseDialog = lazyWithRetry(() => import("@/components/StoragePurchaseDialog").then(m => ({ default: m.StoragePurchaseDialog })));
import { useClubTheme } from "@/hooks/useClubTheme";
import { permanentlyDeleteVaultItems } from "@/lib/vaultDelete";
import { summarizeVaultDeletion, buildVaultDeleteMessage } from "@/features/vault/vaultDeleteReporting";
import { useVaultTrashWorkflow } from "@/features/vault/useVaultTrashWorkflow";
import { useVaultExport, type FolderView } from "@/features/vault/useVaultExport";
import { useVaultLargeFiles } from "@/features/vault/useVaultLargeFiles";
import { useVaultLightbox } from "@/features/vault/useVaultLightbox";
import { useVaultBulkDeleteWorkflow } from "@/features/vault/useVaultBulkDeleteWorkflow";
import { useVaultFolderManagement } from "@/features/vault/useVaultFolderManagement";
import { useVaultDriveLinkWorkflow } from "@/features/vault/useVaultDriveLinkWorkflow";
import { useVaultUploadWorkflow } from "@/features/vault/useVaultUploadWorkflow";
import { VaultExportDialogs } from "@/components/vault/VaultExportDialogs";
import { VaultBulkDeleteDialog } from "@/components/vault/VaultBulkDeleteDialog";
import { VaultLargeFilesDialog } from "@/components/vault/VaultLargeFilesDialog";
import { VaultFolderManagementDialogs } from "@/components/vault/VaultFolderManagementDialogs";
import { VaultDriveLinkDialogs } from "@/components/vault/VaultDriveLinkDialogs";
import { VaultTopSection, type VaultTopSectionProps } from "@/components/vault/VaultTopSection";
import { VaultMainContent } from "@/components/vault/VaultMainContent";
import {
  emptyVaultStorageBreakdown,
  fetchVaultStorageBreakdown,
  fetchVaultStorageSubscription,
} from "@/features/vault/vaultStorageRepository";

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
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
import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { VaultContentRenderer, type ContentSectionProps, type TrashSectionProps } from "@/components/vault/VaultContentRenderer";
import { invalidateVaultCache } from "@/features/vault/vaultQueryKeys";
import { useVaultAccessModel } from "@/features/vault/useVaultAccessModel";
import { useVaultContentDataModel } from "@/features/vault/useVaultContentDataModel";

export default function VaultPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Vault storage is unavailable in ICP lab mode" description="Protected file metadata, authorization, and encrypted object storage require an approved provider-neutral design." />;
  }
  return <SupabaseVaultPage />;
}

function SupabaseVaultPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { folderId: urlFolderId } = useParams<{ folderId?: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  // Capture once — subsequent setSearchParams({}, { replace: true }) calls
  // below wipe location.state, which would otherwise lose the fromChat flag
  // and break the header back button after opening from a chat's pinned vault.
  const [fromChat] = useState<boolean>(
    () => (location.state as { fromChat?: boolean } | null)?.fromChat === true,
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const { activeClubFilter } = useClubTheme();
  const [currentView, setCurrentView] = useState<FolderView>({ type: "root" });
  const [initialLoadComplete, setInitialLoadComplete] = useState(false);
  const [vaultSearchQuery, setVaultSearchQuery] = useState("");
  const debouncedVaultSearchQuery = useDebounce(vaultSearchQuery, 300);
  useEffect(() => { setVaultSearchQuery(""); }, [currentView]);

  const [deletePhotoId, setDeletePhotoId] = useState<string | null>(null);
  const [deleteFileId, setDeleteFileId] = useState<string | null>(null);
  const [restoreItemId, setRestoreItemId] = useState<string | null>(null);
  const [restoreItemType, setRestoreItemType] = useState<"photo" | "file">("photo");
  const [storagePurchaseDialogOpen, setStoragePurchaseDialogOpen] = useState(false);

  const {
    isAppAdmin,
    userRoles,
    userClubs,
    isLoadingClubs,
    isClubAdmin,
    isCoachOrTeamAdmin,
    adminUpgradeInfo,
    userTeamIds,
    currentClubHasPro,
    currentContextHasPro,
    hasProClub,
    canAccessVault,
    hasProButNoRole,
    isLoadingAccess,
  } = useVaultAccessModel({
    userId: user?.id,
    currentView,
    activeClubFilter,
    onAutoNavigateToClub: useCallback(
      (clubId: string, clubName: string) => setCurrentView({ type: "club", clubId, clubName }),
      [],
    ),
  });

  const { data: clubTeams } = useQuery({
    queryKey: ["vault-club-teams", currentView.type === "club" ? currentView.clubId : null, isClubAdmin, userTeamIds, currentClubHasPro],
    queryFn: async () => {
      if (currentView.type !== "club") return [];
      
      // First get all teams user can potentially access
      let teams: { id: string; name: string; folder_id: string | null }[] = [];
      
      if (isClubAdmin) {
        // Club admins and app admins can see all teams
        const { data } = await supabase
          .from("teams")
          .select("id, name, folder_id")
          .eq("club_id", currentView.clubId)
          .is("deleted_at", null)
          .order("name");
        teams = data || [];
      } else {
        // Non-club admins only see teams they are members of
        if (userTeamIds.length === 0) return [];
        
        const { data } = await supabase
          .from("teams")
          .select("id, name, folder_id")
          .eq("club_id", currentView.clubId)
          .in("id", userTeamIds)
          .is("deleted_at", null)
          .order("name");
        teams = data || [];
      }
      
      // If club has Pro, all teams inherit it - show all
      if (currentClubHasPro) return teams;
      
      // If club doesn't have Pro, only show teams with individual Pro subscriptions
      if (teams.length === 0) return [];
      
      const teamIds = teams.map(t => t.id);
      const { data: teamSubs } = await supabase
        .from("team_subscriptions")
        .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
        .in("team_id", teamIds);
      
      const proTeamIds = new Set(
        (teamSubs || [])
          .filter(sub => sub.is_pro || sub.is_pro_football || sub.admin_pro_override || sub.admin_pro_football_override)
          .map(sub => sub.team_id)
      );
      
      return teams.filter(t => proTeamIds.has(t.id));
    },
    enabled: currentView.type === "club" && currentClubHasPro !== undefined,
  });

  // Fetch team folders for the current club
  const { data: teamFolders } = useQuery({
    queryKey: ["vault-team-folders", currentView.type === "club" ? currentView.clubId : null],
    queryFn: async () => {
      if (currentView.type !== "club") return [];
      const { data } = await supabase
        .from("team_folders")
        .select("*")
        .eq("club_id", currentView.clubId)
        .order("sort_order", { ascending: true });
      return data || [];
    },
    enabled: currentView.type === "club",
  });

  // Fetch mini-leagues for the current club (Pro Football only)
  const { data: clubMiniLeagues } = useQuery({
    queryKey: ["vault-club-mini-leagues", currentView.type === "club" ? currentView.clubId : null, isClubAdmin, user?.id, userRoles?.length],
    queryFn: async () => {
      if (currentView.type !== "club") return [];
      
      const clubId = currentView.clubId;
      
      // First fetch the user's roles fresh to avoid stale closure issues
      const { data: freshRoles } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);
      
      console.log("[Vault Mini-Leagues] Fresh roles for user:", user!.id, freshRoles);
      
      // Check if club has Pro Football access
      const { data: clubSub } = await supabase
        .from("club_subscriptions")
        .select("is_pro_football, admin_pro_football_override")
        .eq("club_id", clubId)
        .maybeSingle();
      
      const hasProFootball = clubSub?.is_pro_football || clubSub?.admin_pro_football_override;
      if (!hasProFootball && !isAppAdmin) {
        console.log("[Vault Mini-Leagues] Club doesn't have Pro Football, returning empty");
        return [];
      }
      
      // Check roles from freshly fetched data
      const isClubAdminRole = freshRoles?.some(r => r.role === "club_admin" && r.club_id === clubId);
      const isLeagueAdmin = freshRoles?.some(r => r.role === "league_admin" && r.club_id === clubId);
      const isCoach = freshRoles?.some(r => r.role === "coach" && r.club_id === clubId);
      const isCommitteeMember = freshRoles?.some(r => r.role === "committee_member" && r.club_id === clubId);
      
      console.log("[Vault Mini-Leagues Debug]", {
        clubId,
        freshRoles,
        isAppAdmin,
        isClubAdminRole,
        isLeagueAdmin,
        isCoach,
        isCommitteeMember,
        hasAccess: isAppAdmin || isClubAdminRole || isLeagueAdmin || isCoach || isCommitteeMember
      });
      
      if (isAppAdmin || isClubAdminRole || isLeagueAdmin || isCoach || isCommitteeMember) {
        // Admins, committee members, coaches and league admins can see all mini-leagues
        const { data } = await supabase
          .from("mini_leagues")
          .select("id, name")
          .eq("club_id", clubId)
          .order("name");
        console.log("[Vault Mini-Leagues] Fetched leagues:", data);
        return data || [];
      } else {
        // Parents can only see leagues their children are in
        console.log("[Vault Mini-Leagues] User doesn't have admin access, checking for children");
        const { data: playerLeagues } = await supabase
          .from("mini_league_players")
          .select("mini_league_id, mini_leagues!inner(id, name, club_id)")
          .eq("parent_user_id", user!.id);
        
        if (playerLeagues) {
          const filtered = playerLeagues
            .filter((pl: any) => pl.mini_leagues?.club_id === clubId)
            .map((pl: any) => ({ id: pl.mini_leagues.id, name: pl.mini_leagues.name }));
          console.log("[Vault Mini-Leagues] Leagues via children:", filtered);
          return filtered;
        }
        return [];
      }
    },
    enabled: currentView.type === "club" && !!user,
  });

  const getCurrentFolderId = () => {
    if (currentView.type === "club" || currentView.type === "team" || currentView.type === "mini-league") {
      return currentView.folderId || null;
    }
    return null;
  };

  const getCurrentClubId = () => {
    if (currentView.type === "club") return currentView.clubId;
    if (currentView.type === "team") return currentView.clubId;
    if (currentView.type === "mini-league") return currentView.clubId;
    return null;
  };

  const getCurrentTeamId = () => {
    if (currentView.type === "team") return currentView.teamId;
    return null;
  };

  const getCurrentMiniLeagueId = () => {
    if (currentView.type === "mini-league") return currentView.miniLeagueId;
    return null;
  };

  const {
    folderPath,
    setFolderPath,
    newFolderDialogOpen,
    setNewFolderDialogOpen,
    deleteFolderId,
    requestDeleteFolder,
    cancelDeleteFolder,
    confirmDeleteFolder,
    renameFolderId,
    renameFolderName,
    setRenameFolderName,
    startRenameFolder,
    cancelRenameFolder,
    confirmRenameFolder,
    renameFileId,
    renameFileName,
    setRenameFileName,
    startRenameFile,
    cancelRenameFile,
    confirmRenameFile,
    renamePhotoId,
    renamePhotoName,
    setRenamePhotoName,
    startRenamePhoto,
    cancelRenamePhoto,
    confirmRenamePhoto,
    moveFileDialogOpen,
    setMoveFileDialogOpen,
    fileToMove,
    startMoveFile,
    confirmMoveFile,
    createFolderMutation,
    deleteFolderMutation,
    renameFolderMutation,
    renameFileMutation,
    renamePhotoMutation,
    moveFileMutation,
    navigateToFolder,
    goBack,
    navigateToRoot,
    navigateToClub,
    navigateToMiniLeague,
    navigateToTeam,
    navigateToFolderAtIndex,
    getHierarchyNodes,
  } = useVaultFolderManagement({
    currentView,
    setCurrentView,
    fromChat,
    navigate,
    getCurrentFolderId,
    userId: user?.id,
    queryClient,
  });

  const [showTrash, setShowTrash] = useState(false);

  const {
    subfolders,
    photos,
    files,
    normalizedSearch,
    isFetchingRecursive,
    displaySubfolders,
    displayPhotos,
    displayFiles,
  } = useVaultContentDataModel({
    currentView,
    showTrash,
    vaultSearchQuery,
    debouncedVaultSearchQuery,
    isClubAdmin,
    isCoachOrTeamAdmin,
    isAppAdmin,
    userRoles,
  });

  const {
    selectionMode,
    setSelectionMode,
    selectedPhotos,
    selectedFiles,
    bulkDeleteDialogOpen,
    setBulkDeleteDialogOpen,
    isDeletingSelected,
    selectedCount,
    togglePhotoSelection,
    toggleFileSelection,
    exitSelectionMode,
    selectAll,
    deleteSelectedItems,
  } = useVaultBulkDeleteWorkflow({
    photos,
    files,
    userId: user?.id,
    queryClient,
  });

  // Handle storage purchase success redirect
  useEffect(() => {
    if (searchParams.get("success") === "storage") {
      toast.success("Storage add-on purchased successfully! Your storage limit has been increased.");
      searchParams.delete("success");
      setSearchParams(searchParams, { replace: true });
      queryClient.invalidateQueries({ queryKey: ["club-purchased-storage"] });
      invalidateVaultCache(queryClient, ["clubs"]);
    }
  }, [searchParams, setSearchParams, queryClient]);

  // Load folder from URL parameter
  useEffect(() => {
    const loadFolderFromUrl = async () => {
      if (!urlFolderId || initialLoadComplete || !userClubs) return;
      
      try {
        // Fetch the folder to get its details
        const { data: folder, error } = await supabase
          .from("vault_folders")
          .select("*, teams!vault_folders_team_id_fkey(id, name, club_id), clubs!club_id(id, name)")
          .eq("id", urlFolderId)
          .maybeSingle();
        
        if (error || !folder) {
          toast.error("Folder not found or access denied");
          navigate("/vault", { replace: true });
          setInitialLoadComplete(true);
          return;
        }

        // Build folder path by traversing parent folders
        const path: { id: string; name: string }[] = [];
        let currentFolderId = folder.parent_id;
        
        while (currentFolderId) {
          const { data: parentFolder } = await supabase
            .from("vault_folders")
            .select("id, name, parent_id")
            .eq("id", currentFolderId)
            .maybeSingle();
          
          if (parentFolder) {
            path.unshift({ id: parentFolder.id, name: parentFolder.name });
            currentFolderId = parentFolder.parent_id;
          } else {
            break;
          }
        }
        
        // Add the target folder to path
        path.push({ id: folder.id, name: folder.name });
        setFolderPath(path);

        // Set the view based on folder type
        if (folder.team_id && folder.teams) {
          const clubId = folder.teams.club_id;
          const { data: club } = await supabase
            .from("clubs")
            .select("name")
            .eq("id", clubId)
            .maybeSingle();
          
          setCurrentView({
            type: "team",
            clubId: clubId,
            clubName: club?.name || "Unknown Club",
            teamId: folder.team_id,
            teamName: folder.teams.name,
            folderId: folder.id,
            folderName: folder.name,
          });
        } else if (folder.club_id && folder.clubs) {
          setCurrentView({
            type: "club",
            clubId: folder.club_id,
            clubName: folder.clubs.name,
            folderId: folder.id,
            folderName: folder.name,
          });
        }
        
        setInitialLoadComplete(true);
      } catch (error) {
        console.error("Error loading folder:", error);
        toast.error("Failed to load folder");
        navigate("/vault", { replace: true });
        setInitialLoadComplete(true);
      }
    };

    loadFolderFromUrl();
  }, [urlFolderId, userClubs, initialLoadComplete, navigate]);

  // Handle direct navigation via query parameters (?club=X or ?team=X)
  useEffect(() => {
    const loadFromQueryParams = async () => {
      if (urlFolderId || initialLoadComplete || !userClubs || userClubs.length === 0) return;

      const clubId = searchParams.get("club");
      const teamId = searchParams.get("team");
      const miniLeagueId = searchParams.get("miniLeague");

      if (!clubId && !teamId && !miniLeagueId) {
        setInitialLoadComplete(true);
        return;
      }

      try {
        if (miniLeagueId) {
          // Navigate directly to mini-league vault folder
          const { data: league } = await supabase
            .from("mini_leagues")
            .select("id, name, club_id")
            .eq("id", miniLeagueId)
            .maybeSingle();

          if (league) {
            const club = userClubs.find(c => c.id === league.club_id);
            if (club) {
              setCurrentView({
                type: "mini-league",
                clubId: league.club_id,
                clubName: club.name,
                miniLeagueId: league.id,
                miniLeagueName: league.name,
              });
              setSearchParams({}, { replace: true });
            }
          }
        } else if (teamId) {
          // Navigate directly to team vault
          const { data: team } = await supabase
            .from("teams")
            .select("id, name, club_id")
            .eq("id", teamId)
            .maybeSingle();

          if (team) {
            const club = userClubs.find(c => c.id === team.club_id);
            if (club) {
              setCurrentView({
                type: "team",
                clubId: team.club_id,
                clubName: club.name,
                teamId: team.id,
                teamName: team.name,
              });
              // Clear query params without losing history
              setSearchParams({}, { replace: true });
            }
          }
        } else if (clubId) {
          // Navigate directly to club vault
          const club = userClubs.find(c => c.id === clubId);
          if (club) {
            setCurrentView({
              type: "club",
              clubId: club.id,
              clubName: club.name,
            });
            // Clear query params without losing history
            setSearchParams({}, { replace: true });
          }
        }
      } catch (error) {
        console.error("Error loading from query params:", error);
      }

      setInitialLoadComplete(true);
    };

    loadFromQueryParams();
  }, [urlFolderId, userClubs, initialLoadComplete, searchParams, setSearchParams]);

  const shareFolder = async (folderId: string) => {
    const shareUrl = getShareUrl("folder", folderId);
    
    try {
      if (Capacitor.isNativePlatform()) {
        try {
          await Share.share({
            url: shareUrl,
            dialogTitle: "Share Folder",
          });
        } catch (error) {
          if ((error as Error).name !== "AbortError") {
            await navigator.clipboard.writeText(shareUrl);
            toast.success("Link copied to clipboard!");
          }
        }
        return;
      }

      if (navigator.share) {
        await navigator.share({
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copied to clipboard!");
      }
    } catch (error) {
      if ((error as Error).name !== "AbortError") {
        await navigator.clipboard.writeText(shareUrl);
        toast.success("Link copied to clipboard!");
      }
    }
  };

  const currentClub = useMemo(() => {
    if (currentView.type === "club") return userClubs?.find(c => c.id === currentView.clubId);
    if (currentView.type === "team") return userClubs?.find(c => c.id === currentView.clubId);
    return null;
  }, [currentView, userClubs]);

  // 5GB base storage limit for Pro tier (in bytes)
  const BASE_STORAGE_LIMIT = 5 * 1024 * 1024 * 1024;

  // Query for purchased storage and scheduled downgrade info for current club
  const { data: storageSubscriptionData } = useQuery({
    queryKey: ["purchased-storage", currentClub?.id],
    queryFn: () => currentClub?.id
      ? fetchVaultStorageSubscription(currentClub.id)
      : Promise.resolve({
        storage_purchased_gb: 0,
        scheduled_storage_downgrade_gb: null,
        storage_downgrade_at: null,
      }),
    enabled: !!currentClub?.id,
  });

  const purchasedStorageGb = storageSubscriptionData?.storage_purchased_gb || 0;
  const scheduledDowngradeGb = storageSubscriptionData?.scheduled_storage_downgrade_gb;
  const storageDowngradeAt = storageSubscriptionData?.storage_downgrade_at;

  // Total storage limit = base + purchased
  const PRO_STORAGE_LIMIT = BASE_STORAGE_LIMIT + ((purchasedStorageGb || 0) * 1024 * 1024 * 1024);

  // Query for storage breakdown by file type, team, and mini-league
  const { data: storageBreakdown } = useQuery({
    queryKey: ["storage-breakdown", currentClub?.id],
    queryFn: () => currentClub?.id
      ? fetchVaultStorageBreakdown(currentClub.id)
      : Promise.resolve(emptyVaultStorageBreakdown()),
    enabled: !!currentClub?.id,
  });

  // Get total club storage used (for Pro tier limit)
  const totalClubStorageUsed = useMemo(() => {
    return storageBreakdown?.total || 0;
  }, [storageBreakdown]);

  // Get current team's storage used (for display)
  const currentTeamStorageUsed = useMemo(() => {
    if (currentView.type === "team" && storageBreakdown?.byTeam) {
      const teamData = storageBreakdown.byTeam.find(t => t.teamId === currentView.teamId);
      return teamData?.size || 0;
    }
    if (currentView.type === "club" && storageBreakdown?.byTeam) {
      const clubLevelData = storageBreakdown.byTeam.find(t => t.teamId === null);
      return clubLevelData?.size || 0;
    }
    return 0;
  }, [currentView, storageBreakdown]);

  // Pro tier has 5GB limit + purchased storage
  const isStorageLimitReached = useMemo(() => {
    if (isAppAdmin) return false;
    if (!hasProClub) return true; // Free tier can't access vault
    // Pro tier has 5GB base limit + purchased storage (total club storage)
    return totalClubStorageUsed >= PRO_STORAGE_LIMIT;
  }, [isAppAdmin, hasProClub, totalClubStorageUsed]);

  // Track which warnings have been shown this session
  const shownWarningsRef = useRef<Set<string>>(new Set());

  // Show warning when club storage reaches 80% of Pro limit
  useEffect(() => {
    if (!storageBreakdown || !currentClub || isAppAdmin || !hasProClub) return;

    const WARNING_THRESHOLD = 0.8; // 80%
    const percentage = totalClubStorageUsed / PRO_STORAGE_LIMIT;
    const warningKey = `${currentClub.id}-pro-limit`;
    
    if (percentage >= WARNING_THRESHOLD && !shownWarningsRef.current.has(warningKey)) {
      shownWarningsRef.current.add(warningKey);
      
      if (percentage >= 1) {
        toast.error(`Storage limit reached`, {
          description: "Delete files or purchase more storage"
        });
      } else {
        toast.warning(`Club storage at ${Math.round(percentage * 100)}% capacity`, {
          description: `${formatStorageSize(PRO_STORAGE_LIMIT - totalClubStorageUsed)} remaining`
        });
      }
    }
  }, [storageBreakdown, currentClub, isAppAdmin, hasProClub, totalClubStorageUsed]);

  const formatStorageSize = (bytes: number) => {
    if (bytes >= 1024 * 1024 * 1024) {
      return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
    } else if (bytes >= 1024 * 1024) {
      return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    } else if (bytes >= 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${bytes} B`;
  };

  const downloadPhotoFile = async (url: string, filename?: string) => {
    const friendlyName = (filename || "ignite-photo").replace(/\.[^.]+$/, "") || "ignite-photo";
    await downloadImage(url, friendlyName);
  };

  const {
    isExporting,
    exportProgress,
    exportPreviewOpen,
    setExportPreviewOpen,
    exportPreviewData,
    excludedFolders,
    exportConfirmOpen,
    setExportConfirmOpen,
    pendingExportAction,
    setPendingExportAction,
    folderExportDialogOpen,
    setFolderExportDialogOpen,
    folderExportData,
    setFolderExportData,
    filteredExportData,
    exportSummary,
    cancelExport,
    initiateExport,
    handleExportConfirm,
    openExportPreview,
    openFolderExportDialog,
    toggleFolderExclusion,
    confirmExportWithSubfolders,
    toggleFolderExportPhotoSelection,
    toggleFolderExportFileSelection,
    selectAllFolderExportItems,
    deselectAllFolderExportItems,
    exportSelectedFolderItems,
  } = useVaultExport({
    currentView,
    photos,
    files,
    selectionMode,
    selectedPhotos,
    selectedFiles,
    exitSelectionMode,
    downloadPhotoFile,
  });

  const {
    largeFilesDialogOpen,
    largeFilesData,
    selectedLargeFiles,
    deletingLargeFiles,
    largeFilesSortBy,
    setLargeFilesSortBy,
    sortedLargeFiles,
    selectedBytes,
    openLargeFiles,
    handleLargeFilesDialogChange,
    toggleLargeFileSelection,
    deleteSelectedLargeFiles,
  } = useVaultLargeFiles({ currentClubId: currentClub?.id, queryClient, formatStorageSize });

  const canUpload = useMemo(() => {
    if (isStorageLimitReached) return false;
    if (!currentClub) return false;
    if (isAppAdmin) return true;

    // Role-based write access for the current context. Pro is NOT required here —
    // free clubs still get to upload from device (subject to free-tier quotas).
    // Pro-only Add features (New Folder / Add Link / Drive imports) gate on
    // `canManageVaultPro` below.
    const clubId = getCurrentClubId();
    const teamId = getCurrentTeamId();

    // Club admins and committee members can upload to any club, team, or mini-league vault within their club
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;

    // Team admins can only upload to their own team vault
    if (currentView.type === "team") {
      return userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId);
    }

    // Mini-league: league admins and coaches can upload
    if (currentView.type === "mini-league") {
      return userRoles?.some(r =>
        (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId
      );
    }

    // For club-level view, only club admins and committee members can upload (handled above)
    return false;
  }, [isAppAdmin, currentClub, isStorageLimitReached, currentView, userRoles]);

  // Pro-gated vault management (folders, link entries, Drive imports/sync).
  // Free users may upload from device but cannot create folders/links or pull from Drive.
  const canManageVaultPro = canUpload && currentContextHasPro;

  const canDeletePhoto = useCallback((photo: any) => {
    if (isAppAdmin) return true;
    if (photo.uploader_id === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can delete
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canDeleteFile = useCallback((file: any) => {
    if (isAppAdmin) return true;
    // vault_files uses uploaded_by, not uploader_id
    if ((file.uploaded_by || file.uploader_id) === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can delete
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canRenameFile = useCallback((file: any) => {
    if (isAppAdmin) return true;
    // vault_files uses uploaded_by, not uploader_id
    if ((file.uploaded_by || file.uploader_id) === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can rename
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canRenamePhoto = useCallback((photo: any) => {
    if (isAppAdmin) return true;
    if (photo.uploader_id === user?.id) return true;
    const clubId = currentView.type === "club" ? currentView.clubId : currentView.type === "team" ? currentView.clubId : currentView.type === "mini-league" ? currentView.clubId : null;
    const teamId = currentView.type === "team" ? currentView.teamId : null;
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    // Mini-league: league admins and coaches can rename
    if (currentView.type === "mini-league" && userRoles?.some(r => (r.role === "league_admin" || r.role === "coach") && r.club_id === clubId)) return true;
    return false;
  }, [isAppAdmin, user?.id, currentView, userRoles]);

  const canDeleteFolder = useCallback((folder: any) => {
    if (isAppAdmin) return true;
    if (folder.created_by === user?.id) return true;
    const clubId = getCurrentClubId();
    const teamId = getCurrentTeamId();
    if (userRoles?.some(r => (r.role === "club_admin" || r.role === "committee_member") && r.club_id === clubId)) return true;
    if (teamId && userRoles?.some(r => r.role === "team_admin" && r.team_id === teamId)) return true;
    return false;
  }, [isAppAdmin, user?.id, getCurrentClubId, getCurrentTeamId, userRoles]);


  const {
    state: lightboxState,
    openLightbox,
    closeLightbox,
    navigate: navigateLightbox,
    handleLightboxDelete,
  } = useVaultLightbox({
    photos,
    canDeletePhoto,
    onDeletePhotoRequested: setDeletePhotoId,
  });

  const {
    uploadDialogOpen,
    setUploadDialogOpen,
    uploading,
    handleDialogUpload,
  } = useVaultUploadWorkflow({
    currentView,
    getCurrentFolderId,
    userId: user?.id,
    queryClient,
  });

  const {
    addLinkDialogOpen,
    setAddLinkDialogOpen,
    googleDriveImportOpen,
    setGoogleDriveImportOpen,
    linkDriveFolderOpen,
    setLinkDriveFolderOpen,
    resolvingDriveTitles,
    handleResolveDriveTitles,
    addLinkMutation,
    handleDriveChanged,
  } = useVaultDriveLinkWorkflow({
    currentView,
    getCurrentFolderId,
    userId: user?.id,
    queryClient,
    invokeFunction: (name, options) => supabase.functions.invoke(name, options),
  });

  const {
    trashItems,
    isLoadingTrash,
    isEmptyingTrash,
    deletePhotoMutation,
    deleteFileMutation,
    restorePhotoMutation,
    restoreFileMutation,
    permanentDeletePhotoMutation,
    permanentDeleteFileMutation,
    emptyTrash,
  } = useVaultTrashWorkflow({
    currentView,
    showTrash,
    userId: user?.id,
    isClubAdmin,
    isCoachOrTeamAdmin,
    onPhotoSoftDeleteStart: () => {
      setDeletePhotoId(null);
      closeLightbox();
    },
    onFileSoftDeleteSuccess: () => setDeleteFileId(null),
  });

  if (isLoadingAccess) {
    return (
      <div className="py-6 flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!canAccessVault) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="sm" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
        </div>
        <Card className="border-primary/20 bg-primary/5 max-w-lg mx-auto">
          <CardContent className="p-8 text-center">
            <div className="p-4 rounded-full bg-primary/10 w-fit mx-auto mb-4">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            {hasProButNoRole ? (
              <>
                <h3 className="font-semibold text-lg mb-2">Permission Required</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  The File Vault is only accessible to club admins, team admins, coaches, and committee members.
                </p>
              </>
            ) : (
              <>
                <h3 className="font-semibold text-lg mb-2">Vault is a Pro Feature</h3>
                <p className="text-muted-foreground text-sm mb-4">
                  Upgrade to Pro to unlock file storage.
                </p>
                <Badge variant="secondary" className="mb-4 bg-primary/20 text-primary">
                  <Crown className="h-3 w-3 mr-1" /> Pro Only
                </Badge>
                {(adminUpgradeInfo.clubId || adminUpgradeInfo.teamId) && (
                  <div className="mt-4">
                    <Link to={adminUpgradeInfo.teamId ? `/teams/${adminUpgradeInfo.teamId}/upgrade` : `/clubs/${adminUpgradeInfo.clubId}/upgrade`}>
                      <Button size="sm">
                        <Crown className="h-4 w-4 mr-2" />
                        Upgrade to Pro
                      </Button>
                    </Link>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const contentRendererProps: ContentSectionProps = {
    searchQuery: normalizedSearch,
    photos: displayPhotos || [],
    files: displayFiles || [],
    onPhotoClick: openLightbox,
    canDeletePhoto,
    canDeleteFile,
    canRenamePhoto,
    canRenameFile,
    canMoveFile: canRenameFile,
    onDeletePhoto: setDeletePhotoId,
    onDeleteFile: setDeleteFileId,
    onRenamePhoto: startRenamePhoto,
    onRenameFile: startRenameFile,
    onMoveFile: startMoveFile,
    onDownloadPhoto: downloadPhotoFile,
    selectionMode,
    selectedPhotos,
    selectedFiles,
    onTogglePhotoSelection: togglePhotoSelection,
    onToggleFileSelection: toggleFileSelection,
  };

  const miniLeagueContentRendererProps: ContentSectionProps = {
    ...contentRendererProps,
    files: [],
    canDeleteFile: () => false,
    canRenameFile: () => false,
    onDeleteFile: () => undefined,
    onRenameFile: () => undefined,
    onMoveFile: undefined,
  };

  const trashRendererProps: TrashSectionProps = {
    photos: trashItems?.photos || [],
    files: trashItems?.files || [],
    isLoading: isLoadingTrash,
    onRestorePhoto: (id) => { setRestoreItemType("photo"); setRestoreItemId(id); },
    onRestoreFile: (id) => { setRestoreItemType("file"); setRestoreItemId(id); },
    onPermanentDeletePhoto: isClubAdmin ? setDeletePhotoId : undefined,
    onPermanentDeleteFile: isClubAdmin ? setDeleteFileId : undefined,
    onEmptyTrash: isClubAdmin ? emptyTrash : undefined,
    isEmptyingTrash,
  };

  const contentRendererView = showTrash
    ? { mode: "trash" as const, trash: trashRendererProps }
    : { mode: "content" as const, content: contentRendererProps };

  const topSectionProps: VaultTopSectionProps = {
    header: {
      currentView,
      hierarchyNodes: currentView.type === "root" ? [] : getHierarchyNodes(),
      onRootBack: () => navigate(-1),
      onInnerBack: goBack,
    },
    storage: {
      visible: !!currentClub,
      PRO_STORAGE_LIMIT,
      totalClubStorageUsed,
      purchasedStorageGb,
      isStorageLimitReached,
      currentTeamStorageUsed,
      storageBreakdown,
      formatStorageSize,
      isClubAdmin,
      actions: {
        openLargeFiles,
        setStoragePurchaseDialogOpen,
      },
    },
    selectionExport: {
      photoCount: photos?.length || 0,
      fileCount: files?.length || 0,
      subfolderCount: subfolders?.length || 0,
      showTrash,
      selectionMode,
      selectedCount,
      isExporting,
      exportProgress,
      isClubAdmin,
      isAppAdmin: !!isAppAdmin,
      actions: {
        setSelectionMode,
        selectAll,
        exitSelectionMode,
        initiateExport,
        cancelExport,
        setBulkDeleteDialogOpen,
        setShowTrash,
      },
    },
    primaryActions: {
      canUpload,
      isClubAdmin,
      currentView,
      resolvingDriveTitles,
      actions: {
        setUploadDialogOpen,
        setNewFolderDialogOpen,
        setAddLinkDialogOpen,
        setGoogleDriveImportOpen,
        setLinkDriveFolderOpen,
        handleResolveDriveTitles,
      },
    },
  };

  const mainContentProps = {
    currentView,
    showTrash,
    search: {
      query: vaultSearchQuery,
      isFetchingRecursive,
      folderMatchCount: displaySubfolders.length,
      photoMatchCount: displayPhotos.length,
      fileMatchCount: displayFiles.length,
      onQueryChange: setVaultSearchQuery,
    },
    rootPicker: {
      isLoadingClubs,
      clubs: userClubs,
      activeClubFilter,
      onSelectClub: (club: { id: string; name: string; is_pro?: boolean | null }) => {
        if (!club.is_pro) {
          navigate(`/clubs/${club.id}/upgrade`);
          return;
        }
        setFolderPath([]);
        setCurrentView({ type: "club", clubId: club.id, clubName: club.name });
      },
    },
    clubNavigation: {
      teams: clubTeams,
      teamFolders,
      miniLeagues: clubMiniLeagues,
      onSelectTeam: (team: { id: string; name: string }) => {
        if (currentView.type !== "club") return;
        setFolderPath([]);
        setCurrentView({
          type: "team",
          clubId: currentView.clubId,
          clubName: currentView.clubName,
          teamId: team.id,
          teamName: team.name,
        });
      },
      onSelectMiniLeague: (league: { id: string; name: string }) => {
        if (currentView.type !== "club") return;
        setFolderPath([]);
        setCurrentView({
          type: "mini-league",
          clubId: currentView.clubId,
          clubName: currentView.clubName,
          miniLeagueId: league.id,
          miniLeagueName: league.name,
        });
      },
    },
    content: {
      folders: displaySubfolders,
      searchQuery: normalizedSearch,
      contentRendererView,
      miniLeagueContent: miniLeagueContentRendererProps,
      actions: {
        onNavigateToFolder: navigateToFolder,
        onShareFolder: (folder: { id: string }) => shareFolder(folder.id),
        onExportFolder: openFolderExportDialog,
        onRenameFolder: startRenameFolder,
        onDeleteFolder: requestDeleteFolder,
        canEditFolder: canDeleteFolder,
      },
    },
  };

  return (
    <div className={currentView.type === "root" ? "py-6 space-y-6" : "pt-3 pb-6 space-y-4"}>
      <VaultTopSection {...topSectionProps} />

      {currentView.type !== "root" && (
        <>
          <Suspense fallback={null}>
            <UploadFilesDialog
              open={uploadDialogOpen}
              onOpenChange={setUploadDialogOpen}
              onUpload={handleDialogUpload}
              isUploading={uploading}
              targetName={currentView.folderName || (currentView.type === "team" ? currentView.teamName : currentView.type === "club" ? currentView.clubName : "Vault")}
            />
          </Suspense>

          <VaultDriveLinkDialogs
            currentView={currentView}
            addLinkDialogOpen={addLinkDialogOpen}
            onAddLinkDialogOpenChange={setAddLinkDialogOpen}
            addLinkMutation={addLinkMutation}
            googleDriveImportOpen={googleDriveImportOpen}
            onGoogleDriveImportOpenChange={setGoogleDriveImportOpen}
            linkDriveFolderOpen={linkDriveFolderOpen}
            onLinkDriveFolderOpenChange={setLinkDriveFolderOpen}
            onDriveChanged={handleDriveChanged}
          />
        </>
      )}

      <VaultMainContent {...mainContentProps} />

      {/* Photo Lightbox */}
      <VaultLightbox
        photos={photos}
        state={lightboxState}
        onClose={closeLightbox}
        onNavigate={navigateLightbox}
        onDelete={handleLightboxDelete}
      />

      {/* Delete Photo Confirmation */}
      <AlertDialog open={!!deletePhotoId} onOpenChange={() => setDeletePhotoId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{showTrash ? "Permanently Delete Photo" : "Delete Photo"}</AlertDialogTitle>
            <AlertDialogDescription>
              {showTrash 
                ? "Are you sure you want to permanently delete this photo? This cannot be undone."
                : "This photo will be moved to trash."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletePhotoId && (showTrash ? permanentDeletePhotoMutation.mutate(deletePhotoId) : deletePhotoMutation.mutate(deletePhotoId))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {showTrash ? "Delete Permanently" : "Move to Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete File Confirmation */}
      <AlertDialog open={!!deleteFileId} onOpenChange={() => setDeleteFileId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{showTrash ? "Permanently Delete File" : "Delete File"}</AlertDialogTitle>
            <AlertDialogDescription>
              {showTrash 
                ? "Are you sure you want to permanently delete this file? This cannot be undone."
                : "This file will be moved to trash."
              }
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteFileId && (showTrash ? permanentDeleteFileMutation.mutate(deleteFileId) : deleteFileMutation.mutate(deleteFileId))}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {showTrash ? "Delete Permanently" : "Move to Trash"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restore Confirmation */}
      <AlertDialog open={!!restoreItemId} onOpenChange={() => setRestoreItemId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Restore {restoreItemType === "photo" ? "Photo" : "File"}</AlertDialogTitle>
            <AlertDialogDescription>
              This {restoreItemType === "photo" ? "photo" : "file"} will be restored to its original location.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (restoreItemId) {
                  if (restoreItemType === "photo") {
                    restorePhotoMutation.mutate(restoreItemId);
                  } else {
                    restoreFileMutation.mutate(restoreItemId);
                  }
                  setRestoreItemId(null);
                }
              }}
            >
              Restore
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <VaultBulkDeleteDialog
        open={bulkDeleteDialogOpen}
        onOpenChange={setBulkDeleteDialogOpen}
        selectedCount={selectedCount}
        isDeleting={isDeletingSelected}
        onConfirm={deleteSelectedItems}
      />
      <VaultLargeFilesDialog
        open={largeFilesDialogOpen}
        onOpenChange={handleLargeFilesDialogChange}
        loading={largeFilesData.loading}
        items={largeFilesData.items}
        sortedItems={sortedLargeFiles}
        selectedIds={selectedLargeFiles}
        selectedBytes={selectedBytes}
        deleting={deletingLargeFiles}
        sortBy={largeFilesSortBy}
        onSortChange={setLargeFilesSortBy}
        onToggle={toggleLargeFileSelection}
        onDelete={deleteSelectedLargeFiles}
        formatStorageSize={formatStorageSize}
      />

      <VaultExportDialogs
        previewOpen={exportPreviewOpen}
        onPreviewOpenChange={setExportPreviewOpen}
        previewData={exportPreviewData}
        excludedFolders={excludedFolders}
        filteredData={filteredExportData}
        onToggleFolderExclusion={toggleFolderExclusion}
        onConfirmWithSubfolders={confirmExportWithSubfolders}
        confirmOpen={exportConfirmOpen}
        onConfirmOpenChange={setExportConfirmOpen}
        pendingAction={pendingExportAction}
        summary={exportSummary}
        onClearPendingAction={() => setPendingExportAction(null)}
        onConfirm={handleExportConfirm}
        folderOpen={folderExportDialogOpen}
        onFolderOpenChange={(open) => {
          setFolderExportDialogOpen(open);
          if (!open) setFolderExportData(null);
        }}
        folderData={folderExportData}
        onTogglePhoto={toggleFolderExportPhotoSelection}
        onToggleFile={toggleFolderExportFileSelection}
        onSelectAll={selectAllFolderExportItems}
        onDeselectAll={deselectAllFolderExportItems}
        onExportSelected={exportSelectedFolderItems}
      />

      {/* Storage Purchase Dialog */}
      {currentClub && (
        <Suspense fallback={null}>
        <StoragePurchaseDialog
          open={storagePurchaseDialogOpen}
          onOpenChange={setStoragePurchaseDialogOpen}
          clubId={currentClub.id}
          clubName={currentClub.name}
          currentStorageLimit={PRO_STORAGE_LIMIT}
          purchasedStorageGb={purchasedStorageGb}
          scheduledDowngradeGb={scheduledDowngradeGb}
          storageDowngradeAt={storageDowngradeAt}
        />
        </Suspense>
      )}

      <VaultFolderManagementDialogs
        newFolderDialogOpen={newFolderDialogOpen}
        onNewFolderDialogOpenChange={setNewFolderDialogOpen}
        onCreateFolder={(name) => createFolderMutation.mutate(name)}
        isCreatingFolder={createFolderMutation.isPending}
        deleteFolderId={deleteFolderId}
        onCancelDeleteFolder={cancelDeleteFolder}
        onConfirmDeleteFolder={confirmDeleteFolder}
        renameFolderId={renameFolderId}
        renameFolderName={renameFolderName}
        onRenameFolderNameChange={setRenameFolderName}
        onCancelRenameFolder={cancelRenameFolder}
        onConfirmRenameFolder={confirmRenameFolder}
        renameFileId={renameFileId}
        renameFileName={renameFileName}
        onRenameFileNameChange={setRenameFileName}
        onCancelRenameFile={cancelRenameFile}
        onConfirmRenameFile={confirmRenameFile}
        renamePhotoId={renamePhotoId}
        renamePhotoName={renamePhotoName}
        onRenamePhotoNameChange={setRenamePhotoName}
        onCancelRenamePhoto={cancelRenamePhoto}
        onConfirmRenamePhoto={confirmRenamePhoto}
        moveFileDialogOpen={moveFileDialogOpen}
        onMoveFileDialogOpenChange={setMoveFileDialogOpen}
        fileToMove={fileToMove}
        moveTeamId={currentView.type === "team" ? currentView.teamId : null}
        moveClubId={currentView.type === "club" || currentView.type === "team" ? currentView.clubId : null}
        onMoveFile={confirmMoveFile}
        isMovingFile={moveFileMutation.isPending}
      />
    </div>
  );
}
