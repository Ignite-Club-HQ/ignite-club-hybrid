import { useCallback, useEffect, useRef, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Image as ImageIcon, Flag, MessageCircle, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { useClubTheme } from "@/hooks/useClubTheme";
import { CreateActionButton } from "@/components/CreateActionButton";
import { compressImage } from "@/lib/imageCompression";
import { withFeatureBackend, type FeatureBackendContext } from "@/live/featureRouter";
import {
  listLiveAssets,
  listLiveReactions,
  addLiveReaction,
  removeLiveReaction,
  listLiveComments,
  addLiveComment,
  liveAssetSource,
  registerLiveAsset,
} from "@/live/features/media";
import { isIcpMediaUploadUnavailable, tryUploadMediaToBlobStore } from "@/live/mediaUpload";
import { resolveIcpBlobObjectUrl } from "@/live/mediaDecrypt";

interface LiveAsset {
  id: string;
  club_id: string;
  kind: string;
  mime: string;
  storage_path: string;
  visibility: string;
  deleted: boolean;
  blob_ref?: [] | [{ canister: string; path: string; content_hash: string }];
}

interface LiveReaction {
  asset_id: string;
  kind: string;
  user: { toText(): string };
}

interface LiveComment {
  id: string;
  asset_id: string;
  author: { toText(): string };
  body: string;
  deleted: boolean;
}

export function PhotoSkeleton() {
  return (
    <Card className="overflow-hidden">
      <Skeleton className="aspect-square w-full" />
      <div className="p-3 space-y-2">
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-8 rounded-full" />
          <div className="space-y-1.5 flex-1">
            <Skeleton className="h-3 w-24" />
            <Skeleton className="h-2.5 w-16" />
          </div>
        </div>
        <div className="flex items-center gap-4">
          <Skeleton className="h-5 w-20" />
          <Skeleton className="h-5 w-5 ml-auto rounded-full" />
        </div>
      </div>
    </Card>
  );
}

/** Renders an asset's bytes. Blob-store bytes are IBE ciphertext, so they are
 * decrypted into an object URL first; Supabase-storage bytes are not
 * reachable without a Supabase session and render as a placeholder tile. */
function LiveAssetImage({ asset }: { asset: LiveAsset }) {
  const [objectUrl, setObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    let createdUrl: string | null = null;
    const source = liveAssetSource(asset);
    if (source.kind === "icp-blob") {
      resolveIcpBlobObjectUrl(source.url)
        .then((url) => {
          if (active && url) {
            createdUrl = url;
            setObjectUrl(url);
          }
        })
        .catch(() => {
          /* leave the placeholder tile — never fall back to the raw URL */
        });
    }
    return () => {
      active = false;
      if (createdUrl) URL.revokeObjectURL(createdUrl);
    };
  }, [asset]);

  if (objectUrl) {
    return <img src={objectUrl} alt="" className="aspect-square w-full object-cover" loading="lazy" />;
  }
  return (
    <div className="flex aspect-square w-full items-center justify-center bg-muted">
      <ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" />
    </div>
  );
}

async function withMediaBackend<T>(fn: (ctx: FeatureBackendContext) => Promise<T>): Promise<T> {
  return withFeatureBackend("media", {
    // This page only renders when the media feature is routed to ICP, so the
    // Supabase branch is unreachable in practice.
    supabase: () => {
      throw new Error("Media is not routed to the Internet Computer backend.");
    },
    icp: fn,
  });
}

