import { useEffect, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { compressImage } from "@/lib/imageCompression";
import { withFeatureBackend } from "@/live/featureRouter";
import { registerLiveAsset, setLiveAssetScope } from "@/live/features/media";
import { tryUploadMediaToBlobStore } from "@/live/mediaUpload";
import { mimeToExtension } from "@/lib/binaryUtils";

export interface IcpUploadClubOption {
  id: string;
  name: string;
}
export interface IcpUploadTeamOption {
  id: string;
  name: string;
  club_id: string;
}
export interface IcpUploadNamedOption {
  id: string;
  name: string;
  club_id: string;
}

interface IcpUploadPhotoSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploaded: () => void;
  clubs: IcpUploadClubOption[];
  teams: IcpUploadTeamOption[];
  miniLeagues: IcpUploadNamedOption[];
  competitions: IcpUploadNamedOption[];
  defaultClubId?: string;
}

const SCOPE_UNSUPPORTED = /set_asset_scope|has no update method|not found/i;

export function IcpUploadPhotoSheet({
  open,
  onOpenChange,
  onUploaded,
  clubs,
  teams,
  miniLeagues,
  competitions,
  defaultClubId,
}: IcpUploadPhotoSheetProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [caption, setCaption] = useState("");
  const [clubId, setClubId] = useState<string>("");
  const [teamId, setTeamId] = useState<string>("");
  const [miniLeagueId, setMiniLeagueId] = useState<string>("");
  const [competitionId, setCompetitionId] = useState<string>("");
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0 });

  useEffect(() => {
    if (!open) return;
    setClubId((prev) => prev || defaultClubId || clubs[0]?.id || "");
  }, [open, defaultClubId, clubs]);

  useEffect(() => {
    if (!open) {
      setFiles([]);
      setCaption("");
      setTeamId("");
      setMiniLeagueId("");
      setCompetitionId("");
      setUploading(false);
      setProgress({ done: 0, total: 0 });
    }
  }, [open]);

  const clubTeams = teams.filter((t) => t.club_id === clubId);
  const clubMiniLeagues = miniLeagues.filter((m) => m.club_id === clubId);
  const clubCompetitions = competitions.filter((c) => c.club_id === clubId);

  const handleFiles = (list: FileList | null) => {
    if (!list) return;
    const next = Array.from(list).filter(
      (f) => f.type.startsWith("image/") || f.type.startsWith("video/"),
    );
    if (next.length === 0) {
      toast.error("Pick photos or videos");
      return;
    }
    setFiles((prev) => [...prev, ...next].slice(0, 10));
  };

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpload = async () => {
    if (files.length === 0) {
      toast.error("Add at least one photo or video");
      return;
    }
    if (!clubId) {
      toast.error("Pick a club");
      return;
    }
    setUploading(true);
    setProgress({ done: 0, total: files.length });
    // Multi-photo uploads form one album post, like the Supabase gallery.
    const albumId = files.length > 1 ? crypto.randomUUID() : null;
    const trimmedCaption = caption.trim() || null;
    let scopePending = false;
    try {
      await withMediaBackend({
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: async (ctx) => {
          for (let i = 0; i < files.length; i++) {
            const raw = files[i];
            const isVideo = raw.type.startsWith("video/");
            const prepared = isVideo ? { file: raw } : await compressImage(raw);
            const uploaded = await tryUploadMediaToBlobStore(ctx, prepared.file, clubId);
            if (!uploaded) {
              throw new Error("Media upload canisters are not configured");
            }
            const asset = await registerLiveAsset(ctx, {
              clubId,
              kind: isVideo ? "video" : "photo",
              mime: prepared.file.type || raw.type || "application/octet-stream",
              checksum: uploaded.blobRef.content_hash,
              storagePath: uploaded.url,
              visibility: "club_members",
              contentLength: prepared.file.size,
              blobRef: uploaded.blobRef,
            });
            try {
              await setLiveAssetScope(ctx, asset.id, {
                teamId: teamId || null,
                miniLeagueId: miniLeagueId || null,
                competitionId: competitionId || null,
                eventId: null,
                caption: trimmedCaption,
                albumId,
              });
            } catch (err) {
              if (SCOPE_UNSUPPORTED.test(String(err))) {
                // Deployed canister predates set_asset_scope; tags apply
                // after the media_metadata redeploy.
                scopePending = true;
              } else {
                throw err;
              }
            }
            setProgress({ done: i + 1, total: files.length });
          }
        },
      });
      toast.success(
        files.length > 1 ? `${files.length} photos shared` : "Photo shared",
      );
      if (scopePending) {
        toast.info(
          "Tags and captions will appear after the media backend update is deployed.",
        );
      }
      onOpenChange(false);
      onUploaded();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={(v) => !uploading && onOpenChange(v)}>
      <SheetContent side="bottom" className="max-h-[90vh] overflow-y-auto rounded-t-2xl">
        <SheetHeader>
          <SheetTitle>Add photos</SheetTitle>
        </SheetHeader>
        <div className="mt-4 space-y-4">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*,video/*"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-border py-8 text-muted-foreground"
          >
            <ImagePlus className="h-8 w-8" />
            <span className="text-sm">Tap to pick photos or videos</span>
          </button>
          {files.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {files.map((file, i) => (
                <div key={`${file.name}-${i}`} className="relative aspect-square overflow-hidden rounded-lg bg-muted">
                  {file.type.startsWith("video/") ? (
                    <video
                      src={URL.createObjectURL(file)}
                      className="h-full w-full object-cover"
                      muted
                    />
                  ) : (
                    <img
                      src={URL.createObjectURL(file)}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => removeFile(i)}
                    className="absolute right-1 top-1 rounded-full bg-background/80 p-1"
                    aria-label="Remove"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <Input
            value={caption}
            onChange={(e) => setCaption(e.target.value.slice(0, 200))}
            placeholder="Caption (optional)"
          />

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">Club</p>
            <div className="flex flex-wrap gap-2">
              {clubs.map((club) => (
                <Button
                  key={club.id}
                  type="button"
                  size="sm"
                  variant={clubId === club.id ? "default" : "outline"}
                  onClick={() => {
                    setClubId(club.id);
                    setTeamId("");
                    setMiniLeagueId("");
                    setCompetitionId("");
                  }}
                >
                  {club.name}
                </Button>
              ))}
            </div>
          </div>

          {clubTeams.length > 0 && miniLeagueId === "" && competitionId === "" && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Team (optional)</p>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  variant={teamId === "" ? "default" : "outline"}
                  onClick={() => setTeamId("")}
                >
                  All of club
                </Button>
                {clubTeams.map((team) => (
                  <Button
                    key={team.id}
                    type="button"
                    size="sm"
                    variant={teamId === team.id ? "default" : "outline"}
                    onClick={() => setTeamId(team.id)}
                  >
                    {team.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {clubMiniLeagues.length > 0 && teamId === "" && competitionId === "" && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Mini league (optional)</p>
              <div className="flex flex-wrap gap-2">
                {clubMiniLeagues.map((ml) => (
                  <Button
                    key={ml.id}
                    type="button"
                    size="sm"
                    variant={miniLeagueId === ml.id ? "default" : "outline"}
                    onClick={() => setMiniLeagueId(miniLeagueId === ml.id ? "" : ml.id)}
                  >
                    {ml.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          {clubCompetitions.length > 0 && teamId === "" && miniLeagueId === "" && (
            <div className="space-y-1.5">
              <p className="text-xs font-medium text-muted-foreground">Competition (optional)</p>
              <div className="flex flex-wrap gap-2">
                {clubCompetitions.map((comp) => (
                  <Button
                    key={comp.id}
                    type="button"
                    size="sm"
                    variant={competitionId === comp.id ? "default" : "outline"}
                    onClick={() => setCompetitionId(competitionId === comp.id ? "" : comp.id)}
                  >
                    {comp.name}
                  </Button>
                ))}
              </div>
            </div>
          )}

          <Button
            className="w-full"
            disabled={uploading || files.length === 0 || !clubId}
            onClick={handleUpload}
          >
            {uploading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Uploading {progress.done}/{progress.total}…
              </>
            ) : (
              `Share ${files.length > 1 ? `${files.length} photos` : "photo"}`
            )}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
