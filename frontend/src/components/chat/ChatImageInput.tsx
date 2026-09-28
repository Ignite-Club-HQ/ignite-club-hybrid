import { useState, useRef, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ImagePlus, X, Loader2, CalendarPlus, BarChart3, Plus, Play, Trophy, Paperclip, Upload, FolderOpen, Crown, Newspaper } from "lucide-react";
import { useClubFreeUsage, notifyClubFreeUsageChanged, type ClubFreeUsage } from "@/hooks/useClubFreeUsage";
import { useScheduleProAccess } from "@/hooks/useScheduleProAccess";
import { VaultPickerSheet } from "./VaultPickerSheet";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { makeVaultFileToken, makeVaultFolderToken, makeVaultRootToken } from "@/lib/chatVaultLinks";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { Capacitor } from "@capacitor/core";
import { compressImage as compressImageFile } from "@/lib/imageCompression";
import { mimeToExtension } from "@/lib/binaryUtils";
import { getReadableUploadError, isCancelledSelectionError } from "@/lib/uploadErrorUtils";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";
import { isIOSEnvironment, scheduleIOSNativeOverlayRecovery, temporarilyReleaseBodyScrollLock } from "@/lib/iosNativeOverlayRecovery";
import {
  isVideoFile,
  isVideoUrl,
  validateVideo,
  videoMimeToExtension,
} from "@/lib/videoUtils";

interface ChatImageInputProps {
  onImageUploaded: (imageUrl: string | null) => void;
  imageUrl: string | null;
  disabled?: boolean;
  clubId?: string;
  teamId?: string;
  onEventSelect?: (eventId: string) => void;
  showEventPicker?: boolean;
  onPollCreate?: () => void;
  showPollCreator?: boolean;
  /** Open the live-board picker (active games on user's teams). */
  onBoardPick?: () => void;
  showBoardPicker?: boolean;
  onNewsSelect?: () => void;
  showNewsPicker?: boolean;
  /** When true, the action icons are hidden and only the image preview (if any) is shown */
  hasText?: boolean;
  /** Append a token to the message (e.g. [vault:uuid]) when user shares from vault. */
  onAppendToken?: (token: string) => void;
  /** Show the "From Vault" / "Upload File" actions. Requires clubId. */
  showVaultPicker?: boolean;
}

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const IOS_SAFE_COMPRESSION_MIME_TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);