export function IcpMediaFeedPage() {
  const { activeClubFilter } = useClubTheme();
  const clubId = activeClubFilter ?? null;

  const [principal, setPrincipal] = useState<string | null>(null);
  const [assets, setAssets] = useState<LiveAsset[]>([]);
  const [reactionsByAsset, setReactionsByAsset] = useState<Record<string, LiveReaction[]>>({});
  const [commentsByAsset, setCommentsByAsset] = useState<Record<string, LiveComment[]>>({});
  const [activeCommentAssetId, setActiveCommentAssetId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Uploads fail closed for ICP sessions until the media_blob_store canister
  // is configured — the button stays hidden in that case (same gate as the
  // Supabase media page's upload controls).
  const uploadAvailable = !isIcpMediaUploadUnavailable();

  const loadFeed = useCallback(async () => {
    if (!clubId) {
      setAssets([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    setLoadError(false);
    try {
      const { assets: fetched, principalText, reactions, comments } = await withMediaBackend(async (ctx) => {
        const fetched = (await listLiveAssets(ctx, clubId)) as unknown as LiveAsset[];
        const visible = fetched.filter((asset) => !asset.deleted);
        const reactionEntries = await Promise.all(
          visible.map(async (asset) => [asset.id, (await listLiveReactions(ctx, asset.id)) as unknown as LiveReaction[]] as const),
        );
        const commentEntries = await Promise.all(
          visible.map(async (asset) => [
            asset.id,
            ((await listLiveComments(ctx, asset.id)) as unknown as LiveComment[]).filter((comment) => !comment.deleted),
          ] as const),
        );
        return {
          assets: visible,
          principalText: ctx.identity.getPrincipal().toText(),
          reactions: Object.fromEntries(reactionEntries),
          comments: Object.fromEntries(commentEntries),
        };
      });
      setPrincipal(principalText);
      setAssets(fetched);
      setReactionsByAsset(reactions);
      setCommentsByAsset(comments);
    } catch {
      setLoadError(true);
      setAssets([]);
      setReactionsByAsset({});
      setCommentsByAsset({});
    } finally {
      setIsLoading(false);
    }
  }, [clubId]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  const handleFilesSelected = useCallback(async (fileList: FileList | null) => {
    if (!clubId || !fileList || fileList.length === 0) return;
    const files = Array.from(fileList);
    setIsUploading(true);
    let uploaded = 0;
    try {
      for (const original of files) {
        const { file } = await compressImage(original);
        const ext = original.name.split(".").pop() || "jpg";
        const path = `clubs/${clubId}/${principal ?? "member"}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
        // Fail closed: bytes must go to the blob store in ICP mode, never to
        // plaintext Supabase storage. A configured-but-failed upload throws.
        const blobUpload = await tryUploadMediaToBlobStore({
          storagePath: path,
          file,
          mime: file.type || "application/octet-stream",
        });
        if (!blobUpload) {
          throw new Error("Media blob store is not configured");
        }
        await withMediaBackend(async (ctx) => {
          await registerLiveAsset(ctx, {
            clubId,
            kind: "photo",
            mime: file.type || "application/octet-stream",
            checksum: blobUpload.blobRef.content_hash,
            storagePath: blobUpload.blobRef.path,
            visibility: "club",
            contentLength: file.size,
            blobRef: blobUpload.blobRef,
          });
        });
        uploaded += 1;
      }
      if (uploaded > 0) {
        toast.success(uploaded === 1 ? "Photo added" : `${uploaded} photos added`);
      }
    } catch {
      toast.error("The upload didn't finish — please try again");
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      if (uploaded > 0) void loadFeed();
    }
  }, [clubId, principal, loadFeed]);

  const handleReact = useCallback(async (assetId: string) => {
    const current = reactionsByAsset[assetId] ?? [];
    const hasReacted = principal !== null && current.some((reaction) => reaction.user.toText() === principal);
    try {
      await withMediaBackend(async (ctx) => {
        if (hasReacted) {
          await removeLiveReaction(ctx, assetId);
        } else {
          await addLiveReaction(ctx, assetId, "like", Date.now());
        }
        const updated = (await listLiveReactions(ctx, assetId)) as unknown as LiveReaction[];
        setReactionsByAsset((prev) => ({ ...prev, [assetId]: updated }));
      });
    } catch {
      /* leave the previous count on screen */
    }
  }, [principal, reactionsByAsset]);

  const handleAddComment = useCallback(async (assetId: string) => {
    const body = commentDraft.trim();
    if (!body) return;
    try {
      await withMediaBackend(async (ctx) => {
        await addLiveComment(ctx, assetId, body, Date.now());
        const updated = ((await listLiveComments(ctx, assetId)) as unknown as LiveComment[]).filter((comment) => !comment.deleted);
        setCommentsByAsset((prev) => ({ ...prev, [assetId]: updated }));
      });
      setCommentDraft("");
    } catch {
      /* keep the draft so nothing is lost */
    }
  }, [commentDraft]);

  return (
    <div className="py-6 pb-32 space-y-6 soft-reveal">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold">Media</h1>
        {clubId && uploadAvailable && (
          isUploading ? (
            <div className="inline-flex h-11 w-11 items-center justify-center" aria-label="Uploading">
              <Loader2 className="h-5 w-5 animate-spin text-primary" />
            </div>
          ) : (
            <CreateActionButton ariaLabel="Add photo" onClick={() => fileInputRef.current?.click()} />
          )
        )}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        aria-hidden="true"
        onChange={(e) => void handleFilesSelected(e.target.files)}
      />
      {loadError ? (
        <Card className="flex flex-col items-center gap-3 p-8 text-center">
          <p className="text-sm font-medium">Photos couldn't load right now</p>
          <p className="text-xs text-muted-foreground">Check your connection and try again.</p>
          <Button size="sm" variant="outline" onClick={() => void loadFeed()}>
            <RefreshCw className="mr-2 h-4 w-4" />Try again
          </Button>
        </Card>
      ) : !clubId ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">Choose a club to see its photos</p>
        </Card>
      ) : isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1].map(i => <PhotoSkeleton key={i} />)}</div>
      ) : assets.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <ImageIcon className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">No media yet</p>
          {uploadAvailable && (
            <Button size="sm" className="mt-2" disabled={isUploading} onClick={() => fileInputRef.current?.click()}>
              {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Add photos
            </Button>
          )}
        </Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {assets.map(asset => {
            const reactions = reactionsByAsset[asset.id] ?? [];
            const hasReacted = principal !== null && reactions.some(reaction => reaction.user.toText() === principal);
            const comments = commentsByAsset[asset.id] ?? [];
            return (
              <Card key={asset.id} className="overflow-hidden">
                <LiveAssetImage asset={asset} />
                <CardContent className="space-y-2 p-3">
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <button type="button" onClick={() => void handleReact(asset.id)} aria-pressed={hasReacted} className={cn("flex items-center gap-1", hasReacted && "text-primary")}><Flag className="h-3.5 w-3.5" aria-hidden="true" />{reactions.length}</button>
                    <button type="button" onClick={() => setActiveCommentAssetId(asset.id)} className="flex items-center gap-1"><MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />{comments.length}</button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
      <Sheet open={activeCommentAssetId !== null} onOpenChange={open => !open && setActiveCommentAssetId(null)}>
        <SheetContent side="bottom" className="max-h-[70vh]">
          <SheetHeader><SheetTitle>Comments</SheetTitle></SheetHeader>
          {activeCommentAssetId && (
            <div className="flex h-full flex-col gap-3 py-2">
              <ScrollArea className="flex-1"><div className="space-y-2">
                {(commentsByAsset[activeCommentAssetId] ?? []).map(comment => <div key={comment.id} className="text-sm"><span className="font-medium">{principal !== null && comment.author.toText() === principal ? "You" : "Member"}</span>{": "}{comment.body}</div>)}
                {(commentsByAsset[activeCommentAssetId] ?? []).length === 0 && <p className="text-sm text-muted-foreground">No comments yet.</p>}
              </div></ScrollArea>
              <div className="flex items-center gap-2">
                <input value={commentDraft} onChange={e => setCommentDraft(e.target.value)} placeholder="Add a comment" className="flex-1 rounded-md border px-3 py-2 text-sm" onKeyDown={e => { if (e.key === "Enter" && activeCommentAssetId) void handleAddComment(activeCommentAssetId); }} />
                <Button size="sm" disabled={!commentDraft.trim()} onClick={() => activeCommentAssetId && void handleAddComment(activeCommentAssetId)}>Post</Button>
              </div>
            </div>
          )}
        </SheetContent>
      </Sheet>
    </div>
  );
}
