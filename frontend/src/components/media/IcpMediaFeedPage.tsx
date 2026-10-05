import { useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Images, Loader2, MessageCircle, SlidersHorizontal, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useIcpSession } from "@/live/useIcpSession";
import { withMediaBackend } from "@/live/featureBackend";
import type { FeatureBackendContext } from "@/live/featureRouter";
import {
  addLiveComment,
  deleteLiveAsset,
  listLiveAssets,
  listLiveComments,
  listLiveReactions,
  liveAssetSource,
  filterLiveDeletedAssets,
  toggleLiveReaction,
} from "@/live/features/media";
import { resolveIcpBlobObjectUrl } from "@/live/features/mediaDecrypt";
import { listLiveTeams } from "@/live/features/club";
import { listLiveMiniLeaguesByClub } from "@/live/features/miniLeagues";
import { listLiveCompetitions } from "@/live/features/competitions";
import { listLiveMembershipClubs } from "@/live/features/membership";
import { listLiveProfilesByIds } from "@/live/features/identityAccessClient";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClubTeamFilter } from "@/components/ClubTeamFilter";
import { AlbumCarousel } from "@/components/AlbumCarousel";
import { EmojiReactions } from "@/components/EmojiReactions";
import { MediaCommentSheet } from "@/components/MediaCommentSheet";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { CreateActionButton } from "@/components/CreateActionButton";
import { MediaHeaderSponsorStrip } from "@/components/media/MediaHeaderSponsorStrip";
import { MediaSponsorTile } from "@/components/media/MediaSponsorTile";
import { IcpUploadPhotoSheet } from "@/components/media/IcpUploadPhotoSheet";
import { formatTimeShort } from "@/lib/formatTimeShort";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface LiveAssetView {
  id: string;
  url: string;
  isVideo: boolean;
}

