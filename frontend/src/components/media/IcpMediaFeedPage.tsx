import { readContentInScope } from "@/live/contentRouting";
import { acrossLists } from "@/live/featureScopes";
import { writeOnce } from "@/live/clubScope";
import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Filter, Images, Loader2, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";
import { withFeatureBackend } from "@/live/featureRouter";
import type { FeatureBackendContext } from "@/live/featureRouter";
import {
  addLiveComment,
  addLiveReaction,
  deleteLiveAsset,
  listLiveAssets,
  listLiveComments,
  listLiveReactions,
  liveAssetSource,
  removeLiveReaction,
} from "@/live/features/media";
import { readCachedIcpBlobObjectUrl, resolveIcpBlobObjectUrl, storedIcpPrincipal } from "@/live/mediaDecrypt";
import { listLiveTeams } from "@/live/features/club";
import { listLiveMiniLeaguesByClub } from "@/live/features/miniLeagues";
import { listLiveCompetitions } from "@/live/features/competitions";
import { getLiveMyRoleGrants, listLiveMembershipClubs } from "@/live/features/membership";
import { listLiveProfilesByIds } from "@/live/features/identityAccessClient";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClubTeamFilter } from "@/components/ClubTeamFilter";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useAuth } from "@/hooks/useAuth";
import { AlbumCarousel } from "@/components/AlbumCarousel";
import { EmojiReactions } from "@/components/EmojiReactions";
import { MediaCommentSheet } from "@/components/MediaCommentSheet";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { CreateActionButton } from "@/components/CreateActionButton";
import { MediaHeaderSponsorStrip } from "@/components/media/MediaHeaderSponsorStrip";
import { MediaSponsorTile } from "@/components/media/MediaSponsorTile";
import { IcpUploadPhotoSheet, type IcpPendingUploadPreview } from "@/components/media/IcpUploadPhotoSheet";
import { localUploadPreviews } from "@/components/media/localUploadPreviews";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { mediaProfileDirectory } from "./mediaProfileDirectory";

// ---------------------------------------------------------------------------
// Data model
// ---------------------------------------------------------------------------

interface LiveAssetView {
  id: string;
  url: string;
  /** True while the encrypted blob is still being fetched/decrypted — the UI
   * shows a pulsing skeleton instead of a flat grey image. */
  loading: boolean;
  isVideo: boolean;
  /** Encrypted photo-store address; unlocked in the background. */
  sourceUrl?: string | null;
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
  ownerAvatarUrl: string | null;
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

const UNAVAILABLE_PHOTO_URL =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">' +
      '<rect width="600" height="600" fill="#e5e7eb"/>' +
      '<text x="300" y="300" font-family="sans-serif" font-size="28" fill="#6b7280" text-anchor="middle">Photo could not be loaded</text>' +
      "</svg>",
  );

const LOADING_PHOTO_URL =
  "data:image/svg+xml;charset=utf-8," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600" viewBox="0 0 600 600">' +
      '<rect width="600" height="600" fill="#f3f4f6"/>' +
      "</svg>",
  );

/** Decrypted photo URLs kept for the whole app session (keyed by source URL),
 * so revisiting the Media page shows photos immediately. */
const sessionPhotoUrls = new Map<string, string>();

/** Unlocks photos: on-device cache hits all at once first, then the rest a
 * few at a time (newest first), reporting each as it lands. */
