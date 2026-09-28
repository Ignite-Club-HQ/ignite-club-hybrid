import { useState, useRef, useCallback, useEffect } from "react";
import { Upload, Image, FileText, Loader2, X, File as FileIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { Capacitor } from "@capacitor/core";
import { toast } from "sonner";
import { isCancelledSelectionError, getReadableUploadError } from "@/lib/uploadErrorUtils";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import {
  isIOSEnvironment,
  scheduleIOSNativeOverlayRecovery,
  temporarilyReleaseBodyScrollLock,
} from "@/lib/iosNativeOverlayRecovery";

interface UploadFilesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpload: (file: File, type: "photo" | "file", fileName?: string) => void | Promise<void>;
  isUploading?: boolean;
  targetName: string;
}

export function UploadFilesDialog({
  open,
  onOpenChange,
  onUpload,
  isUploading = false,
  targetName,
}: UploadFilesDialogProps) {
  const [uploadType, setUploadType] = useState<"photo" | "file">("photo");
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileName, setFileName] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isPickingNativePhoto, setIsPickingNativePhoto] = useState(false);
  const [isSubmittingUpload, setIsSubmittingUpload] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const platform = Capacitor.getPlatform();
  const isNativeIOS = Capacitor.isNativePlatform() && platform === "ios";
  const shouldStabilizeIOSLayout = isIOSEnvironment();
  const shouldUseNativePhotoPicker = uploadType === "photo" && shouldUseNativePicker();
  const recoveryCleanupRef = useRef<(() => void) | null>(null);
  const nativePickerInFlightRef = useRef(false);
  const wasOpenRef = useRef(open);

  const queueNativeLayoutRecovery = useCallback((delaysMs: readonly number[] = [0, 320, 1100, 1800]) => {
    if (!shouldStabilizeIOSLayout) return;
    recoveryCleanupRef.current?.();
    recoveryCleanupRef.current = scheduleIOSNativeOverlayRecovery(delaysMs);
  }, [shouldStabilizeIOSLayout]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      recoveryCleanupRef.current?.();
    };
  }, []);

  const clearSelection = useCallback(() => {
    setSelectedFile(null);
    setPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
      }
      return null;
    });
    setFileName("");
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  }, []);

  const handleFileSelect = (file: File) => {
    setSelectedFile(file);

    // Create preview for images
    setPreviewUrl((currentPreviewUrl) => {
      if (currentPreviewUrl) {
        URL.revokeObjectURL(currentPreviewUrl);
      }

      if (file.type.startsWith("image/")) {
        return URL.createObjectURL(file);
      }

      return null;
    });

    // Set default filename for files
    if (uploadType === "file" && !fileName) {
      const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
      setFileName(nameWithoutExt);
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    if (file) {
      handleFileSelect(file);
      queueNativeLayoutRecovery();
    }

    // Allow selecting the same file again in the same dialog session.
    input.value = "";
  };

  useEffect(() => {
    if (wasOpenRef.current && !open) {
      clearSelection();
      setUploadType("photo");
      setIsSubmittingUpload(false);
      queueNativeLayoutRecovery();
    }

    wasOpenRef.current = open;
  }, [clearSelection, open, queueNativeLayoutRecovery]);

  useEffect(() => {
    if (!open || !shouldStabilizeIOSLayout || typeof window === "undefined" || typeof document === "undefined") {
      return;
    }

    const handleLayoutResume = () => {
      if (document.visibilityState === "hidden") return;
      queueNativeLayoutRecovery([0, 320, 1200]);
    };

    window.addEventListener("focus", handleLayoutResume);
    window.addEventListener("pageshow", handleLayoutResume);
    document.addEventListener("visibilitychange", handleLayoutResume);

    return () => {
      window.removeEventListener("focus", handleLayoutResume);
      window.removeEventListener("pageshow", handleLayoutResume);
      document.removeEventListener("visibilitychange", handleLayoutResume);
    };
  }, [open, queueNativeLayoutRecovery, shouldStabilizeIOSLayout]);

  const handleNativePhotoPick = async () => {
    if (
      !shouldUseNativePhotoPicker ||
      isUploading ||
      isPickingNativePhoto ||
      isSubmittingUpload ||
      nativePickerInFlightRef.current
    ) {
      return;
    }

    nativePickerInFlightRef.current = true;
    console.log("[UploadFilesDialog] handleNativePhotoPick START");
    const restoreBodyScrollLock = temporarilyReleaseBodyScrollLock();

    try {
      // Use shared native picker with resilient Base64 → URI fallback
      const result = await pickNativePhoto({ quality: 80 });
      console.log("[UploadFilesDialog] pickNativePhoto OK, blob size:", result.blob.size, "mime:", result.mimeType);

      // Stabilize BottomNav immediately once picker returns, before blob work.
      queueNativeLayoutRecovery([0, 260, 900, 1700]);
      setIsPickingNativePhoto(true);

      const { blob, mimeType, extension } = result;
      const file = new File([blob], `photo-${Date.now()}.${extension}`, {
        type: mimeType,
        lastModified: Date.now(),
      });

      handleFileSelect(file);
      queueNativeLayoutRecovery([0, 380, 1200]);
    } catch (error) {
      if (isCancelledSelectionError(error)) {
        console.log("[UploadFilesDialog] user cancelled");
      } else {
        const errMsg = getReadableUploadError(error);
        console.warn("[UploadFilesDialog] Native picker failed:", errMsg, error);
        toast.error(errMsg || "Could not load photo. Please try again.");
      }
    } finally {
      restoreBodyScrollLock();
      queueNativeLayoutRecovery([0, 420, 1400, 2200]);
      nativePickerInFlightRef.current = false;
      setIsPickingNativePhoto(false);
    }
  };

  const handleUploadAreaClick = () => {
    if (shouldUseNativePhotoPicker) {
      void handleNativePhotoPick();
    } else {
      // For non-native: trigger the hidden file input manually
      fileInputRef.current?.click();
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    const file = e.dataTransfer.files?.[0];
    if (file) {
      // Update type based on dropped file
      if (file.type.startsWith("image/")) {
        setUploadType("photo");
      } else {
        setUploadType("file");
      }
      handleFileSelect(file);
      queueNativeLayoutRecovery();
    }
  };

  const handleUpload = async () => {
    if (!selectedFile || isUploading || isSubmittingUpload) return;

    setIsSubmittingUpload(true);
    queueNativeLayoutRecovery([0, 260, 900]);

    try {
      await onUpload(selectedFile, uploadType, uploadType === "file" ? fileName : undefined);
      clearSelection();
    } finally {
      setIsSubmittingUpload(false);
      queueNativeLayoutRecovery([0, 420, 1400]);
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      clearSelection();
      setUploadType("photo");
      setIsSubmittingUpload(false);
      queueNativeLayoutRecovery([0, 320, 1200]);
    }
    onOpenChange(newOpen);
  };

  const formatFileSize = (bytes: number) => {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={handleOpenChange} forceDesktopDialog={isNativeIOS}>
      <ResponsiveDialogContent className="sm:max-w-md">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle>Upload to {targetName}</ResponsiveDialogTitle>
        </ResponsiveDialogHeader>

        <div className="py-4 space-y-4">
          {/* Type Selector */}
          <div className="flex gap-2">
            <Button
              variant={uploadType === "photo" ? "default" : "outline"}
              onClick={() => {
                setUploadType("photo");
                clearSelection();
              }}
              className="flex-1"
            >
              <Image className="h-4 w-4 mr-2" /> Photo
            </Button>
            <Button
              variant={uploadType === "file" ? "default" : "outline"}
              onClick={() => {
                setUploadType("file");
                clearSelection();
              }}
              className="flex-1"
            >
              <FileText className="h-4 w-4 mr-2" /> File
            </Button>
          </div>

          {/* Upload Area */}
          {!selectedFile ? (
            <div
              className={cn("block cursor-pointer", (isUploading || isPickingNativePhoto || isSubmittingUpload) && "pointer-events-none opacity-70")}
              onClick={handleUploadAreaClick}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              role="button"
              tabIndex={0}
            >
              <div
                className={cn(
                  "aspect-[4/3] rounded-2xl border-2 border-dashed flex flex-col items-center justify-center gap-4 transition-all",
                  isDragging
                    ? "border-primary bg-primary/5 scale-[1.02]"
                    : "border-muted-foreground/25 bg-muted/50 hover:border-muted-foreground/50 hover:bg-muted"
                )}
              >
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  {isPickingNativePhoto ? (
                    <Loader2 className="h-8 w-8 text-primary animate-spin" />
                  ) : (
                    <Upload className="h-8 w-8 text-primary" />
                  )}
                </div>
                <div className="text-center px-4">
                  <p className="font-medium">
                    {isPickingNativePhoto
                      ? "Opening photo library..."
                      : isDragging
                        ? `Drop ${uploadType === "photo" ? "photo" : "file"} here`
                        : `Tap to select ${uploadType === "photo" ? "photo" : "file"}`}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    or drag and drop
                  </p>
                </div>
              </div>
              {/* Hidden file input – used as primary on non-native, fallback on native */}
              <input
                  ref={fileInputRef}
                  type="file"
                    accept={
                    uploadType === "photo"
                      ? "image/*"
                      : Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios"
                        ? "application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-powerpoint,application/vnd.openxmlformats-officedocument.presentationml.presentation,text/plain,text/csv,application/zip,application/x-rar-compressed,application/json,application/xml,text/xml,text/yaml,application/x-yaml,text/markdown"
                        : Capacitor.isNativePlatform()
                          ? ".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.rar,.mp4,.mp3,.wav,.mov,.json,.xml,.yaml,.md"
                          : "*"
                  }
                  className="sr-only"
                  onChange={handleInputChange}
                  disabled={isUploading || isPickingNativePhoto || isSubmittingUpload}
                />
            </div>
          ) : (
            <div className="space-y-4">
              {/* Preview */}
              <div className="relative rounded-2xl overflow-hidden bg-muted">
                {previewUrl ? (
                  <img
                    src={previewUrl}
                    alt="Preview"
                    className="w-full aspect-[4/3] object-cover"
                  />
                ) : (
                  <div className="w-full aspect-[4/3] flex flex-col items-center justify-center gap-3">
                    <FileIcon className="h-16 w-16 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground font-medium">
                      {selectedFile.name}
                    </p>
                  </div>
                )}
                <Button
                  variant="secondary"
                  size="icon"
                  className="absolute top-2 right-2 h-8 w-8 rounded-full bg-background/80 backdrop-blur-sm"
                  onClick={clearSelection}
                  disabled={isUploading || isPickingNativePhoto || isSubmittingUpload}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              {/* File Info */}
              <div className="flex items-center justify-between text-sm px-1">
                <span className="text-muted-foreground truncate max-w-[60%]">
                  {selectedFile.name}
                </span>
                <span className="text-muted-foreground">
                  {formatFileSize(selectedFile.size)}
                </span>
              </div>

              {/* File Name Input (for files only) */}
              {uploadType === "file" && (
                <div className="space-y-2">
                  <Label>Display Name</Label>
                  <Input
                    value={fileName}
                    onChange={(e) => setFileName(e.target.value)}
                    placeholder="Enter file name"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="gap-2 sm:gap-0">
          <Button
            variant="outline"
            onClick={() => handleOpenChange(false)}
            className="flex-1 sm:flex-none"
            disabled={isUploading || isPickingNativePhoto || isSubmittingUpload}
          >
            Cancel
          </Button>
          <Button
            onClick={handleUpload}
            disabled={!selectedFile || isUploading || isPickingNativePhoto || isSubmittingUpload}
            className="flex-1 sm:flex-none"
          >
            {(isUploading || isSubmittingUpload) ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Uploading...
              </>
            ) : (
              <>
                <Upload className="h-4 w-4 mr-2" />
                Upload
              </>
            )}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
