import { useEffect, useRef, useState } from "react";
import { Check, ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compressImage } from "@/lib/imageCompression";
import { cn } from "@/lib/utils";
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
      await withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: async (ctx) => {
          for (let i = 0; i < files.length; i++) {
            const raw = files[i];
            const isVideo = raw.type.startsWith("video/");
            const prepared = isVideo ? { file: raw } : await compressImage(raw);
            const mime = prepared.file.type || raw.type || "application/octet-stream";
            // The clubs/<clubId>/ prefix is what grantLiveClubPiiRead matches
            // to give club members decrypt access. Keep the path short: the
            // media_metadata canister validates storage_path length, and an
            // Internet Identity principal in the path pushes it over the
            // limit (register_asset fails with "Invalid asset").
            const storagePath = `clubs/${clubId}/${Date.now()}-${Math.random()
              .toString(36)
              .slice(2, 10)}.${mimeToExtension(mime)}`;
            const uploaded = await tryUploadMediaToBlobStore({
              storagePath,
              file: prepared.file,
              mime,
            });
            if (!uploaded) {
              throw new Error("Media upload canisters are not configured");
            }
            const asset = await registerLiveAsset(ctx, {
              clubId,
              kind: isVideo ? "video" : "photo",
              mime,
              checksum: uploaded.blobRef.content_hash,
              storagePath: uploaded.blobRef.path,
              visibility: "club",
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

          {/* Club Selection — same row style as the Supabase upload sheet */}
          <div className="space-y-3">
            <Label className="text-sm font-medium flex items-center gap-2">
              Select Club <span className="text-destructive">*</span>
            </Label>
            <div className="grid gap-2">
              {clubs.map((club) => (
                <button
                  key={club.id}
                  type="button"
                  disabled={uploading}
                  onClick={() => {
                    setClubId(club.id);
                    setTeamId("");
                    setMiniLeagueId("");
                    setCompetitionId("");
                  }}
                  className={cn(
                    "flex items-center justify-between p-4 rounded-xl border-2 transition-all text-left w-full",
                    clubId === club.id
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-muted-foreground/50",
                    uploading && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <div className="flex items-center gap-3">
                    <div
                      className={cn(
                        "h-10 w-10 rounded-full flex items-center justify-center text-lg font-semibold",
                        clubId === club.id
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {club.name.charAt(0).toUpperCase()}
                    </div>
                    <p className="font-medium">{club.name}</p>
                  </div>
                  {clubId === club.id && (
                    <div className="h-6 w-6 rounded-full bg-primary flex items-center justify-center">
                      <Check className="h-4 w-4 text-primary-foreground" />
                    </div>
                  )}
                </button>
              ))}
            </div>
          </div>

          {/* Team Selection */}
          {clubId && clubTeams.length > 0 && miniLeagueId === "" && competitionId === "" && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Team (optional)</Label>
              <div className="grid gap-2">
                <button
                  type="button"
                  disabled={uploading}
                  onClick={() => setTeamId("")}
                  className={cn(
                    "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                    teamId === ""
                      ? "border-primary bg-primary/5"
                      : "border-border bg-card hover:border-muted-foreground/50",
                    uploading && "opacity-50 cursor-not-allowed",
                  )}
                >
                  <span className="text-muted-foreground">All of club</span>
                  {teamId === "" && (
                    <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                      <Check className="h-3 w-3 text-primary-foreground" />
                    </div>
                  )}
                </button>
                {clubTeams.map((team) => (
                  <button
                    key={team.id}
                    type="button"
                    disabled={uploading}
                    onClick={() => setTeamId(team.id)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                      teamId === team.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-muted-foreground/50",
                      uploading && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <span>{team.name}</span>
                    {teamId === team.id && (
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
          {clubId && clubMiniLeagues.length > 0 && teamId === "" && competitionId === "" && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Mini League (optional)</Label>
              <div className="grid gap-2">
                {clubMiniLeagues.map((league) => (
                  <button
                    key={league.id}
                    type="button"
                    disabled={uploading}
                    onClick={() => setMiniLeagueId(miniLeagueId === league.id ? "" : league.id)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                      miniLeagueId === league.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-muted-foreground/50",
                      uploading && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <span>{league.name}</span>
                    {miniLeagueId === league.id && (
                      <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Competition Selection */}
          {clubId && clubCompetitions.length > 0 && teamId === "" && miniLeagueId === "" && (
            <div className="space-y-3">
              <Label className="text-sm font-medium">Competition (optional)</Label>
              <div className="grid gap-2">
                {clubCompetitions.map((comp) => (
                  <button
                    key={comp.id}
                    type="button"
                    disabled={uploading}
                    onClick={() => setCompetitionId(competitionId === comp.id ? "" : comp.id)}
                    className={cn(
                      "flex items-center justify-between p-3 rounded-xl border-2 transition-all text-left w-full",
                      competitionId === comp.id
                        ? "border-primary bg-primary/5"
                        : "border-border bg-card hover:border-muted-foreground/50",
                      uploading && "opacity-50 cursor-not-allowed",
                    )}
                  >
                    <span>{comp.name}</span>
                    {competitionId === comp.id && (
                      <div className="h-5 w-5 rounded-full bg-primary flex items-center justify-center">
                        <Check className="h-3 w-3 text-primary-foreground" />
                      </div>
                    )}
                  </button>
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