export function ChatImageInput({ onImageUploaded, imageUrl, disabled, clubId, teamId, onEventSelect, showEventPicker = false, onPollCreate, showPollCreator = false, onBoardPick, showBoardPicker = false, onNewsSelect, showNewsPicker = false, hasText = false, onAppendToken, showVaultPicker = false }: ChatImageInputProps) {
  const [uploading, setUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const composerWasFocusedRef = useRef(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closingViaTriggerRef = useRef(false);

  // Close the "+" attachment menu when the soft keyboard is dismissed.
  // The popover is anchored to the trigger and does NOT re-position once the
  // visual viewport grows — leaving it floating mid-screen over old composer
  // coordinates. Detecting a viewport-height growth >120px while the menu is
  // open is a reliable proxy for keyboard-hide on both Android and iOS.
  useEffect(() => {
    if (!menuOpen) return;
    const vv = window.visualViewport;
    if (!vv) return;
    let lastH = vv.height;
    const onResize = () => {
      const h = vv.height;
      if (h - lastH > 120) {
        setMenuOpen(false);
      }
      lastH = h;
    };
    vv.addEventListener("resize", onResize);
    return () => vv.removeEventListener("resize", onResize);
  }, [menuOpen]);


  const [vaultPickerOpen, setVaultPickerOpen] = useState(false);
  const [attachChooserOpen, setAttachChooserOpen] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const docInputRef = useRef<HTMLInputElement>(null);
  const hadAttachmentRef = useRef(false);
  const recoveryCleanupRef = useRef<(() => void) | null>(null);
  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === "ios";
  const shouldStabilizeIOSLayout = isIOSEnvironment();
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { hasAccess: hasProAccess } = useScheduleProAccess({ team_id: teamId ?? null, club_id: clubId ?? null } as any);

  // Resolve the clubId for upgrade navigation when only teamId is known.
  const { data: upgradeClubId } = useQuery({
    queryKey: ["chat-input-upgrade-club", clubId, teamId],
    enabled: !clubId && !!teamId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("teams").select("club_id").eq("id", teamId!).maybeSingle();
      return (data?.club_id as string) ?? null;
    },
  });
  const effectiveClubId = clubId ?? upgradeClubId ?? null;
  const { usage } = useClubFreeUsage(effectiveClubId);

  const refreshClubFreeUsage = (changedClubId: string | null | undefined = effectiveClubId) => {
    notifyClubFreeUsageChanged(changedClubId ?? null);
    if (changedClubId) {
      void queryClient.invalidateQueries({ queryKey: ["club-free-usage", changedClubId] });
      void queryClient.refetchQueries({ queryKey: ["club-free-usage", changedClubId], type: "active" });
    }
    void queryClient.invalidateQueries({ queryKey: ["club-free-usage"] });
  };

  const optimisticallyBumpChatFileUsage = (changedClubId: string | null | undefined, fileSize: number) => {
    if (!changedClubId) return;
    queryClient.setQueryData<ClubFreeUsage | null>(["club-free-usage", changedClubId], (current) => {
      if (!current || current.isPro) return current;

      const used = current.chatFile.used + 1;
      const storageUsed = current.chatFile.storageUsed + fileSize;

      return {
        ...current,
        chatFile: {
          ...current.chatFile,
          used,
          storageUsed,
          atCountCap: used >= current.chatFile.limit,
          atStorageCap: storageUsed >= current.chatFile.storageLimit,
          atCap: used >= current.chatFile.limit || storageUsed >= current.chatFile.storageLimit,
        },
      };
    });
  };

  const requirePro = (e: React.MouseEvent) => {
    if (hasProAccess) return false;
    e.preventDefault();
    e.stopPropagation();
    setMenuOpen(false);
    if (effectiveClubId) {
      toast.info("This is a Pro feature");
      navigate(`/clubs/${effectiveClubId}/upgrade`);
    } else {
      toast.info("This is a Pro feature — contact your club administrator to upgrade.");
    }
    return true;
  };

  // Fetch club sport so the live-board action subtitle is contextual.
  const { data: clubSport } = useQuery({
    queryKey: ["club-sport", clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data } = await supabase.from("clubs").select("sport").eq("id", clubId).maybeSingle();
      return (data?.sport ?? null) as string | null;
    },
    enabled: !!clubId && showBoardPicker,
    staleTime: 5 * 60 * 1000,
  });

  // Live Board is only shareable in team chats when there is an actually-active
  // game row for THIS team. We previously also surfaced it for upcoming/recent
  // game events in a ±window, but that produced false positives where the
  // attachment menu offered "Live Board" with no game in progress.
  const { data: hasActiveBoard = false } = useQuery({
    queryKey: ["chat-has-active-board", user?.id, teamId],
    queryFn: async () => {
      if (!user?.id || !teamId) return false;

      const { count: activeCount, error: activeErr } = await supabase
        .from("active_games")
        .select("id", { count: "exact", head: true })
        .eq("team_id", teamId)
        .eq("is_active", true);
      if (activeErr) {
        console.error("[ChatImageInput] active board count failed", activeErr);
        return false;
      }
      return (activeCount ?? 0) > 0;
    },
    enabled: !!user?.id && !!teamId && showBoardPicker,
    staleTime: 60 * 1000,
    refetchInterval: menuOpen ? 30 * 1000 : false,
  });


  const canShowBoardPicker = showBoardPicker && !!teamId && hasActiveBoard;

  const getComposerElement = () => document.querySelector<HTMLTextAreaElement | HTMLInputElement>(
    'textarea[data-chat-composer], input[data-chat-composer], textarea[placeholder^="Type a message"], input[placeholder^="Type a message"]'
  );

  const isComposerFocused = () => {
    const composer = getComposerElement();
    return !!composer && document.activeElement === composer;
  };

  const handleMoreActionsPressStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    closingViaTriggerRef.current = menuOpen;
    const composerWasFocused = isComposerFocused();
    composerWasFocusedRef.current = composerWasFocused;

    // Android WebView can dismiss the IME as soon as a non-editable control is
    // tapped, before Radix's click-driven trigger has a chance to restore focus.
    // Toggle from pointerdown and cancel the default focus transfer so the
    // textarea remains the active element throughout the tap.
    e.preventDefault();
    e.stopPropagation();

    if (composerWasFocused) {
      getComposerElement()?.focus({ preventScroll: true });
    }

    setMenuOpen((open) => !open);
  };

  const boardSubtitle = (() => {
    const s = (clubSport || "").toLowerCase();
    if (s.includes("soccer") || s.includes("football")) return "Track your soccer match live";
    if (s.includes("netball")) return "Track your netball match live";
    if (s.includes("basketball")) return "Track your basketball game live";
    if (s.includes("hockey")) return "Track your hockey match live";
    if (s.includes("rugby")) return "Track your rugby match live";
    if (s) return `Track your ${clubSport} match live`;
    return "Soccer, netball or basketball";
  })();

  const dismissIOSKeyboardAccessory = () => {
    if (!isNativeIOS) return;
    (document.activeElement as HTMLElement | null)?.blur();
  };

  const restoreNativeLayout = () => {
    if (!shouldStabilizeIOSLayout) return;
    recoveryCleanupRef.current?.();
    recoveryCleanupRef.current = scheduleIOSNativeOverlayRecovery();
  };

  const uploadBlob = async (
    blob: Blob,
    options?: { skipCompression?: boolean; isVideo?: boolean; fileName?: string },
  ) => {
    const { skipCompression = false, isVideo = false } = options ?? {};

    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    const originalMimeType = blob.type || (isVideo ? "video/mp4" : "image/jpeg");
    let fileToUpload: Blob | File = blob;
    let contentType = originalMimeType;

    if (!isVideo && !skipCompression) {
      const sourceFile = blob instanceof File
        ? blob
        : new File([blob], `photo.${mimeToExtension(originalMimeType)}`, { type: originalMimeType });

      try {
        const { file: compressedFile } = await compressImageFile(sourceFile);
        fileToUpload = compressedFile;
        contentType = compressedFile.type || originalMimeType || "image/jpeg";
      } catch (compressionError) {
        console.warn("[ChatImageInput] Compression failed, uploading original file:", compressionError);
        fileToUpload = sourceFile;
        contentType = sourceFile.type || originalMimeType || "image/jpeg";
      }
    }

    const extension = isVideo
      ? videoMimeToExtension(contentType)
      : mimeToExtension(contentType);

    const timestamp = Date.now();
    let fileName: string;
    if (teamId && clubId) {
      fileName = `clubs/${clubId}/teams/${teamId}/${user.id}/${timestamp}.${extension}`;
    } else if (clubId) {
      fileName = `clubs/${clubId}/${user.id}/${timestamp}.${extension}`;
    } else {
      fileName = `general/${user.id}/${timestamp}.${extension}`;
    }

    const { error: uploadError } = await supabase.storage
      .from("chat-attachments")
      .upload(fileName, fileToUpload, { contentType, upsert: false, cacheControl: "31536000" });

    if (uploadError) throw new Error(uploadError.message || "Failed to upload image");

    const { data } = supabase.storage.from("chat-attachments").getPublicUrl(fileName);
    let publicUrl = data.publicUrl;

    // Measure intrinsic dimensions (best-effort) and encode them into the URL
    // so the chat row estimator can reserve the correct height on first paint
    // for every receiver — kills the post-load "image area grew" jolt.
    if (!isVideo) {
      try {
        const { measureImageDimensions, appendDimensionsToUrl, setCachedImageAspectRatio } =
          await import("@/lib/chatImageAspectCache");
        const dims = await measureImageDimensions(fileToUpload);
        if (dims) {
          publicUrl = appendDimensionsToUrl(publicUrl, dims.width, dims.height);
          setCachedImageAspectRatio([publicUrl], dims.width / dims.height);
        }
      } catch (e) {
        console.warn("[ChatImageInput] dimension measurement failed", e);
      }
    }

    return publicUrl;
  };


  // Upload a non-image document file to chat-attachments and create a vault_files row,
  // then append a [vault:<id>] token to the message via onAppendToken.
  const handleDocumentSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast.error("File must be less than 10MB");
      if (docInputRef.current) docInputRef.current.value = "";
      return;
    }
    // Free-tier chat-file cap check (skipped automatically for Pro clubs).
    if (clubId) {
      try {
        const { data: usageRow } = await supabase.rpc("get_club_free_usage", { _club_id: clubId });
        const usage: any = Array.isArray(usageRow) ? usageRow[0] : usageRow;
        if (usage && !usage.is_pro) {
          const FREE_FILES = 10;
          const FREE_FILE_BYTES = 100 * 1024 * 1024;
          if (Number(usage.chat_file_uploads_this_cycle ?? 0) >= FREE_FILES) {
            toast.error("You've used your 10 free chat file uploads this cycle. Upgrade to Pro for unlimited chat attachments.");
            if (docInputRef.current) docInputRef.current.value = "";
            return;
          }
          if (Number(usage.chat_file_storage_bytes ?? 0) + file.size > FREE_FILE_BYTES) {
            toast.error("Your club has used its 25 MB free chat file storage this cycle. Upgrade to Pro for unlimited chat attachments.");
            if (docInputRef.current) docInputRef.current.value = "";
            return;
          }
        }
      } catch (capErr) {
        console.warn("[ChatImageInput] file cap check failed, continuing", capErr);
      }
    }
    setUploading(true);
    try {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (!authUser) throw new Error("Not authenticated");

      const timestamp = Date.now();
      const safeExt = (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
      let path: string;
      if (teamId && clubId) {
        path = `clubs/${clubId}/teams/${teamId}/${authUser.id}/${timestamp}.${safeExt}`;
      } else if (clubId) {
        path = `clubs/${clubId}/${authUser.id}/${timestamp}.${safeExt}`;
      } else {
        path = `general/${authUser.id}/${timestamp}.${safeExt}`;
      }

      const { error: upErr } = await supabase.storage
        .from("chat-attachments")
        .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false, cacheControl: "31536000" });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-attachments").getPublicUrl(path);
      const fileUrl = pub.publicUrl;

      // If we have club context, create vault_files row immediately so the file card is shareable.
      if (clubId && onAppendToken) {
        const { data: row, error: insErr } = await supabase
          .from("vault_files")
          .insert({
            club_id: clubId,
            team_id: teamId || null,
            uploaded_by: authUser.id,
            name: file.name,
            file_url: fileUrl,
            file_type: file.type || null,
            file_size: file.size,
            is_external_link: false,
          })
          .select("id")
          .single();
        if (insErr || !row) throw insErr || new Error("Failed to register file");
        onAppendToken(makeVaultFileToken(row.id));
        optimisticallyBumpChatFileUsage(clubId, file.size);
        refreshClubFreeUsage(clubId);
        toast.success("File attached");
      } else {
        toast.error("Cannot attach file in this chat");
      }
    } catch (err) {
      console.error("[ChatImageInput] document upload failed", err);
      toast.error(getReadableUploadError(err) || "Failed to upload file");
    } finally {
      setUploading(false);
      if (docInputRef.current) docInputRef.current.value = "";
    }
  };

  const handleVaultPick = (
    item:
      | { kind: "file" | "folder"; id: string; name: string }
      | { kind: "root"; scope: "team" | "club"; id: string; name: string },
  ) => {
    if (!onAppendToken) return;
    let token: string;
    if (item.kind === "file") {
      token = makeVaultFileToken(item.id);
    } else if (item.kind === "folder") {
      token = makeVaultFolderToken(item.id);
    } else if (item.kind === "root") {
      token = makeVaultRootToken(item.scope, item.id);
    } else {
      return;
    }
    onAppendToken(token);
    setVaultPickerOpen(false);
    if (item.kind === "root") {
      toast.success(`Shared entire ${item.scope === "team" ? "team" : "club"} vault`);
    } else {
      toast.success(`Shared "${item.name}"`);
    }
  };

  const handleVaultPickMany = (
    items: Array<
      | { kind: "file" | "folder"; id: string; name: string }
      | { kind: "root"; scope: "team" | "club"; id: string; name: string }
    >,
  ) => {
    if (!onAppendToken || items.length === 0) return;
    for (const item of items) {
      let token: string;
      if (item.kind === "file") token = makeVaultFileToken(item.id);
      else if (item.kind === "folder") token = makeVaultFolderToken(item.id);
      else if (item.kind === "root") token = makeVaultRootToken(item.scope, item.id);
      else continue;
      onAppendToken(token);
    }
    setVaultPickerOpen(false);
    toast.success(`Shared ${items.length} ${items.length === 1 ? "item" : "items"}`);
  };

  const handleNativePhotoPick = async () => {
    console.log("[ChatImageInput] handleNativePhotoPick START");
    let stablePreviewUrl: string | null = null;
    const restoreBodyScrollLock = temporarilyReleaseBodyScrollLock();

    try {
      const result = await pickNativePhoto({ quality: 80 });
      console.log("[ChatImageInput] pickNativePhoto OK, blob size:", result.blob.size, "mime:", result.mimeType);

      requestAnimationFrame(() => {
        restoreNativeLayout();
      });

      setUploading(true);

      const { blob, mimeType } = result;

      if (blob.size > MAX_UPLOAD_SIZE_BYTES) {
        throw new Error("Image must be less than 10MB");
      }

      // Use a data URL for the native preview — blob: URLs are unreliable in
      // Capacitor WebView (especially Android) and sometimes fail to render.
      try {
        stablePreviewUrl = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result));
          reader.onerror = () => reject(reader.error || new Error("Preview read failed"));
          reader.readAsDataURL(blob);
        });
      } catch (previewErr) {
        console.warn("[ChatImageInput] data URL preview failed, falling back to blob URL", previewErr);
        stablePreviewUrl = URL.createObjectURL(blob);
      }
      dismissIOSKeyboardAccessory();
      setLocalPreview(stablePreviewUrl);
      requestAnimationFrame(restoreNativeLayout);

      const skipCompression = !IOS_SAFE_COMPRESSION_MIME_TYPES.has(mimeType);
      let storageUrl: string;

      try {
        storageUrl = await uploadBlob(blob, { skipCompression });
      } catch (primaryUploadError) {
        if (!skipCompression) {
          console.warn("[ChatImageInput] Retrying native upload without compression:", primaryUploadError);
          storageUrl = await uploadBlob(blob, { skipCompression: true });
        } else {
          throw primaryUploadError;
        }
      }
      console.log("[ChatImageInput] upload complete:", storageUrl.substring(0, 80));
      // Keep localPreview (data URL) visible — remote private URL may not load.
      onImageUploaded(storageUrl);
    } catch (error: unknown) {
      if (isCancelledSelectionError(error)) {
        console.log("[ChatImageInput] user cancelled photo selection");
      } else {
        const errMsg = getReadableUploadError(error);
        console.error("[ChatImageInput] Image upload failed:", errMsg, error);
        toast.error(errMsg || "Failed to upload image");
      }
      if (stablePreviewUrl && stablePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(stablePreviewUrl);
      }
      setLocalPreview(null);
    } finally {
      restoreBodyScrollLock();
      restoreNativeLayout();
      setUploading(false);
      // Do NOT blur document.activeElement here: if the user tapped back into
      // the chat textarea while the upload was running, this dismisses their
      // keyboard mid-typing. dismissIOSKeyboardAccessory() at the start of the
      // pick (before upload) already handles the picker→keyboard handoff.
    }

  };

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isVideo = isVideoFile(file);

    if (!isVideo && !file.type.startsWith("image/")) {
      toast.error("Please select an image or video file");
      return;
    }

    if (isVideo) {
      const validation = await validateVideo(file);
      if (!validation.ok) {
        toast.error(validation.reason || "Video is not valid");
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
    } else if (file.size > MAX_UPLOAD_SIZE_BYTES) {
      toast.error("Image must be less than 10MB");
      return;
    }

    if (shouldStabilizeIOSLayout) {
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    }

    // Prefer a data URL for the preview — blob: URLs are unreliable in iOS
    // WKWebView and Android WebView. Fall back to blob: for videos / read
    // failures.
    let localUrl: string;
    try {
      if (isVideo) throw new Error("skip-data-url-for-video");
      localUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("Preview read failed"));
        reader.readAsDataURL(file);
      });
    } catch {
      localUrl = URL.createObjectURL(file);
    }
    setLocalPreview(localUrl);
    setUploading(true);

    try {
      const storageUrl = await uploadBlob(file, { isVideo });
      // Keep localPreview as-is: the remote (private) storage URL can't always
      // be rendered directly by <img> and would flip to the placeholder. The
      // preview is cleared when imageUrl resets (after send) or via remove.
      onImageUploaded(storageUrl);
    } catch (error) {
      console.error("Upload error:", error);
      toast.error(isVideo ? "Failed to upload video" : "Failed to upload image");
      if (localUrl.startsWith("blob:")) URL.revokeObjectURL(localUrl);
      setLocalPreview(null);
    } finally {
      setUploading(false);
      if (shouldStabilizeIOSLayout) {
        restoreNativeLayout();
      }
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleImageButtonClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (shouldUseNativePicker()) {
      // CRITICAL iOS GESTURE RULE:
      // Camera.getPhoto must be invoked synchronously from the user's click —
      // any `await` or async hop before it breaks the gesture chain in WKWebView
      // and the picker silently fails to open. Do NOT add awaits or state
      // updates before this call. handleNativePhotoPick starts the async work
      // immediately on its first line so the gesture is preserved.
      void handleNativePhotoPick();
    } else {
      (e.currentTarget as HTMLElement)?.blur();
      fileInputRef.current?.click();
      if (shouldStabilizeIOSLayout) {
        requestAnimationFrame(() => {
          restoreNativeLayout();
        });
      }
    }
  };

  const handleRemoveImage = () => {
    if (localPreview?.startsWith("blob:")) {
      URL.revokeObjectURL(localPreview);
    }
    setLocalPreview(null);
    onImageUploaded(null);
    restoreNativeLayout();
  };

  const [previewFailed, setPreviewFailed] = useState(false);

  useEffect(() => {
    setPreviewFailed(false);
  }, [localPreview, imageUrl]);

  // When the parent clears imageUrl (e.g. after a successful send), drop the
  // locally-held preview too so the composer returns to its empty state.
  const prevImageUrlRef = useRef(imageUrl);
  useEffect(() => {
    if (prevImageUrlRef.current && !imageUrl && localPreview) {
      if (localPreview.startsWith("blob:")) URL.revokeObjectURL(localPreview);
      setLocalPreview(null);
    }
    prevImageUrlRef.current = imageUrl;
  }, [imageUrl, localPreview]);

  useEffect(() => {
    return () => {
      recoveryCleanupRef.current?.();
    };
  }, []);

  useEffect(() => {
    const hasAttachment = Boolean(localPreview || imageUrl);

    if (shouldStabilizeIOSLayout && hadAttachmentRef.current && !hasAttachment && !uploading) {
      requestAnimationFrame(() => {
        restoreNativeLayout();
      });
    }

    hadAttachmentRef.current = hasAttachment;
  }, [imageUrl, localPreview, shouldStabilizeIOSLayout, uploading]);

  const displayUrl = localPreview || imageUrl;

  // If there's an image attached, always show the preview regardless of hasText
  if (displayUrl) {
    return (
      <div className="flex shrink-0 items-center gap-1 self-center pl-0.5">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/*"
          onChange={handleFileSelect}
          className="sr-only"
          disabled={disabled || uploading}
        />
        <div className="relative inline-block">
          {previewFailed ? (
            <div className="h-11 w-11 rounded-md bg-muted flex items-center justify-center">
              <ImagePlus className="h-5 w-5 text-muted-foreground" />
            </div>
          ) : isVideoUrl(displayUrl) ? (
            <div className="relative h-11 w-11 rounded-md overflow-hidden bg-black">
              <video
                src={displayUrl}
                className="h-11 w-11 object-cover"
                muted
                playsInline
                preload="metadata"
                onError={() => setPreviewFailed(true)}
              />
              <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/30">
                <Play className="h-4 w-4 fill-white text-white" />
              </div>
            </div>
          ) : (
            <img
              src={displayUrl}
              alt="Attachment preview"
              className="h-11 w-11 object-cover rounded-md"
              onError={() => setPreviewFailed(true)}
            />
          )}

          {uploading && (
            <div className="absolute inset-0 bg-background/50 flex items-center justify-center rounded">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            </div>
          )}
          <button
            type="button"
            className="absolute -top-2 -left-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm touch-manipulation"
            onClick={handleRemoveImage}
            disabled={disabled}
            aria-label="Remove attachment"
          >
            <X className="h-3 w-3" strokeWidth={3} />
          </button>
        </div>
      </div>
    );
  }

  // NOTE: Previously the "+" button was hidden when `hasText` was true. That
  // removed the user's only way to attach a photo / file / poll / event after
  // they had started typing — a regression vs. WhatsApp / Messenger and an
  // explicit UX requirement. Attachment access must remain available in every
  // composer state (empty, focused, typing, keyboard open/closed). The send
  // button lives in a separate component (ChatSendButton), so keeping "+"
  // visible does not crowd it out. We therefore intentionally fall through to
  // the full popover render below regardless of `hasText`.

  // Show photo button inline; event + poll behind a "+" popover.
  // Photo upload is ALWAYS mirrored inside the "+" popover because many users
  // (e.g. parents coming from WhatsApp/Messenger) instinctively look for
  // attachments behind a "+" rather than tapping the dedicated image icon.
  // The "+" button is therefore shown unconditionally, even when there are no
  // event/poll/board extras to surface.

  return (
    <div className="flex shrink-0 items-center gap-0">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        onChange={handleFileSelect}
        className="sr-only"
        disabled={disabled || uploading}
      />
      <input
        ref={docInputRef}
        type="file"
        accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.csv,.txt,.rtf,.zip,.odt,.ods,.odp,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/csv,text/plain,application/zip"
        onChange={handleDocumentSelect}
        className="sr-only"
        disabled={disabled || uploading}
      />
      {showVaultPicker && clubId && (
        <>
          <VaultPickerSheet
            open={vaultPickerOpen}
            onOpenChange={setVaultPickerOpen}
            clubId={clubId}
            teamId={teamId || null}
            onPick={handleVaultPick}
            onPickMany={handleVaultPickMany}
          />
          <Sheet open={attachChooserOpen} onOpenChange={setAttachChooserOpen}>
            <SheetContent side="bottom" className="p-0 rounded-t-3xl border-t border-border">
              <div className="flex justify-center pt-2 pb-1">
                <div className="w-10 h-1.5 bg-muted rounded-full" />
              </div>
              <SheetHeader className="px-5 pt-2 pb-3">
                <SheetTitle className="text-left text-[17px] font-semibold tracking-tight">
                  Attach File or Folder
                </SheetTitle>
              </SheetHeader>
              <div className="grid grid-cols-2 gap-3 px-5 pb-6">
                <button
                  type="button"
                  disabled={disabled || uploading}
                  onClick={() => {
                    setAttachChooserOpen(false);
                    docInputRef.current?.click();
                  }}
                  className="group flex flex-col items-center justify-center gap-3 py-6 rounded-2xl border border-border bg-muted/40 hover:bg-muted active:scale-[0.97] active:bg-muted transition-all disabled:opacity-50 min-h-[128px]"
                  aria-label="Upload from device"
                >
                  <div className="h-14 w-14 rounded-full bg-primary/10 flex items-center justify-center group-active:bg-primary/15 transition-colors">
                    <Upload className="h-6 w-6 text-primary" />
                  </div>
                  <div className="flex flex-col items-center leading-tight gap-0.5">
                    <span className="text-[15px] font-medium text-foreground">From Device</span>
                    <span className="text-[12px] text-muted-foreground">PDF, doc, sheet</span>
                  </div>
                </button>
                {(() => {
                  const vaultLocked = !!usage && !usage.isPro;
                  return (
                    <button
                      type="button"
                      disabled={disabled || vaultLocked}
                      onClick={() => {
                        setAttachChooserOpen(false);
                        setVaultPickerOpen(true);
                      }}
                      className="group relative flex flex-col items-center justify-center gap-3 py-6 rounded-2xl border border-border bg-muted/40 hover:bg-muted active:scale-[0.97] active:bg-muted transition-all disabled:opacity-50 min-h-[128px]"
                      aria-label={vaultLocked ? "From Vault (Pro only)" : "Choose from vault"}
                    >
                      {vaultLocked && (
                        <span className="absolute top-2 right-2 inline-flex items-center gap-1 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
                          <Crown className="h-2.5 w-2.5" /> PRO
                        </span>
                      )}
                      <div className={`h-14 w-14 rounded-full flex items-center justify-center transition-colors ${vaultLocked ? "bg-muted" : "bg-primary/10 group-active:bg-primary/15"}`}>
                        <FolderOpen className={`h-6 w-6 ${vaultLocked ? "text-muted-foreground" : "text-primary"}`} />
                      </div>
                      <div className="flex flex-col items-center leading-tight gap-0.5">
                        <span className={`text-[15px] font-medium ${vaultLocked ? "text-muted-foreground" : "text-foreground"}`}>From Vault</span>
                        <span className="text-[12px] text-muted-foreground">{vaultLocked ? "Upgrade to unlock" : "Existing file or folder"}</span>
                      </div>
                    </button>
                  );
                })()}
              </div>
            </SheetContent>
          </Sheet>
        </>
      )}
      {/* Standalone image shortcut removed — photo upload lives inside the "+" menu. */}
      {(
        <Popover
          open={menuOpen}
          onOpenChange={(next) => {
            if (next) {
                // Snapshot whether the keyboard was already up (composer focused)
                // at the moment the user opens the tray. This is also set on
                // pointerdown before the trigger can take focus, which prevents
                // stale focus from reopening the keyboard on the next + tap.
                composerWasFocusedRef.current = isComposerFocused();
              } else {
                window.setTimeout(() => {
                  closingViaTriggerRef.current = false;
                }, 0);
            }
            setMenuOpen(next);
          }}
        >

          <PopoverTrigger asChild>
            <button
              ref={triggerRef}
              type="button"
              disabled={disabled}
              aria-label="More actions"
              title="More actions"
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              // Always prevent the trigger from taking focus. If the composer
              // was already focused this keeps the keyboard up; if it was not,
              // repeated + / X taps cannot move focus into the composer later.
              onPointerDown={handleMoreActionsPressStart}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
              onClick={(e) => {
                // State is already toggled in pointerdown. Prevent Radix's
                // click handler from running a second toggle after Android has
                // potentially hidden the keyboard.
                e.preventDefault();
                e.stopPropagation();
              }}
              className={`inline-flex items-center justify-center h-10 w-10 shrink-0 rounded-full transition-all duration-150 disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:ring-offset-1 focus-visible:ring-offset-background touch-manipulation ${
                menuOpen
                  ? "bg-muted/70 text-foreground/80"
                  : "text-foreground/55 hover:text-foreground hover:bg-muted/60 active:bg-muted/70"
              }`}
            >
              <Plus
                className={`h-[22px] w-[22px] transition-transform duration-200 ${menuOpen ? "rotate-45" : ""}`}
                strokeWidth={2}
                aria-hidden="true"
              />
            </button>
          </PopoverTrigger>
          <PopoverContent
            align="start"
            side="top"
            sideOffset={10}
            collisionPadding={8}
            avoidCollisions={false}
            // Keep focus inside the composer textarea so the keyboard stays
            // up while the attachment tray is open — including when the user
            // taps outside to dismiss the tray.
            onOpenAutoFocus={(e) => e.preventDefault()}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              // Only refocus the composer if the keyboard was already up when
              // the tray opened. Otherwise tapping "+" then "X" would activate
              // the keyboard unexpectedly.
              if (!composerWasFocusedRef.current) {
                const composer = getComposerElement();
                const active = document.activeElement as HTMLElement | null;
                if (active === triggerRef.current || (closingViaTriggerRef.current && active === composer)) {
                  active?.blur();
                }
                return;
              }
              const composer = getComposerElement();
              composer?.focus({ preventScroll: true });
            }}
            onPointerDownOutside={(e) => {
              const target = e.target as HTMLElement | null;
              // If the user tapped on the composer textarea itself, let the
              // event through so the caret moves there.
              if (target?.closest?.('textarea, input[type="text"], [contenteditable="true"]')) return;
              // Otherwise prevent default so the textarea does NOT blur
              // (keyboard stays up). Critically, focus the composer SYNCHRONOUSLY
              // inside this user-gesture pointer event — on Android, programmatic
              // .focus() called later (e.g. from onCloseAutoFocus) will not
              // reopen the soft keyboard because it's no longer a user gesture.
              e.preventDefault();
              // Only refocus the composer if it was already focused (keyboard up)
              // when the tray opened — otherwise dismissing the tray should not
              // pop the keyboard up.
              if (!composerWasFocusedRef.current) return;
              const composer = getComposerElement();
              composer?.focus({ preventScroll: true });
            }}

            className="w-[calc(100vw-16px)] max-w-[420px] p-1.5 rounded-xl border border-border/50 shadow-[0_8px_24px_-12px_rgba(0,0,0,0.18)] dark:shadow-[0_8px_24px_-12px_rgba(0,0,0,0.6)] bg-popover data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-bottom-1 data-[state=open]:slide-in-from-bottom-1 max-h-[min(70vh,420px)] overflow-y-auto overscroll-contain"
          >
            {(() => {
              type Action = {
                key: string;
                label: string;
                hint: string;
                icon: React.ReactNode;
                tone: "primary" | "muted";
                onClick: (e: React.MouseEvent<HTMLButtonElement>) => void;
                disabled?: boolean;
                locked?: boolean;
              };
              const actions: Action[] = [];
              actions.push({
                key: "photo",
                label: "Photo / Video",
                hint: "Camera roll",
                icon: <ImagePlus className="h-[17px] w-[17px]" strokeWidth={2} />,
                tone: "primary",
                disabled: disabled || uploading,
                onClick: (e) => {
                  setMenuOpen(false);
                  handleImageButtonClick(e);
                },
              });

              if (showVaultPicker && clubId) {
                actions.push({
                  key: "file",
                  label: "File or Folder",
                  hint: usage && !usage.isPro ? "From device" : "Device or vault",
                  icon: <Paperclip className="h-[17px] w-[17px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled: disabled || uploading,
                  onClick: (e) => {
                    setMenuOpen(false);
                    setAttachChooserOpen(true);
                  },
                });
              }
              if (showEventPicker && onEventSelect) {
                actions.push({
                  key: "event",
                  label: "Share Event",
                  hint: "Training or game",
                  icon: <CalendarPlus className="h-[17px] w-[17px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled,
                  onClick: (e) => {
                    setMenuOpen(false);
                    onEventSelect("");
                  },
                });
              }

              if (showNewsPicker && onNewsSelect) {
                actions.push({
                  key: "news",
                  label: "Share News",
                  hint: "Club news post",
                  icon: <Newspaper className="h-[17px] w-[17px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled,
                  onClick: () => {
                    setMenuOpen(false);
                    onNewsSelect();
                  },
                });
              }

              if (showPollCreator && onPollCreate) {
                actions.push({
                  key: "poll",
                  label: "Create Poll",
                  hint: "Ask the group",
                  icon: <BarChart3 className="h-[17px] w-[17px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled,
                  onClick: (e) => {
                    setMenuOpen(false);
                    onPollCreate();
                  },
                });
              }
              if (canShowBoardPicker && onBoardPick) {
                actions.push({
                  key: "board",
                  label: "Live Board",
                  hint: "Track match live",
                  icon: <Trophy className="h-[17px] w-[17px]" strokeWidth={2} />,
                  tone: "muted",
                  disabled,
                  onClick: () => {
                    setMenuOpen(false);
                    onBoardPick();
                  },
                });
              }
              return (
                <>
                <div className="grid grid-cols-2 gap-1.5">
                  {actions.map((a) => (
                    <button
                      key={a.key}
                      type="button"
                      disabled={a.disabled}
                      onPointerDown={(e) => e.preventDefault()}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={a.onClick}
                      className="flex items-center gap-2.5 px-2.5 py-2 rounded-xl bg-transparent hover:bg-muted/50 active:bg-muted/70 active:scale-[0.98] transition-all duration-100 disabled:opacity-50 disabled:active:scale-100 min-h-[52px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring/50 text-left"
                      aria-label={a.label}
                    >
                      <div
                        className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted/60 text-foreground/70"
                      >
                        {a.icon}
                        {a.locked && (
                          <span className="absolute -top-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                            <Crown className="h-2.5 w-2.5" strokeWidth={2.5} />
                          </span>
                        )}
                      </div>
                      <div className="flex flex-col leading-tight min-w-0">
                        <span className="text-[13px] font-medium text-foreground/90 truncate">{a.label}</span>
                        <span className={`text-[11px] truncate ${a.locked ? "text-primary/80" : "text-muted-foreground/80"}`}>{a.hint}</span>
                      </div>
                    </button>
                  ))}
                </div>
                {usage && !usage.isPro && (() => {
                  const photoAtCap = usage.chatPhoto.used >= usage.chatPhoto.limit;
                  const fileAtCap = showVaultPicker && usage.chatFile.used >= usage.chatFile.limit;
                  const pollAtCap = showPollCreator && usage.poll.used >= usage.poll.limit;
                  const anyAtCap = photoAtCap || fileAtCap || pollAtCap;
                  const resetAt = usage.cycleEnd;
                  let resetLine: string | null = null;
                  if (resetAt) {
                    const diffMs = resetAt.getTime() - Date.now();
                    const dateLabel = resetAt.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
                    if (diffMs <= 0) resetLine = `Resets shortly (${dateLabel})`;
                    else {
                      const hours = Math.round(diffMs / (1000 * 60 * 60));
                      if (hours < 24) resetLine = `Resets in ${hours}h (${dateLabel})`;
                      else {
                        const days = Math.round(hours / 24);
                        resetLine = `Resets in ${days} ${days === 1 ? "day" : "days"} (${dateLabel})`;
                      }
                    }
                  }
                  return (
                    <div className="mt-1.5 px-1 space-y-0.5">
                      <div className="flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 rounded-lg bg-muted/40 px-2 py-1.5 text-[11px] text-muted-foreground/80 leading-tight">
                        <span className={photoAtCap ? "text-destructive font-medium" : undefined}>{usage.chatPhoto.used}/{usage.chatPhoto.limit} photos</span>
                        {showVaultPicker && <span className={fileAtCap ? "text-destructive font-medium" : undefined}>{usage.chatFile.used}/{usage.chatFile.limit} files</span>}
                        {showPollCreator && <span className={pollAtCap ? "text-destructive font-medium" : undefined}>{usage.poll.used}/{usage.poll.limit} polls</span>}
                      </div>
                      {resetLine && (
                        <div className="text-center text-[10.5px] text-muted-foreground/80 px-2 leading-tight">
                          {resetLine}
                        </div>
                      )}
                      {effectiveClubId && (
                        <button
                          type="button"
                          onClick={() => {
                            setMenuOpen(false);
                            navigate(`/clubs/${effectiveClubId}/upgrade`);
                          }}
                          className="w-full text-center text-[10.5px] text-muted-foreground/60 hover:text-primary transition-colors inline-flex items-center justify-center gap-1"
                        >
                          <Crown className="h-3 w-3" />
                          Upgrade for unlimited
                        </button>
                      )}
                    </div>
                  );
                })()}
              </>
              );
            })()}
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}