function useResolvedAssetUrls(posts: LiveMediaPost[] | undefined) {
  const initial = () => {
    const out: Record<string, string> = {};
    for (const a of posts?.flatMap((p) => p.assets) ?? []) {
      const hit = a.sourceUrl ? sessionPhotoUrls.get(a.sourceUrl) : undefined;
      if (hit) out[a.id] = a.isVideo ? `${hit}#.mp4` : hit;
    }
    return out;
  };
  const [urls, setUrls] = useState<Record<string, string>>(initial);
  const doneRef = useRef(new Set<string>());
  useEffect(() => {
    if (!posts) return;
    let cancelled = false;
    const pending = posts
      .flatMap((p) => p.assets)
      .filter((a) => a.sourceUrl && !doneRef.current.has(a.id));
    pending.forEach((a) => doneRef.current.add(a.id));
    const show = (asset: LiveAssetView, raw: string, remember: boolean) => {
      if (remember && asset.sourceUrl) sessionPhotoUrls.set(asset.sourceUrl, raw);
      const url = asset.isVideo && raw !== UNAVAILABLE_PHOTO_URL ? `${raw}#.mp4` : raw;
      setUrls((prev) => (prev[asset.id] === url ? prev : { ...prev, [asset.id]: url }));
    };
    void (async () => {
      const misses: LiveAssetView[] = [];
      await Promise.all(
        pending.map(async (asset) => {
          const src = asset.sourceUrl!;
          const known = sessionPhotoUrls.get(src) ?? localUploadPreviews.get(src);
          if (known) return show(asset, known, false);
          const cached = await readCachedIcpBlobObjectUrl(src).catch(() => null);
          if (cancelled) return;
          if (cached) show(asset, cached, true);
          else misses.push(asset);
        }),
      );
      const order = new Map(pending.map((a, i) => [a.id, i]));
      misses.sort((a, b) => order.get(a.id)! - order.get(b.id)!);
      const worker = async () => {
        while (!cancelled && misses.length) {
          const asset = misses.shift()!;
          try {
            const resolved = await resolveIcpBlobObjectUrl(asset.sourceUrl!);
            if (!cancelled) show(asset, resolved ?? UNAVAILABLE_PHOTO_URL, !!resolved);
          } catch (err) {
            console.warn("[icp-media-feed] could not load asset", asset.id, err);
            if (!cancelled) show(asset, UNAVAILABLE_PHOTO_URL, false);
          }
        }
      };
      await Promise.all(Array.from({ length: 8 }, worker));
    })();
    return () => {
      cancelled = true;
      // Unfinished assets must be retried on the next run.
      pending.forEach((a) => {
        if (!a.sourceUrl || !sessionPhotoUrls.has(a.sourceUrl)) doneRef.current.delete(a.id);
      });
    };
  }, [posts]);
  return urls;
}

const FEED_SNAPSHOT_PREFIX = "ignite_icp_media_feed_v1:";

function readFeedSnapshot(principal: string | undefined): LiveMediaFeed | undefined {
  if (!principal) return undefined;
  try {
    const raw = localStorage.getItem(FEED_SNAPSHOT_PREFIX + principal);
    return raw ? (JSON.parse(raw) as LiveMediaFeed) : undefined;
  } catch {
    return undefined;
  }
}

function writeFeedSnapshot(principal: string, feed: LiveMediaFeed) {
  try {
    const trimmed = { ...feed, posts: feed.posts.slice(0, 60) };
    localStorage.setItem(FEED_SNAPSHOT_PREFIX + principal, JSON.stringify(trimmed));
  } catch {
    /* storage full — snapshot is only a speed-up */
  }
}

