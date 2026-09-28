import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Trash2, Flag, ArrowLeft, Download, Share2, MoreVertical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { VisuallyHidden } from "@radix-ui/react-visually-hidden";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useSwipeGesture } from "@/hooks/useSwipeGesture";
import { usePinchZoom } from "@/hooks/usePinchZoom";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { Capacitor } from "@capacitor/core";
import { applyStatusBarForViewer, refreshStatusBar } from "@/lib/statusBarControl";
import { ReportPhotoDialog } from "@/components/ReportPhotoDialog";
import { isVideoUrl } from "@/lib/videoUtils";
import { downloadMedia, isDownloadInFlight } from "@/lib/downloadImage";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { toast } from "sonner";

const getErrorMessage = (error: unknown) => error instanceof Error ? error.message : String(error ?? "");

interface PhotoLightboxProps {
  isOpen: boolean;
  onClose: () => void;
  photos: { id: string; file_url?: string | null; image_url?: string | null; title?: string | null; club_id?: string | null; team_id?: string | null }[];
  currentIndex: number;
  onNavigate: (index: number) => void;
  onDelete?: (photoId: string) => void;
  canDelete?: boolean;
}

function LightboxImage({
  src,
  poster,
  alt,
  scale,
  translateX,
  translateY,
  dismissOffset,
}: {
  src: string;
  poster?: string | null;
  alt: string;
  scale: number;
  translateX: number;
  translateY: number;
  dismissOffset: number;
}) {
  const showAsVideo = isVideoUrl(src);
  const { signedUrl, isLoading } = useSignedPhotoUrl(src);
  const effectiveSrc = signedUrl || src;

  if (showAsVideo) {
    return (
      <video
        key={effectiveSrc}
        src={isLoading ? undefined : effectiveSrc}
        poster={poster || undefined}
        className="max-w-[100vw] max-h-[100dvh] object-contain bg-black"
        controls
        autoPlay
        playsInline
        preload="metadata"
      />
    );
  }

  if (isLoading) {
    return (
      <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin" />
    );
  }

  // Fit the whole photo to the screen by default (letterboxed like the chat
  // image viewer), not edge-to-edge crop. Pinch / double-tap still zooms.
  return (
    <img
      src={effectiveSrc}
      alt={alt}
      className="select-none max-w-[100vw] max-h-[100dvh] w-auto h-auto object-contain"
      style={{
        transform: `translate3d(${translateX}px, ${translateY + dismissOffset}px, 0) scale(${scale})`,
        transition: dismissOffset === 0 ? "transform 180ms cubic-bezier(0.22, 1, 0.36, 1)" : "none",
        willChange: "transform",
      }}
      draggable={false}
    />
  );
}