interface LiveReactionView {
  user_id: string;
  reaction_type: string;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

interface LiveCommentView {
  id: string;
  text: string;
  user_id: string;
  created_at: string;
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
}

/** One feed post: a single photo/video or a multi-photo album (shared album_id). */
interface LiveMediaPost {
  id: string;
  assets: LiveAssetView[];
  /** Representative asset id used for reactions/comments (first in the album). */
  representativeAssetId: string;
  ownerId: string;
  ownerName: string;
  clubId: string;
  clubName: string;
  teamId: string | null;
  teamName: string | null;
  miniLeagueId: string | null;
  miniLeagueName: string | null;
  competitionId: string | null;
  competitionName: string | null;
  caption: string | null;
  createdAtMs: number;
  reactions: LiveReactionView[];
  comments: LiveCommentView[];
}

interface LiveFilterOptions {
  clubs: { id: string; name: string; sport: string | null }[];
  teams: { id: string; name: string; club_id: string }[];
  miniLeagues: { id: string; name: string; club_id: string }[];
  competitions: { id: string; name: string; club_id: string }[];
}

interface LiveMediaFeed {
  posts: LiveMediaPost[];
  options: LiveFilterOptions;
}

// ---------------------------------------------------------------------------
// Loader
// ---------------------------------------------------------------------------

async function loadLiveMediaFeed(ctx: FeatureBackendContext): Promise<LiveMediaFeed> {
  const clubsRaw = (await listLiveMembershipClubs(ctx)) as unknown as {
    id: string;
    name: string;
    sport: [] | [string];
  }[];

  const options: LiveFilterOptions = { clubs: [], teams: [], miniLeagues: [], competitions: [] };
  const rawAssets: {
    id: string;
    club_id: string;
    owner: { toText(): string };
    kind: string;
    mime: string;
    created_at_ms: bigint;
    team_id: [] | [string];
    mini_league_id: [] | [string];
    competition_id: [] | [string];
    caption: [] | [string];
    album_id: [] | [string];
    blob_ref: [] | [unknown];
    deleted: boolean;
  }[] = [];

  await Promise.all(
    clubsRaw.map(async (club) => {
      options.clubs.push({ id: club.id, name: club.name, sport: club.sport[0] ?? null });
      const [assets, teams, miniLeagues, competitions] = await Promise.all([
        listLiveAssets(ctx, club.id).catch(() => []),
        listLiveTeams(ctx, club.id).catch(() => []),
        listLiveMiniLeaguesByClub(ctx, club.id).catch(() => []),
        listLiveCompetitions(ctx, club.id).catch(() => []),
      ]);
      for (const team of teams as unknown as {
        id: string;
        name: string;
        club_id: string;
        deleted_at_ms: [] | [bigint];
      }[]) {
        if (team.deleted_at_ms.length === 0) {
          options.teams.push({ id: team.id, name: team.name, club_id: team.club_id });
        }
      }
      for (const ml of miniLeagues as unknown as { id: string; name: string; club_id: string }[]) {
        options.miniLeagues.push({ id: ml.id, name: ml.name, club_id: ml.club_id });
      }
      for (const comp of competitions as unknown as { id: string; name: string; club_id: string }[]) {
        options.competitions.push({ id: comp.id, name: comp.name, club_id: comp.club_id });
      }
      for (const asset of filterLiveDeletedAssets(assets) as unknown as (typeof rawAssets)[number][]) {
        if (asset.kind === "photo" || asset.kind === "video") rawAssets.push(asset);
      }
    }),
  );

  // Resolve encrypted blob bytes to object URLs (never fall back to ciphertext).
  const assetViews = new Map<string, LiveAssetView>();
  await Promise.all(
    rawAssets.map(async (asset) => {
      try {
        const url = await resolveIcpBlobObjectUrl(liveAssetSource(asset as never), {
          ownerAccountId: asset.owner.toText(),
        });
        if (!url) return;
        const isVideo = asset.kind === "video" || asset.mime.startsWith("video/");
        // blob: URLs carry no extension, so isVideoUrl can't detect video —
        // a fragment is ignored by media loading but matches the suffix check.
        assetViews.set(asset.id, { id: asset.id, url: isVideo ? `${url}#.mp4` : url, isVideo });
      } catch {
        // Decryption/key failure: hide the asset rather than show broken media.
      }
    }),
  );

  // Uploader + commenter display names (account ids match principal text until
  // principals are bound post-deploy).
  const ownerIds = [...new Set(rawAssets.map((a) => a.owner.toText()))];
  const profileNameById = new Map<string, string>();
  try {
    const profiles = (await listLiveProfilesByIds(ctx, ownerIds)) as unknown as {
      account_id: string;
      display_name: string;
    }[];
    for (const p of profiles) profileNameById.set(p.account_id, p.display_name);
  } catch {
    // Names fall back to "Member".
  }

  const teamNameById = new Map(options.teams.map((t) => [t.id, t.name]));
  const mlNameById = new Map(options.miniLeagues.map((m) => [m.id, m.name]));
  const compNameById = new Map(options.competitions.map((c) => [c.id, c.name]));
  const clubNameById = new Map(options.clubs.map((c) => [c.id, c.name]));

  // Group into posts by album_id (multi-photo uploads share one).
  const groups = new Map<string, typeof rawAssets>();
  for (const asset of rawAssets) {
    if (!assetViews.has(asset.id)) continue;
    const key = asset.album_id[0] ?? asset.id;
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }

  const posts: LiveMediaPost[] = await Promise.all(
    [...groups.entries()].map(async ([key, group]) => {
      const sorted = [...group].sort((a, b) => Number(a.created_at_ms - b.created_at_ms));
      const first = sorted[0];
      const ownerId = first.owner.toText();
      const [reactionsRaw, commentsRaw] = await Promise.all([
        listLiveReactions(ctx, first.id).catch(() => []),
        listLiveComments(ctx, first.id).catch(() => []),
      ]);
      const reactions = (reactionsRaw as unknown as {
        kind: string;
        user: { toText(): string };
      }[]).map((r) => ({
        user_id: r.user.toText(),
        reaction_type: r.kind,
        profiles: { display_name: profileNameById.get(r.user.toText()) ?? null, avatar_url: null },
      }));
      const comments = (commentsRaw as unknown as {
        id: string;
        body: string;
        author: { toText(): string };
        created_at_ms: bigint;
        deleted: boolean;
      }[])
        .filter((c) => !c.deleted)
        .map((c) => ({
          id: c.id,
          text: c.body,
          user_id: c.author.toText(),
          created_at: new Date(Number(c.created_at_ms)).toISOString(),
          profiles: { display_name: profileNameById.get(c.author.toText()) ?? null, avatar_url: null },
        }));
      const teamId = first.team_id[0] ?? null;
      const miniLeagueId = first.mini_league_id[0] ?? null;
      const competitionId = first.competition_id[0] ?? null;
      return {
        id: key,
        assets: sorted.map((a) => assetViews.get(a.id)!),
        representativeAssetId: first.id,
        ownerId,
        ownerName: profileNameById.get(ownerId) ?? "Member",
        clubId: first.club_id,
        clubName: clubNameById.get(first.club_id) ?? "Club",
        teamId,
        teamName: teamId ? teamNameById.get(teamId) ?? null : null,
        miniLeagueId,
        miniLeagueName: miniLeagueId ? mlNameById.get(miniLeagueId) ?? null : null,
        competitionId,
        competitionName: competitionId ? compNameById.get(competitionId) ?? null : null,
        caption: first.caption[0] ?? null,
        createdAtMs: Number(first.created_at_ms),
        reactions,
        comments,
      } satisfies LiveMediaPost;
    }),
  );

  posts.sort((a, b) => b.createdAtMs - a.createdAtMs);
  options.clubs.sort((a, b) => a.name.localeCompare(b.name));
  return { posts, options };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export function IcpMediaFeedPage() {
  const { identity } = useIcpSession();
  const principal = identity?.getPrincipal().toText();
  const queryClient = useQueryClient();

  const [filterOpen, setFilterOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [selectedClubId, setSelectedClubId] = useState("all");
  const [selectedTeamId, setSelectedTeamId] = useState("all");
  const [commentPost, setCommentPost] = useState<LiveMediaPost | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [actionPost, setActionPost] = useState<LiveMediaPost | null>(null);
  const pressTimerRef = useRef<number | null>(null);

  const feedQuery = useQuery({
    queryKey: ["icp-media-feed", principal],
    enabled: !!identity,
    queryFn: () =>
      withMediaBackend({
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: (ctx) => loadLiveMediaFeed(ctx),
      }),
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["icp-media-feed"] });

  const reactionMutation = useMutation({
    mutationFn: async ({ post, emoji }: { post: LiveMediaPost; emoji: string }) =>
      withMediaBackend({
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: (ctx) => toggleLiveReaction(ctx, post.representativeAssetId, emoji),
      }),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Reaction failed"),
    onSettled: invalidate,
  });

  const commentMutation = useMutation({
    mutationFn: async ({ post, text }: { post: LiveMediaPost; text: string }) =>
      withMediaBackend({
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: (ctx) => addLiveComment(ctx, post.representativeAssetId, text),
      }),
    onSuccess: () => setCommentInput(""),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Comment failed"),
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (post: LiveMediaPost) =>
      withMediaBackend({
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: async (ctx) => {
          for (const asset of post.assets) {
            await deleteLiveAsset(ctx, asset.id);
          }
        },
      }),
    onSuccess: () => toast.success("Deleted"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
    onSettled: invalidate,
  });

  const posts = useMemo(() => {
    const all = feedQuery.data?.posts ?? [];
    return all.filter((post) => {
      if (selectedClubId !== "all" && post.clubId !== selectedClubId) return false;
      if (selectedTeamId === "all") return true;
      if (selectedTeamId.startsWith("ml:")) return post.miniLeagueId === selectedTeamId.slice(3);
      return post.teamId === selectedTeamId;
    });
  }, [feedQuery.data?.posts, selectedClubId, selectedTeamId]);

  const options = feedQuery.data?.options;
  const hasFilters = (options?.clubs.length ?? 0) > 1 || (options?.teams.length ?? 0) > 0;

  // Feed-level lightbox: one flat photo list across visible posts.
  const flatPhotos = useMemo(
    () =>
      posts.flatMap((post) =>
        post.assets.map((asset) => ({
          id: asset.id,
          file_url: asset.url,
          club_id: post.clubId,
          team_id: post.teamId,
          post,
        })),
      ),
    [posts],
  );

  const startLongPress = (post: LiveMediaPost) => {
    pressTimerRef.current = window.setTimeout(() => setActionPost(post), 500);
  };
  const cancelLongPress = () => {
    if (pressTimerRef.current !== null) {
      window.clearTimeout(pressTimerRef.current);
      pressTimerRef.current = null;
    }
  };

  const subtitleFor = (post: LiveMediaPost) =>
    post.teamName
      ? `${post.clubName} · ${post.teamName}`
      : post.miniLeagueName
        ? `${post.clubName} · ${post.miniLeagueName}`
        : post.competitionName
          ? `${post.clubName} · ${post.competitionName}`
          : post.clubName;

  const openPostLightbox = (post: LiveMediaPost, assetIndex: number) => {
    const targetId = post.assets[assetIndex]?.id;
    const flat = flatPhotos.findIndex((p) => p.id === targetId);
    if (flat >= 0) setLightboxIndex(flat);
  };

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-border bg-background/95 backdrop-blur">
        <div className="mx-auto flex w-full max-w-2xl items-center justify-between gap-2 px-4 py-3">
          <h1 className="text-lg font-semibold">Media</h1>
          <div className="flex items-center gap-2">
            {hasFilters && (
              <Button
                variant="ghost"
                size="icon"
                aria-label="Filter media"
                onClick={() => setFilterOpen(true)}
              >
                <SlidersHorizontal className="h-5 w-5" />
              </Button>
            )}
            <CreateActionButton ariaLabel="Add photos" onClick={() => setUploadOpen(true)} />
          </div>
        </div>
        <MediaHeaderSponsorStrip clubId={selectedClubId !== "all" ? selectedClubId : undefined} />
      </header>

      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-4">
        {feedQuery.isLoading && (
          <div className="flex flex-col items-center gap-3 py-16 text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin" />
            <p className="text-sm">Loading media…</p>
          </div>
        )}

        {feedQuery.isError && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {feedQuery.error instanceof Error ? feedQuery.error.message : "Media could not be loaded."}
            </p>
            <Button variant="outline" onClick={() => feedQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}

        {feedQuery.isSuccess && posts.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <Images className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No media yet</p>
            <Button onClick={() => setUploadOpen(true)}>Add photos</Button>
          </div>
        )}

        <div className="space-y-6">
          {posts.map((post, index) => (
            <div key={post.id}>
              <article className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar className="h-9 w-9">
                    <AvatarFallback>{post.ownerName.slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{post.ownerName}</p>
                    <p className="truncate text-xs text-muted-foreground">{subtitleFor(post)}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {post.createdAtMs > 0 ? formatTimeShort(new Date(post.createdAtMs)) : ""}
                  </span>
                </div>

                <div
                  onTouchStart={() => startLongPress(post)}
                  onTouchMove={cancelLongPress}
                  onTouchEnd={cancelLongPress}
                  onTouchCancel={cancelLongPress}
                >
                  <AlbumCarousel
                    photos={post.assets.map((asset) => ({ id: asset.id, file_url: asset.url }))}
                    onTap={(i) => openPostLightbox(post, i)}
                    priority={index < 2}
                  />
                </div>

                <div className="flex items-center gap-2 px-3 py-2">
                  <EmojiReactions
                    reactions={post.reactions}
                    currentUserId={principal}
                    onReact={(type) => reactionMutation.mutate({ post, emoji: type })}
                    onRemove={() => {
                      const mine = post.reactions.find((r) => r.user_id === principal);
                      if (mine) reactionMutation.mutate({ post, emoji: mine.reaction_type });
                    }}
                  />
                  <button
                    type="button"
                    className="flex items-center gap-1 text-muted-foreground"
                    onClick={() => setCommentPost(post)}
                    aria-label="Comments"
                  >
                    <MessageCircle className="h-5 w-5" />
                    {post.comments.length > 0 && (
                      <span className="text-xs">{post.comments.length}</span>
                    )}
                  </button>
                </div>

                {post.caption && (
                  <p className="px-3 pb-3 text-sm">{post.caption}</p>
                )}
              </article>
              {(index + 1) % 8 === 0 && (
                <div className="mt-6">
                  <MediaSponsorTile seed={index} clubId={post.clubId} />
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      <Drawer open={filterOpen} onOpenChange={setFilterOpen}>
        <DrawerContent className="max-h-[85vh]">
          <DrawerHeader>
            <DrawerTitle>Filter media</DrawerTitle>
          </DrawerHeader>
          <div className="overflow-y-auto px-4 pb-6">
            {options && (
              <ClubTeamFilter
                expanded
                clubs={options.clubs}
                teams={options.teams}
                miniLeagues={options.miniLeagues}
                selectedClubId={selectedClubId}
                selectedTeamId={selectedTeamId}
                onClubChange={(id) => {
                  setSelectedClubId(id);
                  setSelectedTeamId("all");
                }}
                onTeamChange={setSelectedTeamId}
              />
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {options && (
        <IcpUploadPhotoSheet
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUploaded={invalidate}
          clubs={options.clubs}
          teams={options.teams}
          miniLeagues={options.miniLeagues}
          competitions={options.competitions}
          defaultClubId={selectedClubId !== "all" ? selectedClubId : undefined}
        />
      )}

      <MediaCommentSheet
        open={commentPost !== null}
        onOpenChange={(open) => {
          if (!open) setCommentPost(null);
        }}
        photoUrl={commentPost?.assets[0]?.url ?? ""}
        uploaderName={commentPost?.ownerName ?? null}
        teamName={commentPost ? subtitleFor(commentPost) : null}
        teamId={commentPost?.teamId}
        clubId={commentPost?.clubId}
        miniLeagueId={commentPost?.miniLeagueId}
        comments={commentPost?.comments ?? []}
        commentInput={commentInput}
        onCommentInputChange={setCommentInput}
        onSubmitComment={() => {
          const text = commentInput.trim();
          if (commentPost && text) commentMutation.mutate({ post: commentPost, text });
        }}
        isPending={commentMutation.isPending}
        replyingTo={null}
        onSetReplyingTo={() => undefined}
        currentUserId={principal}
      />

      <PhotoLightbox
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        photos={flatPhotos}
        currentIndex={lightboxIndex ?? 0}
        onNavigate={(i) => setLightboxIndex(i)}
        canDelete={
          lightboxIndex !== null && flatPhotos[lightboxIndex]?.post.ownerId === principal
        }
        onDelete={(photoId) => {
          const entry = flatPhotos.find((p) => p.id === photoId);
          if (entry) {
            deleteMutation.mutate(entry.post);
            setLightboxIndex(null);
          }
        }}
      />

      <Sheet open={actionPost !== null} onOpenChange={(open) => !open && setActionPost(null)}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>Photo options</SheetTitle>
          </SheetHeader>
          <div className="mt-4 space-y-2">
            {actionPost && actionPost.ownerId === principal ? (
              <Button
                variant="destructive"
                className="w-full"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate(actionPost);
                  setActionPost(null);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Only the person who shared this can delete it.
              </p>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
