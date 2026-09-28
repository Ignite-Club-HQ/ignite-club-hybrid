import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Upload, X, Check, Loader2, Camera, Crown, ImagePlus, CheckCircle2, XCircle, Zap, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Progress } from "@/components/ui/progress";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { compressImage, formatFileSize } from "@/lib/imageCompression";
import { isVideoFile, validateVideo, generateVideoThumbnail } from "@/lib/videoUtils";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Capacitor } from "@capacitor/core";
import { isCancelledSelectionError, getReadableUploadError } from "@/lib/uploadErrorUtils";
import { pickNativePhoto, shouldUseNativePicker as shouldUseNativeIOSPicker, ensurePhotoLibraryPermission, PhotoPermissionDeniedError, isPhotoPermissionError } from "@/lib/nativePhotoPicker";
import { showPhotoPermissionDeniedToast } from "@/lib/showPhotoPermissionDeniedToast";
import { syncGalleryPhotoToVault } from "@/lib/galleryVaultSync";
import {
  isIOSEnvironment,
  scheduleIOSNativeOverlayRecovery,
  temporarilyReleaseBodyScrollLock,
} from "@/lib/iosNativeOverlayRecovery";

interface UploadPhotoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadingCountChange?: (count: number) => void;
  /**
   * Optional preselects (used by the post-game "Add photos" CTA in team chat).
   * When provided, the sheet seeds the club/team/event so the user can drop straight
   * into the picker — no manual scoping required.
   */
  defaultClubId?: string | null;
  defaultTeamId?: string | null;
  defaultEventId?: string | null;
}

interface Club {
  id: string;
  name: string;
  is_pro: boolean;
  has_pro_access?: boolean;
}

interface Team {
  id: string;
  name: string;
  is_pro?: boolean;
}

interface MiniLeague {
  id: string;
  name: string;
}

interface SelectedPhoto {
  id: string;
  file: File;
  originalFile: File;
  previewUrl: string;
  thumbnailUrl?: string | null;
  status: 'pending' | 'compressing' | 'uploading' | 'success' | 'error';
  error?: string;
  originalSize: number;
  compressedSize: number;
}



