import { useCallback, useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Image as ImageIcon, Flag, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  fetchMediaFeed,
  toggleMediaReaction,
  createIcpMediaFeedProvider,
  createFixtureMediaFeedProvider,
  type MediaFeedProvider,
  type MediaFeedAsset,
  type MediaFeedComment,
  type MediaFeedReaction,
} from "@/lab/hybridMediaFeedRepository";
import { connectLocalMediaMetadataClient } from "@/lab/localMediaMetadata";

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

export function IcpMediaFeedPage() {
  const { user } = useAuth();
  const { activeClubFilter } = useClubTheme();
  const clubId = activeClubFilter ?? "club-icp-001";
  const actorId = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const fixtureProvider = useMemo(() => createFixtureMediaFeedProvider(clubId, actorId), [clubId, actorId]);
  const [provider, setProvider] = useState<MediaFeedProvider>(fixtureProvider);
  const [providerError, setProviderError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setProvider(fixtureProvider);
    setProviderError(null);
    void connectLocalMediaMetadataClient(actorId)
      .then(({ client }) => {
        if (active) setProvider(createIcpMediaFeedProvider(client));
      })
      .catch((error: unknown) => {
        if (active) setProviderError(error instanceof Error ? error.message : String(error));
      });
    return () => { active = false; };
  }, [actorId, fixtureProvider]);

  const [assets, setAssets] = useState<MediaFeedAsset[]>([]);
  const [reactionsByAsset, setReactionsByAsset] = useState<Record<string, MediaFeedReaction[]>>({});
  const [commentsByAsset, setCommentsByAsset] = useState<Record<string, MediaFeedComment[]>>({});
  const [activeCommentAssetId, setActiveCommentAssetId] = useState<string | null>(null);
  const [commentDraft, setCommentDraft] = useState("");
  const [isLoading, setIsLoading] = useState(true);

  const loadFeed = useCallback(async () => {
    setIsLoading(true);
    try {
      const feed = await fetchMediaFeed(provider, clubId);
      setAssets(feed);
      const reactionEntries = await Promise.all(feed.map(async asset => [asset.id, await provider.listReactions(asset.id)] as const));
      setReactionsByAsset(Object.fromEntries(reactionEntries));
      const commentEntries = await Promise.all(feed.map(async asset => [asset.id, await provider.listComments(asset.id)] as const));
      setCommentsByAsset(Object.fromEntries(commentEntries));
    } catch (error: unknown) {
      setProviderError(error instanceof Error ? error.message : String(error));
      setAssets([]);
      setReactionsByAsset({});
      setCommentsByAsset({});
    } finally {
      setIsLoading(false);
    }
  }, [provider, clubId]);

  useEffect(() => { void loadFeed(); }, [loadFeed]);

  const handleReact = useCallback(async (assetId: string) => {
    const current = reactionsByAsset[assetId] ?? [];
    await toggleMediaReaction(provider, assetId, "like", actorId, current, Date.now());
    const updated = await provider.listReactions(assetId);
    setReactionsByAsset(prev => ({ ...prev, [assetId]: updated }));
  }, [provider, reactionsByAsset, actorId]);

  const handleAddComment = useCallback(async (assetId: string) => {
    const body = commentDraft.trim();
    if (!body) return;
    await provider.addComment(assetId, body, Date.now());
    const updated = await provider.listComments(assetId);
    setCommentsByAsset(prev => ({ ...prev, [assetId]: updated }));
    setCommentDraft("");
  }, [provider, commentDraft]);

  return (
    <div className="py-6 pb-32 space-y-6 soft-reveal">
      <div className="flex items-center justify-between gap-2"><h1 className="text-2xl font-bold">Media</h1></div>
      <div className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
        {providerError
          ? `The media metadata service is unavailable (${providerError}); showing explicit synthetic data for this local environment.`
          : "Media uses the authenticated metadata service. Uploading, reporting, and blocking remain unavailable until protected object storage and moderation contracts are connected."}
      </div>
      {isLoading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">{[0, 1].map(i => <PhotoSkeleton key={i} />)}</div>
      ) : assets.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center"><ImageIcon className="h-6 w-6 text-muted-foreground" /><p className="text-sm font-medium">No media yet</p></Card>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {assets.map(asset => {
            const reactions = reactionsByAsset[asset.id] ?? [];
            const hasReacted = reactions.some(reaction => reaction.userId === actorId);
            const comments = commentsByAsset[asset.id] ?? [];
            return (
              <Card key={asset.id} className="overflow-hidden">
                <div className="flex aspect-square w-full items-center justify-center bg-muted"><ImageIcon className="h-8 w-8 text-muted-foreground" aria-hidden="true" /></div>
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
                {(commentsByAsset[activeCommentAssetId] ?? []).map(comment => <div key={comment.id} className="text-sm"><span className="font-medium">{comment.authorId === actorId ? "You" : comment.authorId}</span>{": "}{comment.body}</div>)}
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
