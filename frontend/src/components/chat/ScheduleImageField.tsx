import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import {
  uploadScheduledImage,
  ScheduledUploadTarget,
} from "./scheduledMessageUpload";

interface ScheduleImageFieldProps {
  value: string | null;
  onChange: (url: string | null) => void;
  uploadTarget: ScheduledUploadTarget;
  disabled?: boolean;
}

/**
 * Inline image picker for the schedule-message dialog. Mirrors the
 * chat-attachments storage layout so the worker can deliver the URL as-is.
 */
export function ScheduleImageField({
  value,
  onChange,
  uploadTarget,
  disabled,
}: ScheduleImageFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const url = await uploadScheduledImage(file, uploadTarget);
      onChange(url);
    } catch (err: any) {
      console.error("[ScheduleImageField] upload failed", err);
      toast.error(err?.message || "Failed to upload image");
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-2">
      <Label>Attachment (optional)</Label>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="sr-only"
        onChange={handleFile}
        disabled={disabled || uploading}
      />
      {value ? (
        <div className="flex items-center gap-3">
          <div className="relative">
            <img
              src={value}
              alt="Scheduled attachment"
              className="h-20 w-20 object-cover rounded-md border border-border"
            />
            <button
              type="button"
              onClick={() => onChange(null)}
              disabled={disabled || uploading}
              className="absolute -top-2 -right-2 h-6 w-6 rounded-full bg-destructive text-destructive-foreground flex items-center justify-center shadow-sm"
              aria-label="Remove image"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => inputRef.current?.click()}
            disabled={disabled || uploading}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              "Replace"
            )}
          </Button>
        </div>
      ) : (
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || uploading}
          className="gap-2"
        >
          {uploading ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              Uploading…
            </>
          ) : (
            <>
              <ImagePlus className="h-4 w-4" />
              Add image
            </>
          )}
        </Button>
      )}
    </div>
  );
}