async function loadLiveMediaFeed(ctx: FeatureBackendContext): Promise<LiveMediaFeed> {
  // list_clubs returns every club on the canister, so scope it to the
  // caller's own role grants — same membership the Clubs page uses.
  const grants = await getLiveMyRoleGrants(ctx);
  const grantClubIds = new Set(grants.map((g) => g.club[0]).filter((c): c is string => !!c));
  const grantTeamIds = new Set(grants.map((g) => g.team[0]).filter((t): t is string => !!t));
  const clubsRaw = (await readContentInScope(ctx, "membership", acrossLists, listLiveMembershipClubs)) as unknown as {
    id: string;
    name: string;
    sport: [] | [string];
    deleted_at_ms: [] | [bigint];
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
      // Soft-deleted clubs keep their canister records (and assets) — never
      // surface them in the feed, the filter drawer, or the upload sheet.
      if (club.deleted_at_ms.length > 0) return;
      const directMember = grantClubIds.has(club.id);
      if (!directMember && grantTeamIds.size === 0) return;
      if (!directMember) {
        const clubTeams = (await readContentInScope(ctx, "membership", { clubId: club.id }, scoped => listLiveTeams(scoped, club.id))) as unknown as { id: string }[];
        if (!clubTeams.some((t) => grantTeamIds.has(t.id))) return;
      }
      options.clubs.push({ id: club.id, name: club.name, sport: club.sport[0] ?? null });
      const [assets, teams, miniLeagues, competitions] = await Promise.all([
        readContentInScope(ctx, "media", { clubId: club.id }, scoped => listLiveAssets(scoped, club.id)),
        readContentInScope(ctx, "membership", { clubId: club.id }, scoped => listLiveTeams(scoped, club.id)),
        readContentInScope(ctx, "mini_leagues", { clubId: club.id }, scoped => listLiveMiniLeaguesByClub(scoped, club.id)),
        readContentInScope(ctx, "competitions", { clubId: club.id }, scoped => listLiveCompetitions(scoped, club.id)),
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
      for (const asset of assets as unknown as (typeof rawAssets)[number][]) {
        if (asset.deleted) continue;
        if (asset.kind === "photo" || asset.kind === "video") rawAssets.push(asset);
      }
    }),
  );

  // Photos are unlocked in the background by the page (see useResolvedAssetUrls)
  // so the feed paints as soon as the post list is known instead of waiting
  // for every encrypted photo to download and decrypt.
  const assetViews = new Map<string, LiveAssetView>();
  for (const asset of rawAssets) {
    const isVideo = asset.kind === "video" || asset.mime.startsWith("video/");
    let sourceUrl: string | null = null;
    try {
      const source = liveAssetSource(asset as never);
      if (source.kind === "icp-blob") sourceUrl = source.url;
    } catch {
      sourceUrl = null;
    }
    assetViews.set(asset.id, {
      id: asset.id,
      url: sourceUrl ? LOADING_PHOTO_URL : UNAVAILABLE_PHOTO_URL,
      loading: !!sourceUrl,
      isVideo,
      sourceUrl,
    });
  }

  const teamNameById = new Map(options.teams.map((t) => [t.id, t.name]));
  const mlNameById = new Map(options.miniLeagues.map((m) => [m.id, m.name]));
  const compNameById = new Map(options.competitions.map((c) => [c.id, c.name]));
  const clubNameById = new Map(options.clubs.map((c) => [c.id, c.name]));

  // Group into posts by album_id (multi-photo uploads share one).
  const groups = new Map<string, typeof rawAssets>();
  for (const asset of rawAssets) {
    if (!assetViews.has(asset.id)) continue;
    const key = `${asset.club_id}:${asset.album_id[0] ?? asset.id}`;
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
        readContentInScope(ctx, "media", { photoId: first.id }, scoped => listLiveReactions(scoped, first.id)),
        readContentInScope(ctx, "media", { photoId: first.id }, scoped => listLiveComments(scoped, first.id)),
      ]);
      const reactions = (reactionsRaw as unknown as {
        kind: string;
        user: { toText(): string };
      }[]).map((r) => ({
        user_id: r.user.toText(),
        reaction_type: r.kind,
        profiles: { display_name: null as string | null, avatar_url: null },
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
          profiles: { display_name: null as string | null, avatar_url: null },
        }));
      const teamId = first.team_id[0] ?? null;
      const miniLeagueId = first.mini_league_id[0] ?? null;
      const competitionId = first.competition_id[0] ?? null;
      return {
        id: key,
        assets: sorted.flatMap(a => { const view = assetViews.get(a.id); return view ? [view] : []; }),
        representativeAssetId: first.id,
        ownerId,
        ownerName: "Member",
        ownerAvatarUrl: null,
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

  // Profiles for uploaders, reactors and commenters, looked up in one
  // batch once every id is known.
  const nameIds = new Set<string>();
  for (const post of posts) {
    nameIds.add(post.ownerId);
    post.reactions.forEach((r) => nameIds.add(r.user_id));
    post.comments.forEach((c) => nameIds.add(c.user_id));
  }
  let profileById = mediaProfileDirectory([]);
  try {
    const profiles = (await listLiveProfilesByIds(ctx, [...nameIds])) as unknown as {
      account_id: string;
      display_name: string;
      avatar_ref: [] | [string];
    }[];
    profileById = mediaProfileDirectory(profiles);
  } catch {
    // Names fall back to "Member".
  }
  for (const post of posts) {
    post.ownerName = profileById.get(post.ownerId)?.display_name ?? "Member";
    post.ownerAvatarUrl = profileById.get(post.ownerId)?.avatar_url ?? null;
    for (const r of post.reactions) r.profiles = profileById.get(r.user_id) ?? { display_name: null, avatar_url: null };
    for (const c of post.comments) c.profiles = profileById.get(c.user_id) ?? { display_name: null, avatar_url: null };
  }

  posts.sort((a, b) => b.createdAtMs - a.createdAtMs);
  options.clubs.sort((a, b) => a.name.localeCompare(b.name));
  return { posts, options };
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

/** Grid placeholder used by the Supabase media page's loading states. */
export function PhotoSkeleton() {
  return <div className="aspect-square w-full animate-pulse rounded-xl bg-muted" />;
}

export function IcpMediaFeedPage() {
  const { user, profile } = useAuth();
  const principalQuery = useQuery({
    queryKey: ["icp-principal"],
    staleTime: Infinity,
    // Stored session principal paints the cached feed before sign-in restores.
    placeholderData: () => storedIcpPrincipal(),
    queryFn: async () =>
      (await getCurrentInternetIdentity())?.getPrincipal().toText() ?? null,
  });
  const principal = principalQuery.data ?? undefined;
  const queryClient = useQueryClient();

  const [filterOpen, setFilterOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [pendingPreviews, setPendingPreviews] = useState<IcpPendingUploadPreview[]>([]);
  // Home's "Add photos" shortcut and gallery prompts link to /media?upload=1.
  const [searchParams, setSearchParams] = useSearchParams();
  const competitionId = searchParams.get("competition");
  useEffect(() => {
    if (searchParams.get("upload") !== "1") return;
    setUploadOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("upload");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [selectedClubId, setSelectedClubId] = useState("all");
  const [selectedTeamId, setSelectedTeamId] = useState("all");
  // Follow the top-left club switcher: when the app is filtered to one club,
  // the feed must not show other clubs' media.
  const { activeClubFilter } = useClubTheme();
  useEffect(() => {
    setSelectedClubId(activeClubFilter ?? "all");
    setSelectedTeamId("all");
  }, [activeClubFilter]);
  const [commentPost, setCommentPost] = useState<LiveMediaPost | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [pendingComments, setPendingComments] = useState<Record<string, LiveCommentView[]>>({});
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [actionPost, setActionPost] = useState<LiveMediaPost | null>(null);
  const pressTimerRef = useRef<number | null>(null);

  const feedQuery = useQuery({
    queryKey: ["icp-media-feed", principal],
    enabled: !!principal,
    // Last visit's feed shows instantly; the fresh one replaces it when ready.
    initialData: () => readFeedSnapshot(principal),
    initialDataUpdatedAt: 0,
    queryFn: async () => {
      const feed = await withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: (ctx) => loadLiveMediaFeed(ctx),
      }, { shared: "person" });
      if (principal) writeFeedSnapshot(principal, feed);
      return feed;
    },
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ["icp-media-feed"] });

  const reactionMutation = useMutation({
    mutationFn: async ({ post, emoji, remove }: { post: LiveMediaPost; emoji: string; remove?: boolean }) =>
      withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: async (ctx) => {
          if (!remove) return addLiveReaction(ctx, post.representativeAssetId, emoji, Date.now());
          const reactions = await listLiveReactions(ctx, post.representativeAssetId);
          const mine = reactions.find(r => r.user.toText() === ctx.identity.getPrincipal().toText());
          if (mine) return removeLiveReaction(ctx, mine.id);
        },
      }, writeOnce({ photoId: post.representativeAssetId })),
    // Instant on-screen update; the canister save finishes in the background.
    onMutate: async ({ post, emoji, remove }) => {
      const key = ["icp-media-feed", principal];
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<LiveMediaFeed>(key);
      if (previous && principal) {
        queryClient.setQueryData<LiveMediaFeed>(key, {
          ...previous,
          posts: previous.posts.map((p) => {
            if (p.id !== post.id) return p;
            const others = p.reactions.filter((r) => r.user_id !== principal);
            return {
              ...p,
              reactions: remove
                ? others
                : [...others, { user_id: principal, reaction_type: emoji, profiles: { display_name: "You", avatar_url: null } }],
            };
          }),
        });
      }
      return { previous, key };
    },
    onError: (err, _vars, context) => {
      if (context?.previous) queryClient.setQueryData(context.key, context.previous);
      toast.error(err instanceof Error ? err.message : "Reaction failed");
    },
    onSettled: invalidate,
  });

  const commentMutation = useMutation({
    mutationFn: async ({ post, text }: { post: LiveMediaPost; text: string }) =>
      withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: (ctx) => addLiveComment(ctx, post.representativeAssetId, text, Date.now()),
      }, writeOnce({ photoId: post.representativeAssetId })),
    // Show the comment the moment Send is tapped; the feed refetch replaces
    // it with the canister copy (the sheet reads the live post).
    onMutate: ({ post, text }) => {
      setCommentInput("");
      const pendingId = `pending-${Date.now()}`;
      setPendingComments((prev) => ({
        ...prev,
        [post.id]: [
          ...(prev[post.id] ?? []),
          {
            id: pendingId,
            text,
            user_id: principal ?? "",
            created_at: new Date().toISOString(),
            profiles: { display_name: "You", avatar_url: null },
          },
        ],
      }));
      return { pendingId };
    },
    onError: (err, { post, text }, context) => {
      setPendingComments((prev) => ({
        ...prev,
        [post.id]: (prev[post.id] ?? []).filter((c) => c.id !== context?.pendingId),
      }));
      setCommentInput(text);
      toast.error(err instanceof Error ? err.message : "Comment failed");
    },
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async (post: LiveMediaPost) =>
      withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: async (ctx) => {
          for (const asset of post.assets) {
            await deleteLiveAsset(ctx, asset.id);
          }
        },
      }, writeOnce({ photoId: post.representativeAssetId })),
    onSuccess: () => toast.success("Deleted"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
    onSettled: invalidate,
  });

  const resolvedUrls = useResolvedAssetUrls(feedQuery.data?.posts);
  const posts = useMemo(() => {
    const all = feedQuery.data?.posts ?? [];
    return all
      .filter((post) => {
        if (competitionId && post.competitionId !== competitionId) return false;
        if (selectedClubId !== "all" && post.clubId !== selectedClubId) return false;
        if (selectedTeamId === "all") return true;
        if (selectedTeamId.startsWith("ml:")) return post.miniLeagueId === selectedTeamId.slice(3);
        return post.teamId === selectedTeamId;
      })
      .map((post) => ({
        ...post,
        ownerAvatarUrl: (post.ownerId === user?.id || post.ownerId === principal)
          ? profile?.avatar_url ?? post.ownerAvatarUrl
          : post.ownerAvatarUrl,
        assets: post.assets.map((a) =>
          resolvedUrls[a.id] ? { ...a, url: resolvedUrls[a.id], loading: false } : a,
        ),
      }));
  }, [feedQuery.data?.posts, selectedClubId, selectedTeamId, resolvedUrls, user?.id, principal, profile?.avatar_url]);

  // Read comments from the freshest feed copy, not the snapshot taken when
  // the sheet opened, and keep just-sent comments until the canister has them.
  const activeComments = useMemo<LiveCommentView[]>(() => {
    if (!commentPost) return [];
    const live = feedQuery.data?.posts.find((p) => p.id === commentPost.id) ?? commentPost;
    const pending = (pendingComments[commentPost.id] ?? []).filter(
      (pc) => !live.comments.some((c) => c.text === pc.text),
    );
    // Your own comments always show your name, even if the batch profile
    // lookup missed it (e.g. linked accounts keyed by an older id).
    const ownName = profile?.display_name || null;
    return [...live.comments, ...pending].map((c) =>
      ownName && principal && c.user_id === principal && (!c.profiles?.display_name || c.profiles.display_name === "You")
        ? { ...c, profiles: { ...c.profiles, display_name: ownName, avatar_url: c.profiles?.avatar_url ?? profile?.avatar_url ?? null } }
        : c,
    );
  }, [commentPost, feedQuery.data?.posts, pendingComments, principal, profile?.display_name, profile?.avatar_url]);

  const options = feedQuery.data?.options;
  const hasFilters = (options?.clubs.length ?? 0) > 1 || (options?.teams.length ?? 0) > 0;
  const hasActiveFilters = selectedClubId !== "all" || selectedTeamId !== "all";

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

  // Match SupabaseMediaPage: render as page content inside the shared app
  // shell (AppHeader/BottomNav own the chrome) — no min-h-screen, no sticky
  // page header, title row sits inline like every other page.
  return (
    <div className="py-6 pb-32 space-y-6 soft-reveal">
      <div className="flex items-center justify-between gap-2 min-h-10">
        <h1 className="text-2xl font-bold">Media</h1>
        <div className="flex items-center gap-2">
          {hasFilters && (
            <Button
              variant={hasActiveFilters ? "default" : "outline"}
              size="icon"
              aria-label="Filter"
              onClick={() => setFilterOpen(true)}
              className="relative"
            >
              <Filter className="h-4 w-4" />
              {hasActiveFilters && (
                <span className="absolute -top-1 -right-1 h-2.5 w-2.5 rounded-full bg-primary" />
              )}
            </Button>
          )}
          <CreateActionButton ariaLabel="Add photos" onClick={() => setUploadOpen(true)} />
        </div>
      </div>
      <div className="max-w-lg mx-auto">
        <MediaHeaderSponsorStrip clubId={selectedClubId !== "all" ? selectedClubId : undefined} />
      </div>

      <main className="mx-auto w-full max-w-lg flex-1">
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

        {feedQuery.isSuccess && posts.length === 0 && pendingPreviews.length === 0 && (
          <div className="flex flex-col items-center gap-4 py-16 text-center">
            <Images className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No media yet</p>
            <Button onClick={() => setUploadOpen(true)}>Add photos</Button>
          </div>
        )}

        <div className="space-y-6">
          {pendingPreviews.map((pending) => (
            <div key={pending.src} className="relative overflow-hidden rounded-xl border bg-card">
              <div className="flex items-center gap-3 px-3 py-2.5">
                <Avatar className="h-9 w-9">
                  <AvatarImage src={profile?.avatar_url || undefined} alt={profile?.display_name || "You"} className="object-cover" />
                  <AvatarFallback>
                    {(profile?.display_name || "You").slice(0, 2).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{profile?.display_name || "You"}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {pending.scopeName ? `${pending.clubName} · ${pending.scopeName}` : pending.clubName}
                  </p>
                </div>
              </div>
              <img src={pending.src} alt="" className="aspect-square w-full object-cover" />
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                <p className="text-xs font-medium text-foreground">Uploading…</p>
              </div>
            </div>
          ))}
          {posts.map((post, index) => (
            <div key={post.id}>
              <article className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={post.ownerAvatarUrl || undefined} alt={post.ownerName} className="object-cover" />
                    <AvatarFallback>{((post.ownerId === user?.id || post.ownerId === principal) ? profile?.display_name || post.ownerName : post.ownerName).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{(post.ownerId === user?.id || post.ownerId === principal) ? profile?.display_name || post.ownerName : post.ownerName}</p>
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
                    photos={post.assets.map((asset) => ({
                      id: asset.id,
                      // Still-unlocked photos pass no URL so the carousel's
                      // LazyImage renders its pulsing skeleton until the
                      // decrypted bytes arrive.
                      file_url: asset.loading ? null : asset.url,
                    }))}
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
                      if (mine) reactionMutation.mutate({ post, emoji: mine.reaction_type, remove: true });
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
          onUploaded={() => queryClient.refetchQueries({ queryKey: ["icp-media-feed"] })}
          onPendingChange={setPendingPreviews}
          clubs={options.clubs}
          teams={options.teams}
          miniLeagues={options.miniLeagues}
          competitions={options.competitions}
          defaultClubId={selectedClubId !== "all" ? selectedClubId : undefined}
          defaultCompetitionId={competitionId ?? undefined}
        />
      )}

      <MediaCommentSheet
        open={commentPost !== null}
        onOpenChange={(open) => {
          if (!open) setCommentPost(null);
        }}
        photoUrl={commentPost?.assets[0]?.url ?? ""}
        uploaderName={
          commentPost
            ? (commentPost.ownerId === principal || commentPost.ownerId === user?.id) && profile?.display_name
              ? profile.display_name
              : commentPost.ownerName
            : null
        }
        teamName={commentPost ? subtitleFor(commentPost) : null}
        uploaderAvatar={commentPost
          ? (commentPost.ownerId === principal || commentPost.ownerId === user?.id)
            ? profile?.avatar_url ?? commentPost.ownerAvatarUrl
            : commentPost.ownerAvatarUrl
          : null}
        teamId={commentPost?.teamId}
        clubId={commentPost?.clubId}
        miniLeagueId={commentPost?.miniLeagueId}
        comments={activeComments}
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
