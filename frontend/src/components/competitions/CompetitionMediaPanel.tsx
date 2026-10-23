import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, Trash2, Play, X, ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { compressImage } from "@/lib/imageCompression";
import { pickNativePhoto, shouldUseNativePicker } from "@/lib/nativePhotoPicker";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const VIDEO_EXT = /\.(mp4|mov|m4v|webm|3gp|avi)(\?|$)/i;

interface Props {
  competitionId: string;
  organizerClubId: string | null;
  canManage: boolean;
}

interface MediaRow {
  id: string;
  uploader_id: string;
  image_url: string;
  file_url: string | null;
  created_at: string;
}

const isVideo = (m: MediaRow) => VIDEO_EXT.test(m.file_url || m.image_url);

const storagePathFromUrl = (url: string): string | null => {
  const marker = "/object/public/photos/";
  const i = url.indexOf(marker);
  return i >= 0 ? decodeURIComponent(url.slice(i + marker.length).split("?")[0]) : null;
};

export default function CompetitionMediaPanel({ competitionId, canManage }: Props) {
  const { user } = useAuth();
  const { toast } = useToast();
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<MediaRow | null>(null);
  const queryKey = ["competition-media", competitionId];

  const { data: isMember = false } = useQuery({
    queryKey: ["competition-media-member", competitionId, user?.id],
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.rpc as any)("is_competition_member", {
        _user_id: user!.id,
        _competition_id: competitionId,
      });
      if (error) throw error;
      return !!data;
    },
  });

  const { data: media = [], isLoading } = useQuery({
    queryKey,
    enabled: !!user,
    queryFn: async () => {
      const { data, error } = await (supabase.from("photos") as any)
        .select("id, uploader_id, image_url, file_url, created_at")
        .eq("competition_id", competitionId)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []) as MediaRow[];
    },
  });

  const upload = async (blob: Blob, ext: string, contentType: string, video: boolean) => {
    if (!user) return;
    setUploading(true);
    try {
      const path = `competitions/${competitionId}/${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("photos")
        .upload(path, blob, { contentType, upsert: false });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("photos").getPublicUrl(path);
      const url = pub.publicUrl;
      const { error: insErr } = await (supabase.from("photos") as any).insert({
        competition_id: competitionId,
        uploader_id: user.id,
        image_url: url,
        file_url: url,
        file_size: blob.size,
        show_in_feed: false,
      });
      if (insErr) {
        await supabase.storage.from("photos").remove([path]);
        throw insErr;
      }
      toast({ title: video ? "Video added" : "Photo added" });
      qc.invalidateQueries({ queryKey });
    } catch (e: any) {
      toast({ title: "Upload failed", description: e?.message || String(e), variant: "destructive" });
    } finally {
      setUploading(false);
    }
  };

  // Native: Camera plugin must be invoked synchronously inside the tap handler.
  const handleAdd = () => {
    if (shouldUseNativePicker()) {
      pickNativePhoto()
        .then(async (res) => {
          const file = new File([res.blob], `photo.${res.extension}`, { type: res.mimeType });
          const { file: out } = await compressImage(file);
          const ext = out.type === "image/png" ? "png" : out.type.includes("jpeg") ? "jpg" : res.extension;
          await upload(out, ext, out.type || res.mimeType, false);
        })
        .catch((e: any) => {
          if (String(e?.message || "").includes("cancelled")) return;
          toast({ title: "Couldn't open photos", description: e?.message, variant: "destructive" });
        });
      return;
    }
    inputRef.current?.click();
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const ext = (file.name.split(".").pop() || "").toLowerCase();
    if (file.type.startsWith("video/")) {
      if (file.size > MAX_VIDEO_BYTES) {
        toast({ title: "Video too large", description: "Videos must be under 200MB.", variant: "destructive" });
        return;
      }
      await upload(file, ext || "mp4", file.type, true);
      return;
    }
    if (!file.type.startsWith("image/")) {
      toast({ title: "Unsupported file", description: "Choose a photo or video.", variant: "destructive" });
      return;
    }
    const { file: out } = await compressImage(file);
    const outExt = out.type.includes("jpeg") ? "jpg" : out.type === "image/png" ? "png" : ext || "jpg";
    await upload(out, outExt, out.type || file.type, false);
  };

  const handleDelete = async (m: MediaRow) => {
    if (!confirm("Delete this item?")) return;
    const { error } = await (supabase.from("photos") as any).delete().eq("id", m.id);
    if (error) {
      toast({ title: "Couldn't delete", description: error.message, variant: "destructive" });
      return;
    }
    const path = storagePathFromUrl(m.file_url || m.image_url);
    if (path) await supabase.storage.from("photos").remove([path]);
    setViewing(null);
    qc.invalidateQueries({ queryKey });
  };

  const canDelete = (m: MediaRow) => canManage || m.uploader_id === user?.id;

  if (!isLoading && !isMember && !canManage && media.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        Media is only available to teams entered in this competition.
      </p>
    );
  }

  return (
    <div className="space-y-3 mt-2">
      {isMember && (
        <div className="flex justify-end">
          <Button size="sm" onClick={handleAdd} disabled={uploading}>
            {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Plus className="h-4 w-4 mr-1" />}
            Add
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFile}
          />
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>
      ) : media.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-10 text-muted-foreground">
          <ImageIcon className="h-8 w-8" />
          <p className="text-sm">No photos or videos yet.</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-1">
          {media.map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setViewing(m)}
              className="relative aspect-square overflow-hidden rounded-md bg-muted"
            >
              {isVideo(m) ? (
                <>
                  <video src={`${m.file_url || m.image_url}#t=0.1`} preload="metadata" muted playsInline className="h-full w-full object-cover" />
                  <span className="absolute inset-0 flex items-center justify-center">
                    <Play className="h-8 w-8 text-primary-foreground drop-shadow" />
                  </span>
                </>
              ) : (
                <img src={m.image_url} alt="" loading="lazy" className="h-full w-full object-cover" />
              )}
            </button>
          ))}
        </div>
      )}

      <Dialog open={!!viewing} onOpenChange={(o) => !o && setViewing(null)}>
        <DialogContent className="max-w-none w-screen h-[100dvh] p-0 border-0 bg-background flex items-center justify-center [&>button]:hidden">
          {viewing && (
            <>
              <div className="absolute top-3 right-3 z-10 flex gap-2" style={{ marginTop: "env(safe-area-inset-top)" }}>
                {canDelete(viewing) && (
                  <Button size="icon" variant="destructive" onClick={() => handleDelete(viewing)} aria-label="Delete">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
                <Button size="icon" variant="secondary" onClick={() => setViewing(null)} aria-label="Close">
                  <X className="h-4 w-4" />
                </Button>
              </div>
              {isVideo(viewing) ? (
                <video src={viewing.file_url || viewing.image_url} controls autoPlay playsInline className="max-h-full max-w-full" />
              ) : (
                <img src={viewing.image_url} alt="" className="max-h-full max-w-full object-contain" />
              )}
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