export function UploadPhotoSheet({
  open,
  onOpenChange,
  onUploadingCountChange,
  defaultClubId,
  defaultTeamId,
  defaultEventId,
}: UploadPhotoSheetProps) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { activeClubFilter } = useClubTheme();
  
  const [selectedClubId, setSelectedClubId] = useState<string>("");
  const [selectedTeamId, setSelectedTeamId] = useState<string>("");
  const [selectedMiniLeagueId, setSelectedMiniLeagueId] = useState<string>("");
  const [selectedEventId, setSelectedEventId] = useState<string>("");
  const [caption, setCaption] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<SelectedPhoto[]>([]);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isPickingNativePhoto, setIsPickingNativePhoto] = useState(false);
  const recoveryCleanupRef = useRef<(() => void) | null>(null);
  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === "ios";
  // On native (iOS + Android) the primary tile is hijacked by the Capacitor
  // Camera plugin, which can only return photos. Videos therefore need their
  // own file input on every native platform, not just iOS.
  const isNativeApp = Capacitor.isNativePlatform();
  const shouldStabilizeIOSLayout = isIOSEnvironment();
  const primaryFileInputRef = useRef<HTMLInputElement>(null);
  const addMoreFileInputRef = useRef<HTMLInputElement>(null);

  const restoreNativeLayout = useCallback(() => {
    if (!shouldStabilizeIOSLayout) return;
    recoveryCleanupRef.current?.();
    recoveryCleanupRef.current = scheduleIOSNativeOverlayRecovery();
  }, [shouldStabilizeIOSLayout]);

  // Get user roles
  const { data: userRoles } = useQuery({
    queryKey: ["user-roles-upload", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles")
        .select("role, club_id, team_id")
        .eq("user_id", user!.id);

      if (error) throw error;
      return data || [];
    },
    enabled: !!user,
    staleTime: 300000,
  });

  const isAppAdmin = userRoles?.some(r => r.role === "app_admin") ?? false;

  // Fetch clubs
  const { data: userClubs, isLoading: isLoadingClubs } = useQuery({
    queryKey: ["user-clubs-upload-sheet", user?.id, isAppAdmin, JSON.stringify(userRoles), activeClubFilter ?? ""],
    queryFn: async () => {
      let clubs: Club[] = [];

      if (isAppAdmin) {
        const { data, error } = await supabase
          .from("clubs")
          .select("id, name, is_pro")
          .order("name");

        if (error) throw error;
        clubs = data || [];
      } else if (!userRoles || userRoles.length === 0) {
        // Fallback for transient role-loading issues: verify the currently active club directly
        if (!activeClubFilter) return [];

        const { data: activeClub, error: activeClubError } = await supabase
          .from("clubs")
          .select("id, name, is_pro")
          .eq("id", activeClubFilter)
          .maybeSingle();

        if (activeClubError) throw activeClubError;
        clubs = activeClub ? [activeClub] : [];
      } else {
        const clubIdsFromRoles = userRoles.map((r) => r.club_id).filter(Boolean) as string[];
        const teamIds = userRoles.map((r) => r.team_id).filter(Boolean) as string[];

        let clubIdsFromTeams: string[] = [];
        if (teamIds.length > 0) {
          const { data: teamsData, error: teamsError } = await supabase
            .from("teams")
            .select("club_id")
            .in("id", teamIds);

          if (teamsError) throw teamsError;
          clubIdsFromTeams = (teamsData || []).map((t) => t.club_id).filter(Boolean) as string[];
        }

        const allClubIds = [...new Set([...clubIdsFromRoles, ...clubIdsFromTeams])];
        const clubIdsToFetch =
          allClubIds.length === 0 && activeClubFilter ? [activeClubFilter] : allClubIds;

        if (clubIdsToFetch.length === 0) return [];

        const { data: clubsData, error: clubsError } = await supabase
          .from("clubs")
          .select("id, name, is_pro")
          .in("id", clubIdsToFetch)
          .order("name");

        if (clubsError) throw clubsError;
        clubs = clubsData || [];
      }

      if (clubs.length === 0) return [];

      const clubIdList = clubs.map((c) => c.id);
      const [teamsData, clubSubscriptionsData] = await Promise.all([
        supabase.from("teams").select("id, club_id").in("club_id", clubIdList),
        supabase
          .from("club_subscriptions")
          .select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("club_id", clubIdList),
      ]);

      if (teamsData.error) throw teamsData.error;
      if (clubSubscriptionsData.error) throw clubSubscriptionsData.error;

      const teams = teamsData.data || [];
      const clubSubscriptions = clubSubscriptionsData.data || [];

      const teamIds = teams.map((t) => t.id);
      const { data: teamSubscriptions, error: teamSubscriptionsError } = teamIds.length > 0
        ? await supabase
            .from("team_subscriptions")
            .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
            .in("team_id", teamIds)
        : { data: [], error: null };

      if (teamSubscriptionsError) throw teamSubscriptionsError;

      return clubs.map((club) => {
        const clubSub = clubSubscriptions.find((cs) => cs.club_id === club.id);
        const hasClubPro =
          clubSub?.is_pro ||
          clubSub?.is_pro_football ||
          clubSub?.admin_pro_override ||
          clubSub?.admin_pro_football_override ||
          club.is_pro;

        const clubTeams = teams.filter((t) => t.club_id === club.id);
        const hasProTeam = clubTeams.some((team) => {
          const teamSub = teamSubscriptions?.find((s) => s.team_id === team.id);
          return teamSub?.is_pro || teamSub?.is_pro_football || teamSub?.admin_pro_override || teamSub?.admin_pro_football_override;
        });

        return {
          ...club,
          has_pro_access: hasClubPro || hasProTeam,
        };
      });
    },
    enabled: !!user,
  });

  // Fetch teams for selected club - only teams where user has a role
  const { data: userTeams } = useQuery({
    queryKey: ["user-teams-upload-sheet", user?.id, selectedClubId, isAppAdmin, JSON.stringify(userRoles)],
    queryFn: async () => {
      if (!selectedClubId) return [];
      
      // Get user's team IDs from their roles
      const userTeamIds = userRoles?.filter(r => r.team_id).map(r => r.team_id) || [];
      const isClubAdmin = userRoles?.some(r => r.role === "club_admin" && r.club_id === selectedClubId);
      
      let teams: { id: string; name: string }[] = [];
      
      if (isAppAdmin || isClubAdmin) {
        // App admins and club admins can upload to any team in the club
        const { data } = await supabase
          .from("teams")
          .select("id, name")
          .eq("club_id", selectedClubId)
          .is("deleted_at", null);
        teams = data || [];
      } else if (userTeamIds.length > 0) {
        // Regular users can only upload to teams they have a role in
        const { data } = await supabase
          .from("teams")
          .select("id, name")
          .eq("club_id", selectedClubId)
          .in("id", userTeamIds)
          .is("deleted_at", null);
        teams = data || [];
      }
      
      if (teams.length === 0) return [];
      
      const [subscriptionsResult, clubSubResult, clubDataResult] = await Promise.all([
        supabase
          .from("team_subscriptions")
          .select("team_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .in("team_id", teams.map(t => t.id)),
        supabase
          .from("club_subscriptions")
          .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override")
          .eq("club_id", selectedClubId)
          .maybeSingle(),
        supabase.from("clubs").select("is_pro").eq("id", selectedClubId).maybeSingle(),
      ]);

      if (subscriptionsResult.error) throw subscriptionsResult.error;
      if (clubSubResult.error) throw clubSubResult.error;
      if (clubDataResult.error) throw clubDataResult.error;
      
      const subscriptions = subscriptionsResult.data;
      const clubSub = clubSubResult.data;
      const clubData = clubDataResult.data;
      
      // Photos are now Free-with-caps: every team the user has a role in is selectable.
      // Cap enforcement happens at upload submit time against get_club_free_usage.
      return teams.map((team) => ({ ...team, is_pro: true }));
    },
    enabled: !!user && !!selectedClubId && userRoles !== undefined,
  });

  // Fetch mini-leagues for selected club (Pro Football only)
  const { data: userMiniLeagues } = useQuery({
    queryKey: ["user-mini-leagues-upload-sheet", user?.id, selectedClubId, isAppAdmin, JSON.stringify(userRoles)],
    queryFn: async () => {
      if (!selectedClubId) return [];
      
      const isClubAdmin = userRoles?.some(r => r.role === "club_admin" && r.club_id === selectedClubId);
      const isLeagueAdmin = userRoles?.some(r => r.role === "league_admin" && r.club_id === selectedClubId);
      const isCoach = userRoles?.some(r => r.role === "coach" && r.club_id === selectedClubId);
      
      // Check if club has Pro Football access
      const { data: clubSub } = await supabase
        .from("club_subscriptions")
        .select("is_pro_football, admin_pro_football_override")
        .eq("club_id", selectedClubId)
        .maybeSingle();
      
      const hasProFootball = clubSub?.is_pro_football || clubSub?.admin_pro_football_override;
      if (!hasProFootball && !isAppAdmin) return [];
      
      let miniLeagues: MiniLeague[] = [];
      
      if (isAppAdmin || isClubAdmin || isLeagueAdmin || isCoach) {
        // Admins and coaches can upload to any mini-league in the club
        const { data } = await supabase
          .from("mini_leagues")
          .select("id, name")
          .eq("club_id", selectedClubId)
          .order("name");
        miniLeagues = data || [];
      } else {
        // Parents can only upload to leagues their children are in
        const { data: playerLeagues } = await supabase
          .from("mini_league_players")
          .select("mini_league_id, mini_leagues!inner(id, name, club_id)")
          .eq("parent_user_id", user!.id);
        
        if (playerLeagues) {
          miniLeagues = playerLeagues
            .filter((pl: any) => pl.mini_leagues?.club_id === selectedClubId)
            .map((pl: any) => ({ id: pl.mini_leagues.id, name: pl.mini_leagues.name }));
        }
      }
      
      return miniLeagues;
    },
    enabled: !!user && !!selectedClubId && userRoles !== undefined,
  });

  // Admins, team admins, coaches, and committee members can post club-wide (no team/league selected)
  const canPostClubWide = useMemo(() => {
    if (isAppAdmin) return true;
    if (!selectedClubId || !userRoles) return false;
    return userRoles.some(r => {
      const inClub = r.club_id === selectedClubId || 
        (r.team_id && userTeams?.some(t => t.id === r.team_id));
      return inClub && ['club_admin', 'team_admin', 'coach', 'committee_member'].includes(r.role);
    });
  }, [isAppAdmin, selectedClubId, userRoles, userTeams]);

  // Show all clubs; free ones are visually locked so users know they need Pro
  const availableClubs = (() => {
    let clubs = userClubs;
    if (activeClubFilter && clubs) {
      clubs = clubs.filter(club => club.id === activeClubFilter);
    }
    return clubs;
  })();

  // Auto-select filtered club when active
  useEffect(() => {
    if (activeClubFilter && availableClubs?.some(c => c.id === activeClubFilter) && !selectedClubId) {
      setSelectedClubId(activeClubFilter);
    }
  }, [activeClubFilter, availableClubs, selectedClubId]);

  // Auto-select first team for non-privileged users who can't post club-wide
  useEffect(() => {
    if (!canPostClubWide && selectedClubId && userTeams && userTeams.length > 0 && !selectedTeamId) {
      setSelectedTeamId(userTeams[0].id);
    }
  }, [canPostClubWide, selectedClubId, userTeams, selectedTeamId]);

  // Seed selection from props when sheet opens (e.g. from "Add photos" CTA in
  // a post-game team chat prompt). Resolves club from team if club not provided.
  useEffect(() => {
    if (!open) return;
    if (defaultClubId) setSelectedClubId((prev) => prev || defaultClubId);
    if (defaultTeamId) setSelectedTeamId((prev) => prev || defaultTeamId);
    if (defaultEventId) setSelectedEventId((prev) => prev || defaultEventId);

    if (defaultTeamId && !defaultClubId) {
      let cancelled = false;
      (async () => {
        const { data } = await supabase
          .from("teams")
          .select("club_id")
          .eq("id", defaultTeamId)
          .maybeSingle();
        if (!cancelled && data?.club_id) {
          setSelectedClubId((prev) => prev || (data.club_id as string));
        }
      })();
      return () => { cancelled = true; };
    }
  }, [open, defaultClubId, defaultTeamId, defaultEventId]);

  useEffect(() => {
    if (!open) {
      restoreNativeLayout();
    }
  }, [open, restoreNativeLayout]);

  useEffect(() => {
    return () => {
      recoveryCleanupRef.current?.();
    };
  }, []);

  const uploadSinglePhoto = async (file: File, clubId: string, teamId: string, miniLeagueId: string, eventId: string, photoCaption: string, albumId: string | null): Promise<{ url: string; photoId: string }> => {
    const fileExt = file.name.split(".").pop();
    const timestamp = Date.now();
    const randomSuffix = Math.random().toString(36).substring(7);
    
    // Structure path with club/team/mini-league context for easier backup identification
    let storagePath: string;
    if (miniLeagueId) {
      storagePath = `clubs/${clubId}/mini-leagues/${miniLeagueId}/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    } else if (teamId) {
      storagePath = `clubs/${clubId}/teams/${teamId}/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    } else if (clubId) {
      storagePath = `clubs/${clubId}/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    } else {
      // Fallback for legacy/unassociated uploads
      storagePath = `unassigned/${user!.id}/${timestamp}-${randomSuffix}.${fileExt}`;
    }

    const { error: uploadError } = await supabase.storage
      .from("photos")
      .upload(storagePath, file, { cacheControl: "31536000" });

    if (uploadError) throw uploadError;

    // Store the Supabase storage URL format (will be converted to signed URL when displayed)
    const supabaseUrl = "REDACTED_LAB_VALUE";
    const storageUrl = `${supabaseUrl}/storage/v1/object/public/photos/${storagePath}`;

    // 1. Insert into photos table (for media gallery)
    const { data: insertedPhoto, error: insertError } = await supabase.from("photos").insert({
      image_url: storageUrl,
      uploader_id: user!.id,
      club_id: clubId || null,
      team_id: teamId || null,
      mini_league_id: miniLeagueId || null,
      event_id: eventId || null,
      file_size: file.size,
      title: photoCaption || null,
      caption: photoCaption || null,
      album_id: albumId,
    }).select("id").single();

    if (insertError || !insertedPhoto) {
      // Cleanup: remove the uploaded file from storage if database insert fails
      console.error("Database insert failed, cleaning up storage:", insertError);
      try {
        await supabase.storage.from("photos").remove([storagePath]);
      } catch (cleanupError) {
        console.error("Failed to cleanup orphaned storage file:", cleanupError);
      }
      throw insertError || new Error("Insert failed");
    }

    // One-way mirror: gallery upload → vault "Gallery Uploads" folder
    // (team-scoped if a team is selected, else club-wide). Vault edits/deletes
    // never propagate back to the gallery.
    syncGalleryPhotoToVault({
      fileUrl: storageUrl,
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type || null,
      userId: user!.id,
      clubId,
      teamId: teamId || null,
      miniLeagueId: miniLeagueId || null,
    }).catch((e) => console.warn("gallery → vault sync failed:", e));

    return { url: storageUrl, photoId: insertedPhoto.id };
  };

  const handleClose = () => {
    // Cleanup preview URLs
    selectedPhotos.forEach(photo => {
      URL.revokeObjectURL(photo.previewUrl);
      if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl);
    });
    setSelectedClubId("");
    setSelectedTeamId("");
    setSelectedMiniLeagueId("");
    setSelectedEventId("");
    setCaption("");
    setSelectedPhotos([]);
    setUploading(false);
    setUploadProgress(0);
    restoreNativeLayout();
    onOpenChange(false);
  };

  const addPhotosToSelection = async (files: File[]) => {
    if (files.length === 0) return;

    // Validate videos up-front (size + duration); skip invalid ones with a toast
    const acceptedFiles: File[] = [];
    for (const file of files) {
      if (isVideoFile(file)) {
        const validation = await validateVideo(file);
        if (!validation.ok) {
          toast.error(`${file.name}: ${validation.reason || "Video is not valid"}`);
          continue;
        }
      }
      acceptedFiles.push(file);
    }
    if (acceptedFiles.length === 0) return;

    // Create initial entries; videos go straight to 'pending' (no client compression)
    const newPhotos: SelectedPhoto[] = acceptedFiles.map(file => ({
      id: `${Date.now()}-${Math.random().toString(36).substring(7)}`,
      file,
      originalFile: file,
      previewUrl: URL.createObjectURL(file),
      thumbnailUrl: null,
      status: isVideoFile(file) ? ('pending' as const) : ('compressing' as const),
      originalSize: file.size,
      compressedSize: file.size,
    }));

    setSelectedPhotos(prev => [...prev, ...newPhotos]);

    // Generate poster thumbnails for video entries in parallel (non-blocking)
    for (const photo of newPhotos) {
      if (!isVideoFile(photo.originalFile)) continue;
      void generateVideoThumbnail(photo.originalFile).then(thumb => {
        if (!thumb) return;
        setSelectedPhotos(prev => {
          // If the entry was removed before the thumb arrived, revoke immediately
          const exists = prev.some(p => p.id === photo.id);
          if (!exists) {
            URL.revokeObjectURL(thumb);
            return prev;
          }
          return prev.map(p => p.id === photo.id ? { ...p, thumbnailUrl: thumb } : p);
        });
      });
    }

    // Compress only image entries
    for (const photo of newPhotos) {
      if (isVideoFile(photo.originalFile)) continue;
      try {
        const result = await compressImage(photo.originalFile);
        setSelectedPhotos(prev => prev.map(p =>
          p.id === photo.id
            ? {
                ...p,
                file: result.file,
                status: 'pending' as const,
                compressedSize: result.compressedSize,
              }
            : p
        ));
      } catch (error) {
        // If compression fails, use original file
        setSelectedPhotos(prev => prev.map(p =>
          p.id === photo.id ? { ...p, status: 'pending' as const } : p
        ));
      }
    }
  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    if (shouldStabilizeIOSLayout) {
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    }

    await addPhotosToSelection(Array.from(files));

    if (shouldStabilizeIOSLayout) {
      restoreNativeLayout();
    }

    // Reset the input so the same files can be selected again
    e.target.value = '';
  };

  const handleNativePhotoPick = async () => {
    if (!shouldUseNativeIOSPicker() || uploading || isPickingNativePhoto) return;

    console.log("[UploadPhotoSheet] handleNativePhotoPick START");
    const restoreBodyScrollLock = temporarilyReleaseBodyScrollLock();

    try {
      // Preflight: ensure photo-library permission is granted, otherwise show
      // a clear message asking the user to enable full photo access.
      try {
        await ensurePhotoLibraryPermission();
      } catch (permError) {
        if (permError instanceof PhotoPermissionDeniedError) {
          showPhotoPermissionDeniedToast();
          return;
        }
        // Non-fatal — fall through and let the picker try
      }

      const result = await pickNativePhoto({ quality: 80 });
      console.log("[UploadPhotoSheet] pickNativePhoto OK, blob size:", result.blob.size, "mime:", result.mimeType);

      // NOW safe to set state — native picker has closed
      setIsPickingNativePhoto(true);

      requestAnimationFrame(() => {
        restoreNativeLayout();
      });

      const { blob, mimeType, extension } = result;
      const file = new File([blob], `photo-${Date.now()}.${extension}`, {
        type: mimeType,
        lastModified: Date.now(),
      });

      await addPhotosToSelection([file]);
      restoreNativeLayout();
    } catch (error) {
      if (error instanceof PhotoPermissionDeniedError || isPhotoPermissionError(error)) {
        console.warn("[UploadPhotoSheet] Photo permission denied");
        showPhotoPermissionDeniedToast();
      } else if (isCancelledSelectionError(error)) {
        console.log("[UploadPhotoSheet] user cancelled");
      } else {
        const errMsg = getReadableUploadError(error);
        console.warn("[UploadPhotoSheet] Native picker failed:", errMsg, error);
        toast.error(errMsg || "Could not load photo. Please try again.");
      }
    } finally {
      restoreBodyScrollLock();
      restoreNativeLayout();
      setIsPickingNativePhoto(false);
    }
  };

  const removePhoto = (id: string) => {
    setSelectedPhotos(prev => {
      const photo = prev.find(p => p.id === id);
      if (photo) {
        URL.revokeObjectURL(photo.previewUrl);
        if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl);
      }
      return prev.filter(p => p.id !== id);
    });
  };

  const handleUpload = async () => {
    if (selectedPhotos.length === 0 || !selectedClubId) return;

    // Club-wide publishing (no team / mini-league) is restricted server-side to
    // club admins, committee members, team admins and coaches. Guard here so
    // non-privileged members get a clear message instead of a raw RLS error
    // after their photos have already been uploaded to storage.
    if (!selectedTeamId && !selectedMiniLeagueId && !canPostClubWide) {
      toast.error(
        "Choose a team or mini league for these photos — only club admins, committee members, team admins and coaches can post to the whole club.",
      );
      return;
    }



    // Free-tier cap check (Pro returns isPro=true and bypasses).
    try {
      const { data: usageRow } = await supabase.rpc("get_club_free_usage", {
        _club_id: selectedClubId,
      });
      const usage = Array.isArray(usageRow) ? usageRow[0] : usageRow;
      if (usage && !usage.is_pro) {
        const FREE_PHOTOS = 20;
        const usedCount = Number(usage.photo_uploads_this_cycle ?? 0);
        if (usedCount + selectedPhotos.length > FREE_PHOTOS) {
          toast.error(
            "You've used your 10 free photo uploads this cycle. Upgrade to Pro for unlimited uploads.",
          );
          return;
        }
      }
    } catch (e) {
      console.warn("[UploadPhotoSheet] cap check failed, continuing", e);
    }

    
    const totalPhotos = selectedPhotos.length;
    const photosToUpload = [...selectedPhotos]; // Copy the array before closing
    const clubId = selectedClubId;
    const teamId = selectedTeamId;
    const miniLeagueId = selectedMiniLeagueId;
    const eventId = selectedEventId;
    const photoCaption = caption.trim();
    
    // Notify parent about uploading count for skeleton display BEFORE closing
    onUploadingCountChange?.(totalPhotos);
    
    // Close sheet immediately so user can see skeletons
    onOpenChange(false);
    restoreNativeLayout();
    
    // Show persistent loading toast
    const uploadToastId = toast.loading(
      `Uploading ${totalPhotos} photo${totalPhotos > 1 ? 's' : ''}...`,
      { duration: Infinity }
    );
    
    let successCount = 0;
    let errorCount = 0;
    let firstErrorMessage: string | null = null;
    const uploadedUrls: string[] = [];
    const uploadedPhotoIds: string[] = [];

    // Multi-photo upload session → create a single album so the feed shows
    // one card per upload session (with +N badge) instead of N separate
    // cards each duplicating the same caption.
    //
    // CRITICAL: photos.album_id has an FK to photo_albums(id), so if album
    // creation fails and we upload with album_id=NULL the batch is
    // permanently ungrouped in the gallery (this is exactly what Sandra hit
    // on 2026-05-16 — 21 photos with album_id=NULL rendered as 21 separate
    // feed cards). Never silently fall back to ungrouped: retry once, and
    // if still failing, abort the whole upload with a clear error.
    let albumId: string | null = null;
    if (photosToUpload.length > 1) {
      const args = {
        _club_id: clubId || null,
        _team_id: teamId || null,
        _mini_league_id: miniLeagueId || null,
        _event_id: eventId || null,
        _caption: photoCaption || null,
      };
      const tryCreateAlbum = async () => {
        const { data, error } = await supabase.rpc("create_photo_album", args);
        if (error) throw error;
        if (!data) throw new Error("create_photo_album returned no id");
        return data as string;
      };
      try {
        albumId = await tryCreateAlbum();
      } catch (firstErr) {
        console.warn("[upload] album creation failed, retrying once:", firstErr);
        await new Promise((r) => setTimeout(r, 400));
        try {
          albumId = await tryCreateAlbum();
        } catch (retryErr: any) {
          console.error("[upload] album creation failed after retry, aborting upload:", retryErr);
          toast.error(
            retryErr?.message?.includes("Not authenticated")
              ? "You need to be signed in to upload photos."
              : "Couldn't group these photos into an album. Please try again in a moment.",
            { id: uploadToastId },
          );
          setUploading(false);
          setUploadProgress(0);
          onUploadingCountChange?.(0);
          return;
        }
      }
    }

    for (let i = 0; i < photosToUpload.length; i++) {
      const photo = photosToUpload[i];
      
      // Update toast progress
      toast.loading(
        `Uploading photo ${i + 1} of ${totalPhotos}...`,
        { id: uploadToastId }
      );
      
      try {
        const { url, photoId } = await uploadSinglePhoto(photo.file, clubId, teamId, miniLeagueId, eventId, photoCaption, albumId);
        uploadedUrls.push(url);
        uploadedPhotoIds.push(photoId);
        successCount++;
      } catch (error: unknown) {
        errorCount++;
        if (!firstErrorMessage) {
          firstErrorMessage = getReadableUploadError(error) || null;
        }
        console.error("Upload error:", error);
      }
    }
    
    // Preload all uploaded images before dismissing toast
    if (uploadedUrls.length > 0) {
      toast.loading(
        `Processing ${uploadedUrls.length} photo${uploadedUrls.length > 1 ? 's' : ''}...`,
        { id: uploadToastId }
      );
      
      // Preload all images in parallel
      await Promise.all(
        uploadedUrls.map(url => 
          new Promise<void>((resolve) => {
            const img = new Image();
            img.onload = () => resolve();
            img.onerror = () => resolve(); // Continue even if preload fails
            img.src = url;
          })
        )
      );
    }

    // ---------------------------------------------------------------------
    // Team Gallery → Chat Card
    // Trigger for batches uploaded to a TEAM gallery with ≥2 successful items.
    // Aggregation (10-min window) and message text are handled in the RPC.
    // Push notification only when ≥5 items in the resulting card.
    // ---------------------------------------------------------------------
    if (teamId && successCount >= 2 && uploadedPhotoIds.length >= 2) {
      try {
        const heroPhotoId = uploadedPhotoIds[0];
        const heroUrl = uploadedUrls[0];
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          "post_or_update_team_gallery_card",
          {
            _team_id: teamId,
            _photo_ids: uploadedPhotoIds,
            _hero_photo_id: heroPhotoId,
            _hero_image_url: heroUrl,
            _event_id: eventId || null,
          },
        );
        if (rpcError) {
          console.error("[gallery-card] RPC failed", rpcError);
        } else if (rpcData && Array.isArray(rpcData) && rpcData[0]) {
          const card = rpcData[0] as { card_id: string; message_id: string; total_count: number; was_new: boolean };
          // Push notification rule: only when card represents ≥5 items AND not yet pushed.
          if (card.total_count >= 5) {
            try {
              // Lookup team name for nicer message body.
              const { data: teamRow } = await supabase
                .from("teams")
                .select("name")
                .eq("id", teamId)
                .maybeSingle();
              const teamName = teamRow?.name || "Team";
              const body = `📸 ${card.total_count} new ${teamName} photos added`;
              const { error: pushError } = await supabase.functions.invoke(
                "process-message-notifications",
                {
                  body: {
                    messageType: "team",
                    messageId: card.message_id,
                    authorId: user!.id,
                    messageText: body,
                    imageUrl: null,
                    teamId,
                    replyToId: null,
                  },
                },
              );
              if (pushError) {
                console.error("[gallery-card] push invoke failed", pushError);
              } else {
                await supabase.rpc("mark_gallery_card_push_sent", { _card_id: card.card_id });
              }
            } catch (e) {
              console.error("[gallery-card] push step failed", e);
            }
          }
        }
      } catch (e) {
        console.error("[gallery-card] failed", e);
      }
    }
    
    // Invalidate photos query, vault files query, and storage breakdown
    queryClient.invalidateQueries({ queryKey: ["photos"] });
    queryClient.invalidateQueries({ queryKey: ["vault-files"] });
    queryClient.invalidateQueries({ queryKey: ["storage-breakdown"] });
    queryClient.invalidateQueries({ queryKey: ["club-free-usage"] });
    
    // Notify parent that uploading is complete
    onUploadingCountChange?.(0);
    
    // Dismiss loading toast and show final result
    toast.dismiss(uploadToastId);
    
    // Cleanup state
    selectedPhotos.forEach(photo => {
      URL.revokeObjectURL(photo.previewUrl);
      if (photo.thumbnailUrl) URL.revokeObjectURL(photo.thumbnailUrl);
    });
    setSelectedClubId("");
    setSelectedTeamId("");
    setSelectedMiniLeagueId("");
    setSelectedEventId("");
    setCaption("");
    setSelectedPhotos([]);
    setUploading(false);
    setUploadProgress(0);
    restoreNativeLayout();
    
    if (successCount > 0 && errorCount === 0) {
      // No toast for successful photo uploads
    } else if (successCount > 0 && errorCount > 0) {
      toast.warning(`${successCount} uploaded, ${errorCount} failed`);
    } else {
      toast.error(firstErrorMessage ? `Failed to upload photos: ${firstErrorMessage}` : "Failed to upload photos");
    }

    // Award engagement points for successful uploads (fire and forget)
    if (successCount > 0 && user && clubId) {
      import("@/lib/engagementPoints").then(({ awardEngagementPoints }) => {
        // Award once per upload session using a unique scope
        awardEngagementPoints({
          userId: user.id,
          clubId: clubId,
          action: "photo_upload",
          scopeId: `upload-${Date.now()}`,
        }).catch(() => {});
      });
    }
  };

  const compressingCount = selectedPhotos.filter(p => p.status === 'compressing').length;
  const pendingCount = selectedPhotos.filter(p => p.status === 'pending').length;
  const uploadingCount = selectedPhotos.filter(p => p.status === 'uploading').length;
  const successCount = selectedPhotos.filter(p => p.status === 'success').length;
  const errorCount = selectedPhotos.filter(p => p.status === 'error').length;
  
  // Calculate total savings
  const totalOriginalSize = selectedPhotos.reduce((sum, p) => sum + p.originalSize, 0);
  const totalCompressedSize = selectedPhotos.reduce((sum, p) => sum + p.compressedSize, 0);
  const totalSavings = totalOriginalSize - totalCompressedSize;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[90vh] rounded-t-3xl px-0 overflow-hidden" hideCloseButton>
        <div className="flex flex-col h-full">
          {/* Header */}
          <SheetHeader className="px-4 pb-4 border-b">
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={handleClose}>
                Cancel
              </Button>
              <SheetTitle className="text-lg font-semibold">
                Upload Media {selectedPhotos.length > 0 && `(${selectedPhotos.length})`}
              </SheetTitle>
              <Button 
                size="sm" 
                onClick={handleUpload}
                disabled={selectedPhotos.length === 0 || !selectedClubId || uploading || compressingCount > 0 || isPickingNativePhoto}
              >
                {uploading || isPickingNativePhoto ? <Loader2 className="h-4 w-4 animate-spin" /> : compressingCount > 0 ? "Compressing..." : "Upload"}
              </Button>
            </div>
          </SheetHeader>

          {/* Upload Progress */}
          {uploading && (
            <div className="px-4 py-3 bg-muted/50 border-b">
              <div className="flex items-center justify-between text-sm mb-2">
                <span>Uploading {uploadingCount > 0 ? uploadingCount : successCount + errorCount} of {selectedPhotos.length}...</span>
                <span>{uploadProgress}%</span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {/* Photo Grid / Select Area */}
            <div className="p-4">
              {selectedPhotos.length === 0 ? (
                <>
                <label
                  className={cn(
                    "block cursor-pointer",
                    (uploading || isPickingNativePhoto) && "pointer-events-none opacity-70"
                  )}
                  onClick={(e) => {
                    if (shouldUseNativeIOSPicker()) {
                      e.preventDefault();
                      void handleNativePhotoPick();
                      return;
                    }

                    if (shouldStabilizeIOSLayout) {
                      requestAnimationFrame(() => {
                        restoreNativeLayout();
                      });
                    }
                  }}
                >
                  <div className="aspect-[4/3] rounded-2xl border-2 border-dashed border-muted-foreground/25 bg-muted/50 flex flex-col items-center justify-center gap-4 transition-colors hover:border-muted-foreground/50 hover:bg-muted">
                    <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                      {isPickingNativePhoto ? (
                        <Loader2 className="h-8 w-8 text-primary animate-spin" />
                      ) : (
                        <Camera className="h-8 w-8 text-primary" />
                      )}
                    </div>
                    <div className="text-center px-4">
                      <p className="font-medium">
                        {isPickingNativePhoto
                          ? "Opening photo library..."
                          : isNativeApp
                            ? "Tap to add photos"
                            : "Tap to select photos or videos"}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">
                        {isNativeApp
                          ? "Choose one or more photos from your library"
                          : "Photos (multi-select) or short videos up to 30s"}
                      </p>
                    </div>
                  </div>
                  <input
                    ref={primaryFileInputRef}
                    type="file"
                    accept="image/*,video/*"
                    multiple
                    className="sr-only"
                    onChange={handleFileSelect}
                    disabled={uploading || isPickingNativePhoto}
                  />
                  </label>
                  {isNativeApp && (
                    <div className="mt-3">
                      <label className={cn(
                        "flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 py-3 text-sm font-medium cursor-pointer hover:border-muted-foreground/50 hover:bg-muted transition-colors",
                        (uploading || isPickingNativePhoto) && "pointer-events-none opacity-70"
                      )}>
                        <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M8 5v14l11-7z" /></svg>
                        <span>Upload a video (up to 30s)</span>
                        <input
                          type="file"
                          accept="video/*"
                          className="sr-only"
                          onChange={handleFileSelect}
                          disabled={uploading || isPickingNativePhoto}
                        />
                      </label>
                    </div>
                  )}
                </>
              ) : (
                <div className="space-y-4">
                  {/* Photo Grid */}
                  <div className="grid grid-cols-3 gap-2">
                    {selectedPhotos.map((photo) => {
                      const isVideo = isVideoFile(photo.originalFile);
                      return (
                      <div key={photo.id} className="relative aspect-square rounded-xl overflow-hidden bg-muted">
                        {isVideo ? (
                          <>
                            {photo.thumbnailUrl ? (
                              <img
                                src={photo.thumbnailUrl}
                                alt="Video preview"
                                className={cn(
                                  "w-full h-full object-cover transition-opacity",
                                  photo.status === 'success' && "opacity-75"
                                )}
                              />
                            ) : (
                              <video
                                src={photo.previewUrl}
                                className={cn(
                                  "w-full h-full object-cover transition-opacity",
                                  photo.status === 'success' && "opacity-75"
                                )}
                                muted
                                playsInline
                                preload="metadata"
                              />
                            )}
                            <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/20">
                              <div className="rounded-full bg-black/60 p-2">
                                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-white"><path d="M8 5v14l11-7z" /></svg>
                              </div>
                            </div>
                          </>
                        ) : (
                          <img
                            src={photo.previewUrl}
                            alt="Preview"
                            className={cn(
                              "w-full h-full object-cover transition-opacity",
                              photo.status === 'success' && "opacity-75"
                            )}
                          />
                        )}
                        
                        {/* Status Overlay */}
                        {photo.status === 'compressing' && (
                          <div className="absolute inset-0 bg-background/50 flex flex-col items-center justify-center gap-1">
                            <Zap className="h-5 w-5 animate-pulse text-amber-500" />
                            <span className="text-[10px] font-medium text-muted-foreground">Compressing</span>
                          </div>
                        )}
                        
                        {photo.status === 'uploading' && (
                          <div className="absolute inset-0 bg-background/50 flex items-center justify-center">
                            <Loader2 className="h-6 w-6 animate-spin text-primary" />
                          </div>
                        )}
                        
                        {photo.status === 'success' && (
                          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
                            <CheckCircle2 className="h-8 w-8 text-primary" />
                          </div>
                        )}
                        
                        {photo.status === 'error' && (
                          <div className="absolute inset-0 bg-destructive/20 flex items-center justify-center">
                            <XCircle className="h-8 w-8 text-destructive" />
                          </div>
                        )}
                        
                        {/* Compression Badge */}
                        {photo.status === 'pending' && photo.originalSize > photo.compressedSize && (
                          <div className="absolute bottom-1 left-1 bg-background/80 backdrop-blur-sm rounded px-1.5 py-0.5 text-[10px] font-medium text-primary flex items-center gap-0.5">
                            <Zap className="h-3 w-3" />
                            {Math.round((1 - photo.compressedSize / photo.originalSize) * 100)}%
                          </div>
                        )}
                        
                        {/* Remove Button */}
                        {photo.status === 'pending' && !uploading && (
                          <Button
                            variant="secondary"
                            size="icon"
                            className="absolute top-1 right-1 h-6 w-6 rounded-full bg-background/80 backdrop-blur-sm"
                            onClick={() => removePhoto(photo.id)}
                          >
                            <X className="h-3 w-3" />
                          </Button>
                        )}
                      </div>
                      );
                    })}
                    
                    {/* Add More Button */}
                    {!uploading && (
                      <label
                        className={cn(
                          "aspect-square rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/50 flex items-center justify-center cursor-pointer hover:border-muted-foreground/50 hover:bg-muted transition-colors",
                          isPickingNativePhoto && "pointer-events-none opacity-70"
                        )}
                        onClick={(e) => {
                          if (shouldUseNativeIOSPicker()) {
                            e.preventDefault();
                            void handleNativePhotoPick();
                            return;
                          }

                          if (shouldStabilizeIOSLayout) {
                            requestAnimationFrame(() => {
                              restoreNativeLayout();
                            });
                          }
                        }}
                      >
                        {isPickingNativePhoto ? (
                          <Loader2 className="h-6 w-6 animate-spin text-primary" />
                        ) : (
                          <ImagePlus className="h-6 w-6 text-muted-foreground" />
                        )}
                        <input
                          ref={addMoreFileInputRef}
                          type="file"
                          accept="image/*,video/*"
                          multiple
                          className="sr-only"
                          onChange={handleFileSelect}
                          disabled={uploading || isPickingNativePhoto}
                        />
                      </label>
                     )}
                   </div>

                  {isNativeApp && !uploading && (
                    <label className={cn(
                      "flex items-center justify-center gap-2 rounded-xl border-2 border-dashed border-muted-foreground/25 bg-muted/30 py-3 text-sm font-medium cursor-pointer hover:border-muted-foreground/50 hover:bg-muted transition-colors",
                      isPickingNativePhoto && "pointer-events-none opacity-70"
                    )}>
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current"><path d="M8 5v14l11-7z" /></svg>
                      <span>Add a video (up to 30s)</span>
                      <input
                        type="file"
                        accept="video/*"
                        className="sr-only"
                        onChange={handleFileSelect}
                        disabled={uploading || isPickingNativePhoto}
                      />
                    </label>
                  )}

                  
                  {/* Status Summary */}
                  <div className="flex flex-wrap items-center gap-3 text-sm">
                    {compressingCount > 0 && (
                      <span className="text-amber-500 flex items-center gap-1">
                        <Zap className="h-4 w-4 animate-pulse" /> Compressing {compressingCount}...
                      </span>
                    )}
                    {totalSavings > 0 && compressingCount === 0 && (
                      <span className="text-primary flex items-center gap-1">
                        <Zap className="h-4 w-4" /> Saved {formatFileSize(totalSavings)}
                      </span>
                    )}
                    {successCount > 0 && (
                      <span className="text-primary flex items-center gap-1">
                        <CheckCircle2 className="h-4 w-4" /> {successCount} uploaded
                      </span>
                    )}
                    {errorCount > 0 && (
                      <span className="text-destructive flex items-center gap-1">
                        <XCircle className="h-4 w-4" /> {errorCount} failed
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Caption */}
            {selectedPhotos.length > 0 && (
              <div className="px-4">
                <Input
                  placeholder="Add a caption (optional)"
                  value={caption}
                  onChange={(e) => setCaption(e.target.value)}
                  disabled={uploading}
                  maxLength={200}
                  className="text-sm"
                />
              </div>
            )}

            {/* Form Fields */}
            <div className="px-4 pt-4 pb-6 space-y-6">
              {/* Club Selection */}
              <div className="space-y-3">
                <Label className="text-sm font-medium flex items-center gap-2">
                  Select Club <span className="text-destructive">*</span>
                </Label>
                
                {isLoadingClubs ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : !availableClubs || availableClubs.length === 0 ? (
                  <div className="rounded-xl bg-muted/50 p-4 text-center">
                    <Crown className="h-8 w-8 mx-auto text-muted-foreground mb-2" />
                    <p className="text-sm text-muted-foreground">
                      No clubs available.
                    </p>
                  </div>
                ) : (
                  <div className="grid gap-2">
                    {availableClubs.map((club) => {
                      const isLocked = false; // Free clubs can upload (capped); cap check happens at submit.
                      return (
                        <button
                          key={club.id}
                          type="button"
                          disabled={uploading || !!activeClubFilter || isLocked}
                          onClick={() => {
                            if (isLocked) return;
                            setSelectedClubId(club.id);
                            setSelectedTeamId("");
                            setSelectedMiniLeagueId("");
                          }}
                          className={cn(
                            "flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left w-full",
                            selectedClubId === club.id
                              ? "border-primary bg-primary/5"
                              : "border-border bg-card hover:border-muted-foreground/50",
                            isLocked && "opacity-60 cursor-not-allowed border-dashed",
                            (uploading || !!activeClubFilter) && "opacity-50 cursor-not-allowed"
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <div className={cn(
                              "h-10 w-10 rounded-full flex items-center justify-center text-lg font-semibold",
                              selectedClubId === club.id
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-muted-foreground"
                            )}>
                              {club.name.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-medium">{club.name}</p>
                              {isLocked && (
                                <p className="text-xs text-muted-foreground flex items-center gap-1">
                                  <Lock className="h-3 w-3" />
                                  Pro access required to upload
                                </p>
                              )}
                            </div>
                          </div>
                          {isLocked ? (
                            <Lock className="h-5 w-5 text-muted-foreground" />
                          ) : selectedClubId === club.id ? (
                            <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                              <Check className="h-4 w-4 text-primary-foreground" />
                            </div>
                          ) : null}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Team Selection */}
              {selectedClubId && userTeams && userTeams.length > 0 && !selectedMiniLeagueId && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Team {canPostClubWide ? "(optional)" : ""}</Label>
                  <div className="grid gap-2">
                    {canPostClubWide && (
                      <button
                        type="button"
                        disabled={uploading}
                        onClick={() => setSelectedTeamId("")}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                          selectedTeamId === ""
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-muted-foreground/50",
                          uploading && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span className="text-muted-foreground">All of club</span>
                        {selectedTeamId === "" && (
                          <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    )}
                    {userTeams.map((team) => (
                      <button
                        key={team.id}
                        type="button"
                        disabled={uploading}
                        onClick={() => setSelectedTeamId(team.id)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                          selectedTeamId === team.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-muted-foreground/50",
                          uploading && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span>{team.name}</span>
                        {selectedTeamId === team.id && (
                          <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Mini-League Selection */}
              {selectedClubId && userMiniLeagues && userMiniLeagues.length > 0 && !selectedTeamId && (
                <div className="space-y-3">
                  <Label className="text-sm font-medium">Mini League {canPostClubWide ? "(optional)" : ""}</Label>
                  <div className="grid gap-2">
                    {userMiniLeagues.map((league) => (
                      <button
                        key={league.id}
                        type="button"
                        disabled={uploading}
                        onClick={() => setSelectedMiniLeagueId(league.id)}
                        className={cn(
                          "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                          selectedMiniLeagueId === league.id
                            ? "border-primary bg-primary/5"
                            : "border-border bg-card hover:border-muted-foreground/50",
                          uploading && "opacity-50 cursor-not-allowed"
                        )}
                      >
                        <span>{league.name}</span>
                        {selectedMiniLeagueId === league.id && (
                          <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-primary-foreground" />
                          </div>
                        )}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Bottom Action - for large screens */}
          <div className="hidden sm:block border-t p-4">
            <Button 
              className="w-full h-12 text-base"
              onClick={handleUpload}
              disabled={selectedPhotos.length === 0 || !selectedClubId || uploading}
            >
              {uploading ? (
                <>
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                  Uploading {successCount + errorCount + uploadingCount} of {selectedPhotos.length}...
                </>
              ) : (
                <>
                  <Upload className="h-5 w-5 mr-2" />
                  Upload {selectedPhotos.length > 0 ? `${selectedPhotos.length} Photo${selectedPhotos.length > 1 ? 's' : ''}` : 'Photos'}
                </>
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