export function PhotoLightbox({
  isOpen,
  onClose,
  photos,
  currentIndex,
  onNavigate,
  onDelete,
  canDelete,
}: PhotoLightboxProps) {
  const navigate = useNavigate();
  const currentPhoto = photos[currentIndex];
  const [reportPhotoId, setReportPhotoId] = useState<string | null>(null);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [dismissOffset, setDismissOffset] = useState(0);
  const [dismissOpacity, setDismissOpacity] = useState(1);
  const [isDownloading, setIsDownloading] = useState(false);

  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastTapRef = useRef<number>(0);
  const dismissStartRef = useRef<{ x: number; y: number } | null>(null);
  const dismissingRef = useRef(false);
  const downloadCloseGuardRef = useRef(false);

  const {
    scale,
    translateX,
    translateY,
    onTouchStart: pinchTouchStart,
    onTouchMove: pinchTouchMove,
    onTouchEnd: pinchTouchEnd,
    onDoubleClick: pinchOnDoubleClick,
    resetZoom,
  } = usePinchZoom(1, 4);

  const handlePrev = () => {
    if (currentIndex > 0) onNavigate(currentIndex - 1);
  };

  const handleNext = () => {
    if (currentIndex < photos.length - 1) onNavigate(currentIndex + 1);
  };

  const scheduleHideControls = () => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = setTimeout(() => setControlsVisible(false), 2800);
  };

  const showControls = () => {
    setControlsVisible(true);
    scheduleHideControls();
  };

  const swipeHandlers = useSwipeGesture({
    onSwipeLeft: scale === 1 ? handleNext : undefined,
    onSwipeRight: scale === 1 ? handlePrev : undefined,
    threshold: 50,
  });

  useEffect(() => {
    resetZoom();
  }, [currentIndex, resetZoom]);

  useEffect(() => {
    if (!isOpen) return;
    setControlsVisible(true);
    scheduleHideControls();
    return () => {
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    if (!Capacitor.isNativePlatform()) return;
    applyStatusBarForViewer();
    return () => {
      refreshStatusBar();
    };
  }, [isOpen]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowLeft") handlePrev();
    if (e.key === "ArrowRight") handleNext();
    if (e.key === "Escape") onClose();
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    pinchTouchStart(e);
    if (e.touches.length === 1 && scale <= 1) {
      swipeHandlers.onTouchStart(e);
      dismissStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      dismissingRef.current = false;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    pinchTouchMove(e);
    if (e.touches.length === 1 && scale <= 1) {
      // Swipe-down-to-dismiss detection. Only commit once vertical motion is
      // clearly dominant AND substantial — otherwise horizontal swipes
      // (next/prev photo) get hijacked the moment the finger drifts down.
      if (dismissStartRef.current) {
        const dx = e.touches[0].clientX - dismissStartRef.current.x;
        const dy = e.touches[0].clientY - dismissStartRef.current.y;
        if (
          dismissingRef.current ||
          (dy > 30 && Math.abs(dy) > Math.abs(dx) * 2.2)
        ) {
          dismissingRef.current = true;
          const offset = Math.max(0, dy);
          setDismissOffset(offset);
          setDismissOpacity(Math.max(0.2, 1 - offset / 500));
          return;
        }
        // If horizontal motion is clearly dominant, abandon dismiss tracking
        // so it can't hijack the swipe later in the gesture.
        if (Math.abs(dx) > 20 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          dismissStartRef.current = null;
        }
      }
      swipeHandlers.onTouchMove(e);
    }
  };

  const handleTouchEnd = () => {
    pinchTouchEnd();
    if (dismissingRef.current) {
      if (dismissOffset > 120) {
        onClose();
      } else {
        setDismissOffset(0);
        setDismissOpacity(1);
      }
      dismissingRef.current = false;
      dismissStartRef.current = null;
      return;
    }
    dismissStartRef.current = null;
    if (scale <= 1) {
      swipeHandlers.onTouchEnd();
    }
  };

  // Single-tap toggles controls; double-tap toggles zoom (1× <-> 2.5×).
  const handleClick = (e: React.MouseEvent) => {
    // Ignore clicks on controls
    const target = e.target as HTMLElement;
    if (target.closest('[data-lightbox-control]')) return;

    if (menuOpen) {
      setMenuOpen(false);
      return;
    }

    const now = Date.now();
    const since = now - lastTapRef.current;
    if (since < 280) {
      // Double-tap
      if (tapTimerRef.current) {
        clearTimeout(tapTimerRef.current);
        tapTimerRef.current = null;
      }
      lastTapRef.current = 0;
      handleDoubleTap();
      return;
    }
    lastTapRef.current = now;
    if (tapTimerRef.current) clearTimeout(tapTimerRef.current);
    tapTimerRef.current = setTimeout(() => {
      // Single-tap: toggle controls
      if (controlsVisible) {
        setControlsVisible(false);
        if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
      } else {
        showControls();
      }
      tapTimerRef.current = null;
    }, 280);
  };

  const handleDoubleTap = () => {
    if (scale > 1) {
      resetZoom();
    } else {
      pinchOnDoubleClick({} as React.MouseEvent);
    }
  };


  const photoSrc = currentPhoto?.file_url || currentPhoto?.image_url || '';
  const { signedUrl: downloadSignedUrl } = useSignedPhotoUrl(photoSrc);

  if (!currentPhoto) return null;

  const handleDownload = async () => {
    const url = downloadSignedUrl || photoSrc;
    if (!url) return;
    if (isDownloading || isDownloadInFlight(url)) return;
    setIsDownloading(true);
    downloadCloseGuardRef.current = true;
    try {
      const kind = isVideoUrl(url) ? "video" : "photo";
      await downloadMedia(url, kind);
    } catch (err) {
      console.warn("Download failed:", err);
      toast.error("Could not download");
    } finally {
      setIsDownloading(false);
      setTimeout(() => {
        downloadCloseGuardRef.current = false;
      }, 750);
    }
  };

  const handleDialogOpenChange = (open: boolean) => {
    if (open) return;
    // Web downloads create/click a temporary anchor outside the Radix dialog.
    // Radix can treat that synthetic outside interaction as a dismiss request;
    // keep the lightbox open unless the user explicitly taps Back/swipes down.
    if (downloadCloseGuardRef.current) return;
    onClose();
  };

  const handleShare = async () => {
    if (!currentPhoto?.id) {
      toast.error("Nothing to share");
      return;
    }
    const { gateShareWithPro } = await import("@/lib/proShareGate");
    const allowed = await gateShareWithPro({
      teamId: currentPhoto.team_id ?? null,
      clubId: currentPhoto.club_id ?? null,
      navigate,
      featureLabel: "Photo sharing",
    });
    if (!allowed) return;
    const { getShareUrl } = await import("@/lib/shareUtils");
    const url = getShareUrl("photo", currentPhoto.id);
    const title = currentPhoto.title || "Photo";

    try {
      const { Capacitor } = await import("@capacitor/core");
      if (Capacitor.isNativePlatform()) {
        const { Share } = await import("@capacitor/share");
        await Share.share({ title, text: title, url, dialogTitle: "Share photo" });
        return;
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if (/cancel|abort/i.test(message)) return;
      console.warn("Native share failed:", err);
    }

    try {
      const webNavigator = navigator as Navigator & { share?: (data: ShareData) => Promise<void> };
      if (typeof navigator !== "undefined" && typeof webNavigator.share === "function") {
        await webNavigator.share({ title, text: title, url });
        return;
      }
    } catch (err: unknown) {
      const message = getErrorMessage(err);
      if ((err instanceof DOMException && err.name === "AbortError") || /cancel|abort/i.test(message)) return;
      console.warn("Web share failed:", err);
    }

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        toast.success("Link copied to clipboard");
        return;
      }
    } catch (err) {
      console.warn("Clipboard write failed:", err);
    }
    try {
      const ta = document.createElement("textarea");
      ta.value = url;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
      toast.success("Link copied to clipboard");
      return;
    } catch (err) {
      console.warn("execCommand copy failed:", err);
    }

    safeOpenUrl(url);
  };

  const confirmDelete = () => {
    if (onDelete && currentPhoto) {
      onDelete(currentPhoto.id);
    }
    setDeleteConfirmOpen(false);
  };

  const showDots = photos.length > 1 && photos.length < 10;
  const showCounter = photos.length >= 10;

  return (
    <>
    <Dialog open={isOpen} onOpenChange={handleDialogOpenChange}>
      <DialogContent
        className="!max-w-none !max-h-none !w-screen !h-[100dvh] p-0 bg-black border-none rounded-none [&>button]:hidden !translate-x-[-50%] !translate-y-[-50%]"
        onKeyDown={handleKeyDown}
        style={{ backgroundColor: `rgba(0,0,0,${dismissOpacity})` }}
      >
        <VisuallyHidden>
          <DialogTitle>Photo viewer</DialogTitle>
        </VisuallyHidden>
        <div
          className="relative w-full h-full flex items-center justify-center overflow-hidden"
          style={{ touchAction: 'none' }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onClick={handleClick}
        >
          {/* Top toolbar — auto-hides, fades smoothly */}
          <div
            data-lightbox-control
            className={`absolute top-0 left-0 right-0 z-50 flex items-center justify-between px-3 pb-4 bg-gradient-to-b from-black/60 to-transparent transition-opacity duration-300 ${
              controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
            }`}
            style={{ paddingTop: "calc(max(env(safe-area-inset-top), 1.75rem) + 0.5rem)" }}
          >
            <Button
              data-lightbox-control
              variant="ghost"
              size="icon"
              className="text-white hover:bg-white/15 bg-white/10 backdrop-blur-md rounded-full h-10 w-10"
              onClick={(e) => { e.stopPropagation(); onClose(); }}
              aria-label="Back"
            >
              <ArrowLeft className="h-5 w-5" />
            </Button>

            <div
              data-lightbox-control
              className="flex items-center gap-2 touch-auto"
              onTouchStart={(e) => e.stopPropagation()}
              onTouchMove={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
            >
              <Button
                data-lightbox-control
                variant="ghost"
                size="icon"
                disabled={isDownloading}
                className="text-white hover:bg-white/15 bg-white/10 backdrop-blur-md rounded-full h-10 w-10 disabled:opacity-60"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); if (!isDownloading) handleDownload(); }}
                aria-label="Download photo"
              >
                {isDownloading ? (
                  <div className="h-4 w-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                ) : (
                  <Download className="h-5 w-5" />
                )}
              </Button>
              <Button
                data-lightbox-control
                variant="ghost"
                size="icon"
                className="text-white hover:bg-white/15 bg-white/10 backdrop-blur-md rounded-full h-10 w-10"
                onClick={(e) => { e.stopPropagation(); handleShare(); }}
                aria-label="Share photo"
              >
                <Share2 className="h-[1.05rem] w-[1.05rem]" />
              </Button>
              <DropdownMenu modal={false} open={menuOpen} onOpenChange={setMenuOpen}>
                <DropdownMenuTrigger asChild>
                  <Button
                    data-lightbox-control
                    variant="ghost"
                    size="icon"
                    className="text-white hover:bg-white/15 bg-white/10 backdrop-blur-md rounded-full h-10 w-10"
                    aria-label="More options"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <MoreVertical className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" sideOffset={8} className="z-[1000002] min-w-[180px]">
                  <DropdownMenuItem
                    onSelect={() => {
                      setMenuOpen(false);
                      setReportPhotoId(currentPhoto.id);
                      onClose();
                    }}
                  >
                    <Flag className="h-4 w-4 mr-2" />
                    Report
                  </DropdownMenuItem>
                  {canDelete && onDelete && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        onSelect={() => { setMenuOpen(false); setDeleteConfirmOpen(true); }}
                        className="text-destructive focus:text-destructive focus:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {/* Nav buttons — auto-hide with controls */}
          {currentIndex > 0 && (
            <Button
              data-lightbox-control
              variant="ghost"
              size="icon"
              className={`absolute left-2 z-50 h-14 w-14 text-white hover:bg-transparent bg-transparent rounded-full touch-auto p-0 transition-opacity duration-300 ${
                controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              onClick={(e) => { e.stopPropagation(); handlePrev(); }}
              aria-label="Previous photo"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md">
                <ChevronLeft className="h-6 w-6" />
              </span>
            </Button>
          )}

          {currentIndex < photos.length - 1 && (
            <Button
              data-lightbox-control
              variant="ghost"
              size="icon"
              className={`absolute right-2 z-50 h-14 w-14 text-white hover:bg-transparent bg-transparent rounded-full touch-auto p-0 transition-opacity duration-300 ${
                controlsVisible ? "opacity-100" : "opacity-0 pointer-events-none"
              }`}
              onClick={(e) => { e.stopPropagation(); handleNext(); }}
              aria-label="Next photo"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/10 backdrop-blur-md">
                <ChevronRight className="h-6 w-6" />
              </span>
            </Button>
          )}

          <LightboxImage
            src={photoSrc}
            poster={
              isVideoUrl(photoSrc) && currentPhoto.image_url && !isVideoUrl(currentPhoto.image_url)
                ? currentPhoto.image_url
                : undefined
            }
            alt={currentPhoto.title || "Photo"}
            scale={scale}
            translateX={translateX}
            translateY={translateY}
            dismissOffset={dismissOffset}
          />

          {/* Bottom indicator — dots for small sets, counter for big */}
          {(showDots || showCounter) && (
            <div
              data-lightbox-control
              className={`absolute left-1/2 -translate-x-1/2 transition-opacity duration-300 ${
                controlsVisible ? "opacity-100" : "opacity-0"
              }`}
              style={{ bottom: "calc(env(safe-area-inset-bottom) + 0.75rem)" }}
            >
              {showDots ? (
                <div className="flex items-center gap-1.5 px-3 py-2 rounded-full bg-black/35 backdrop-blur-md">
                  {photos.map((_, i) => (
                    <span
                      key={i}
                      className={`block rounded-full transition-all duration-200 ${
                        i === currentIndex
                          ? "w-2 h-2 bg-white"
                          : "w-1.5 h-1.5 bg-white/45"
                      }`}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-white text-[13px] font-medium tracking-wide px-3 py-1 bg-black/45 backdrop-blur-md rounded-full tabular-nums">
                  {currentIndex + 1} / {photos.length}
                </div>
              )}
            </div>
          )}
        </div>
      </DialogContent>

    </Dialog>

    <ReportPhotoDialog
      isOpen={!!reportPhotoId}
      onClose={() => setReportPhotoId(null)}
      photoId={reportPhotoId || ""}
    />

    <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this photo?</AlertDialogTitle>
          <AlertDialogDescription>
            Are you sure you want to delete this photo? This action cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={confirmDelete}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  );
}