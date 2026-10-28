import { readContentInScope } from "@/live/contentRouting";
import { readClubsInOwnGroups } from "@/live/crossGroupClubs";
import { writeOnce } from "@/live/clubScope";
import { useSearchParams } from "react-router-dom";
import { useEffect, useMemo, useRef, useState } from "react";
import { isCancelledError, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Filter, Images, Loader2, MessageCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";
import { withFeatureBackend } from "@/live/featureRouter";
import type { FeatureBackendContext } from "@/live/featureRouter";
import {
  addLiveComment,
  addLiveReaction,
  removeLiveGalleryAsset,
  getLiveAsset,
  getLiveGalleryChatCard,
  listLiveAssetsPage,
  listLiveComments,
  listLiveReactions,
  liveAssetSource,
  removeLiveReaction,
} from "@/live/features/media";
import { readCachedIcpBlobObjectUrl, resolveIcpBlobObjectUrl, storedIcpPrincipal } from "@/live/mediaDecrypt";
import { getLiveTeam, listLiveTeams } from "@/live/features/club";
import { listLiveMiniLeaguesByClub } from "@/live/features/miniLeagues";
import { listLiveCompetitions } from "@/live/features/competitions";
import { getLiveMyRoleGrants } from "@/live/features/membership";
import { listLiveProfilesByIds } from "@/live/features/identityAccessClient";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ClubTeamFilter } from "@/components/ClubTeamFilter";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useAuth } from "@/hooks/useAuth";
import { useStableVisibleList } from "@/hooks/useStableVisibleList";
import { useReadingPosition } from "@/hooks/useReadingPosition";
import { AlbumCarousel } from "@/components/AlbumCarousel";
import { EmojiReactions } from "@/components/EmojiReactions";
import { MediaCommentSheet } from "@/components/MediaCommentSheet";
import { PhotoLightbox } from "@/components/PhotoLightbox";
import { CreateActionButton } from "@/components/CreateActionButton";
import { MediaHeaderSponsorStrip } from "@/components/media/MediaHeaderSponsorStrip";
import { MediaSponsorTile } from "@/components/media/MediaSponsorTile";
import { IcpUploadPhotoSheet } from "@/components/media/IcpUploadPhotoSheet";
import { usePendingGalleryUploads, reconcileGalleryUploads } from './pendingGalleryUploads';
import { acknowledgedGalleryPosts } from './acknowledgedGalleryPosts';
import { localUploadPreviews } from "@/components/media/localUploadPreviews";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { mediaProfileDirectory } from "./mediaProfileDirectory";
import { galleryCommentFromReceipt, mergeGalleryComments } from "./galleryComments";
import { readMediaSources, type MediaSourceStatus } from './mediaSourceState';
import { updateMemberReaction } from './reactionUpdates';
import type { MediaPageCursor } from '@/live/mediaPaging';
import { retainMediaFeed } from './retainMediaFeed';
import { galleryLinkState, galleryCanModerate } from './galleryNavigation';
import { useBlockedUsers } from '@/hooks/useBlockedUsers';
import { BlockUserDialog } from '@/components/BlockUserDialog';

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
  reply_to_id?: string | null;
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
  eventId?: string | null;
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
  sources?: MediaSourceStatus[];
  incomplete?: boolean;
  hasMore?: boolean;
}
export interface MediaFeedContinuation { loadMore?: () => Promise<LiveMediaFeed> }
type LivePostDetails = Pick<LiveMediaPost, 'reactions' | 'comments' | 'ownerName' | 'ownerAvatarUrl'>;

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
  // Photos that failed (often right after resuming, while the connection
  // wakes up) are retried a few times and again when the app is reopened,
  // instead of staying on "could not be loaded" until a restart.
  const failuresRef = useRef(new Map<string, number>());
  const [retryTick, setRetryTick] = useState(0);
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== "visible" || !failuresRef.current.size) return;
      for (const id of failuresRef.current.keys()) doneRef.current.delete(id);
      failuresRef.current.clear();
      setRetryTick((t) => t + 1);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("online", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); window.removeEventListener("online", onVisible); };
  }, []);
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
          const src = asset.sourceUrl;
          if (!src) return;
          const known = sessionPhotoUrls.get(src) ?? localUploadPreviews.get(src);
          if (known) return show(asset, known, false);
          const cached = await readCachedIcpBlobObjectUrl(src).catch(() => null);
          if (cancelled) return;
          if (cached) show(asset, cached, true);
          else misses.push(asset);
        }),
      );
      const order = new Map(pending.map((a, i) => [a.id, i]));
      misses.sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
      const worker = async () => {
        while (!cancelled && misses.length) {
          const asset = misses.shift();
          if (!asset?.sourceUrl) continue;
          let resolved: string | null = null;
          let lastError: unknown = null;
          for (const delay of [0, 2_000, 6_000]) {
            if (delay) await new Promise((r) => setTimeout(r, delay));
            if (cancelled) return;
            try { resolved = await resolveIcpBlobObjectUrl(asset.sourceUrl); lastError = null; break; }
            catch (err) { lastError = err; }
          }
          if (cancelled) return;
          if (resolved) { failuresRef.current.delete(asset.id); show(asset, resolved, true); continue; }
          if (lastError) console.warn("[icp-media-feed] could not load asset", asset.id, lastError);
          failuresRef.current.set(asset.id, (failuresRef.current.get(asset.id) ?? 0) + 1);
          show(asset, UNAVAILABLE_PHOTO_URL, false);
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
  }, [posts, retryTick]);
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
  if (feed.incomplete) return;
  try {
    const trimmed = { ...feed, posts: feed.posts.slice(0, 60) };
    localStorage.setItem(FEED_SNAPSHOT_PREFIX + principal, JSON.stringify(trimmed));
  } catch {
    /* storage full — snapshot is only a speed-up */
  }
}

export async function loadLiveMediaFeed(ctx: FeatureBackendContext, onUpdate?: (feed: LiveMediaFeed) => void,
  continuation?: MediaFeedContinuation, signal?: AbortSignal): Promise<LiveMediaFeed> {
  // list_clubs returns every club on the canister, so scope it to the
  // caller's own role grants — same membership the Clubs page uses.
  const { clubDispatch } = await import('@/live/groupDispatch');
  const [grants, verifiedIds] = await Promise.all([getLiveMyRoleGrants(ctx), clubDispatch.memberClubIds()]);
  const grantClubIds = new Set(grants.map((g) => g.club[0]).filter((c): c is string => !!c));
  const grantTeamIds = new Set(grants.map((g) => g.team[0]).filter((t): t is string => !!t));
  await Promise.all(grants.filter(g => g.team[0] && !g.club[0]).map(async grant => {
    const teamId = grant.team[0];
    if (!teamId) return;
    const teams = await readContentInScope(ctx, 'membership', { teamId }, scoped => getLiveTeam(scoped, teamId));
    const clubId = teams[0]?.club_id;
    if (clubId) grantClubIds.add(clubId);
  }));
  const clubIds = [...new Set([...verifiedIds, ...grantClubIds])];

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
    event_id?: [] | [string];
    caption: [] | [string];
    album_id: [] | [string];
    blob_ref: [] | [unknown];
    deleted: boolean;
  }[] = [];

  let sources: MediaSourceStatus[] = clubIds.map(clubId => ({ clubId, state: "loading" }));
  const cursors = new Map<string, MediaPageCursor>();
  const publish = () => { if (!signal?.aborted) onUpdate?.(buildFeed()); };
  const fetchPage = (clubId: string, cursor: MediaPageCursor | null) => {
    if (signal?.aborted) throw new Error('Media request cancelled');
    return readContentInScope(ctx, 'media', { clubId }, scoped => listLiveAssetsPage(scoped, clubId, cursor));
  };
  async function readPage(clubId: string, cursor: MediaPageCursor | null, prefetched?: ReturnType<typeof fetchPage>) {
    const page = await (prefetched ?? fetchPage(clubId, cursor));
    if (signal?.aborted) throw new Error('Media request cancelled');
    for (const asset of page.assets as unknown as (typeof rawAssets)[number][]) {
      if (!asset.deleted && (asset.kind === 'photo' || asset.kind === 'video')) rawAssets.push(asset);
    }
    if (page.next) cursors.set(clubId, page.next); else cursors.delete(clubId);
    publish();
  }
  const sourceRead = readMediaSources(clubIds, async clubId => {
      // Each profile gates only its own assets, never another club's source.
      // Keep the authorized owning-group profile/tombstone check before media.
      const profiles = await readClubsInOwnGroups(ctx, [clubId]);
      const club = profiles.values[0];
      if (!club) return;
      // Soft-deleted clubs keep their canister records (and assets) — never
      // surface them in the feed, the filter drawer, or the upload sheet.
      if (club.deleted_at_ms.length > 0) return;
      const directMember = verifiedIds.includes(club.id) || grantClubIds.has(club.id);
      if (!directMember && grantTeamIds.size === 0) return;
      if (!directMember) {
        const clubTeams = (await readContentInScope(ctx, "membership", { clubId: club.id }, scoped => listLiveTeams(scoped, club.id))) as unknown as { id: string }[];
        if (!clubTeams.some((t) => grantTeamIds.has(t.id))) return;
      }
      options.clubs.push({ id: club.id, name: club.name, sport: club.sport[0] ?? null });
      const metadata = Promise.all([
        readContentInScope(ctx, "membership", { clubId: club.id }, scoped => listLiveTeams(scoped, club.id)),
        readContentInScope(ctx, "mini_leagues", { clubId: club.id }, scoped => listLiveMiniLeaguesByClub(scoped, club.id)),
        readContentInScope(ctx, "competitions", { clubId: club.id }, scoped => listLiveCompetitions(scoped, club.id)),
      ]);
      metadata.catch(() => undefined);
      await readPage(club.id, null);
      const [teams, miniLeagues, competitions] = await metadata;
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
    }, snapshot => { sources = snapshot.sources; publish(); });

  function buildFeed(): LiveMediaFeed {
  // Photos are unlocked in the background by the page (see useResolvedAssetUrls)
  // so the feed paints as soon as the post list is known instead of waiting
  // for every encrypted photo to download and decrypt.
  const assetViews = new Map<string, LiveAssetView>();
  for (const asset of new Map(rawAssets.map(row => [row.id, row])).values()) {
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
  for (const asset of new Map(rawAssets.map(row => [row.id, row])).values()) {
    if (!assetViews.has(asset.id)) continue;
    const key = `${asset.club_id}:${asset.album_id[0] ?? asset.id}`;
    const group = groups.get(key) ?? [];
    group.push(asset);
    groups.set(key, group);
  }

  const posts: LiveMediaPost[] = [...groups.entries()].map(([key, group]) => {
      const sorted = [...group].sort((a, b) => Number(a.created_at_ms - b.created_at_ms));
      const first = sorted[0];
      const ownerId = first.owner.toText();
      const reactions: LiveReactionView[] = [];
      const comments: LiveCommentView[] = [];
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
        eventId: (first as typeof first & { event_id?: string[] }).event_id?.[0] ?? null,
        createdAtMs: Number(first.created_at_ms),
        reactions,
        comments,
      } satisfies LiveMediaPost;
    });

  posts.sort((a, b) => b.createdAtMs - a.createdAtMs);
  options.clubs.sort((a, b) => a.name.localeCompare(b.name));
  return { posts, options: { clubs: [...options.clubs], teams: [...options.teams], miniLeagues: [...options.miniLeagues], competitions: [...options.competitions] }, sources: [...sources], hasMore: cursors.size > 0, incomplete: cursors.size > 0 || sources.some(source => source.state !== "ready") };
  }
  await sourceRead;
  if (continuation) {
    let pending: Promise<LiveMediaFeed> | undefined;
    continuation.loadMore = () => {
      if (pending) return pending;
      pending = (async () => {
        await Promise.all([...cursors].map(async ([clubId, cursor]) => {
          sources = sources.map(s => s.clubId === clubId ? { ...s, state: 'loading' } : s);
          publish();
          try {
            await readPage(clubId, cursor);
            sources = sources.map(s => s.clubId === clubId ? { ...s, state: 'ready' } : s);
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            const denied = /forbidden|not authorized|access denied|admission denied|removal fenced/i.test(message);
            // Never silently restart an invalidated cursor or erase another club.
            cursors.delete(clubId);
            sources = sources.map(s => s.clubId === clubId ? { ...s, state: denied ? 'denied' : 'failed' } : s);
          }
          publish();
        }));
        return buildFeed();
      })().finally(() => { pending = undefined; });
      return pending;
    };
  }
  return buildFeed();
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
  const continuationRef = useRef<MediaFeedContinuation>({});
  const olderSentinel = useRef<HTMLDivElement>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);

  const [filterOpen, setFilterOpen] = useState(false);
  const [uploadOpen, setUploadOpen] = useState(false);
  const pendingUploads = usePendingGalleryUploads(queryClient, principal);
  // Home's "Add photos" shortcut and gallery prompts link to /media?upload=1.
  const [searchParams, setSearchParams] = useSearchParams();
  const competitionId = searchParams.get("competition");
  const link = galleryLinkState(searchParams);
  const { isBlocked } = useBlockedUsers();
  const [blockTarget, setBlockTarget] = useState<LiveMediaPost | null>(null);
  const [replyingTo, setReplyingTo] = useState<{ id: string; name: string } | null>(null);
  const rolesQuery = useQuery({ queryKey: ['icp-gallery-moderation', principal], enabled: !!principal,
    queryFn: () => withFeatureBackend('membership', { supabase: async () => [], icp: getLiveMyRoleGrants }, { shared: 'person' }) });
  const canDeletePost = (post: LiveMediaPost) => post.ownerId === principal || galleryCanModerate(rolesQuery.data ?? [], post.clubId, post.teamId);
  useEffect(() => {
    if (searchParams.get("upload") !== "1") return;
    setUploadOpen(true);
    const next = new URLSearchParams(searchParams);
    next.delete("upload");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);
  const [selectedClubId, setSelectedClubId] = useState(link.clubId ?? "all");
  const [selectedTeamId, setSelectedTeamId] = useState(link.teamId ?? "all");
  // Follow the top-left club switcher: when the app is filtered to one club,
  // the feed must not show other clubs' media.
  const { activeClubFilter } = useClubTheme();
  const effectiveClubId = activeClubFilter ?? selectedClubId;
  const readingPosition = useReadingPosition(true, JSON.stringify([principal, effectiveClubId, selectedTeamId, competitionId, link.photoId, link.eventId, link.cardId]));
  useEffect(() => {
    setSelectedClubId(activeClubFilter ?? "all");
    setSelectedTeamId(link.teamId ?? "all");
  }, [activeClubFilter, link.teamId]);
  const [commentPost, setCommentPost] = useState<LiveMediaPost | null>(null);
  const [commentInput, setCommentInput] = useState("");
  const [pendingComments, setPendingComments] = useState<Record<string, LiveCommentView[]>>({});
  const [commentError, setCommentError] = useState<string | null>(null);
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const [actionPost, setActionPost] = useState<LiveMediaPost | null>(null);
  const pressTimerRef = useRef<number | null>(null);

  const feedQuery = useQuery({
    queryKey: ["icp-media-feed", principal],
    enabled: !!principal,
    // Last visit's feed shows instantly; the fresh one replaces it when ready.
    initialData: () => readFeedSnapshot(principal),
    initialDataUpdatedAt: 0,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    queryFn: async ({ signal }) => {
      const continuation: MediaFeedContinuation = {};
      continuationRef.current = continuation;
      const feed = await withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: (ctx) => loadLiveMediaFeed(ctx, next => {
          if (!signal.aborted) queryClient.setQueryData<LiveMediaFeed>(["icp-media-feed", principal], previous => retainMediaFeed(previous, next));
        }, continuation, signal),
      }, { shared: "person" });
      if (signal.aborted) throw new Error("Media request cancelled");
      const retained = retainMediaFeed(queryClient.getQueryData<LiveMediaFeed>(["icp-media-feed", principal]), feed);
      if (principal) writeFeedSnapshot(principal, retained);
      return retained;
    },
  });
  // A load interrupted by an instant on-screen update is not a failure: restart it quietly.
  useEffect(() => {
    if (feedQuery.isError && isCancelledError(feedQuery.error) && !feedQuery.isFetching) void feedQuery.refetch();
  }, [feedQuery.isError, feedQuery.error, feedQuery.isFetching]);

  const loadOlder = async () => {
    const continuation = continuationRef.current;
    if (!continuation.loadMore || loadingOlder || feedQuery.isFetching) return;
    setLoadingOlder(true);
    try {
      const feed = await continuation.loadMore();
      if (continuationRef.current !== continuation) return;
      const retained = retainMediaFeed(queryClient.getQueryData<LiveMediaFeed>(['icp-media-feed', principal]), feed);
      queryClient.setQueryData(['icp-media-feed', principal], retained);
      if (principal) writeFeedSnapshot(principal, retained);
    } finally { setLoadingOlder(false); }
  };

  useEffect(() => {
    const sentinel = olderSentinel.current;
    if (!sentinel || !feedQuery.data?.hasMore || loadingOlder || feedQuery.isFetching) return;
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) void loadOlder();
    }, { rootMargin: '1000px', threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [principal, feedQuery.data?.hasMore, feedQuery.data?.posts.length, loadingOlder, feedQuery.isFetching]);

  const invalidate = () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ["icp-media-feed"] }),
    queryClient.invalidateQueries({ queryKey: ["icp-media-post-details", principal] }),
  ]);

  // Opening comments reads only this album, not the entire multi-group gallery.
  const commentQueryKey = ["icp-gallery-comments", principal, commentPost?.clubId, commentPost?.representativeAssetId];
  const commentsQuery = useQuery({
    queryKey: commentQueryKey,
    enabled: !!principal && !!commentPost,
    queryFn: async () => {
      if (!commentPost) return [];
      const post = commentPost;
      const rows = await withFeatureBackend("media", {
        supabase: async () => { throw new Error("unreachable"); },
        icp: ctx => listLiveComments(ctx, post.representativeAssetId),
      }, { clubId: post.clubId });
      return rows.filter(c => !c.deleted).map(galleryCommentFromReceipt);
    },
    retry: 1,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
  });

  const reactionEdits = useRef(new Map<string, number>());
  const reactionMutation = useMutation({
    scope: { id: 'icp-gallery-reactions' },
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
      }, writeOnce({ clubId: post.clubId })),
    // Instant on-screen update; the canister save finishes in the background.
    onMutate: async ({ post, emoji, remove }) => {
      const key = ["icp-media-feed", principal];
      const detailsKey = ['icp-media-post-details', principal, post.clubId, post.representativeAssetId];
      const edit = (reactionEdits.current.get(post.id) ?? 0) + 1;
      reactionEdits.current.set(post.id, edit);
      await Promise.all([queryClient.cancelQueries({ queryKey: key }), queryClient.cancelQueries({ queryKey: detailsKey })]);
      const previous = queryClient.getQueryData<LiveMediaFeed>(key);
      const previousDetails = queryClient.getQueryData<LivePostDetails>(detailsKey);
      const previousMine = post.reactions.filter(r => r.user_id === principal);
      const mine: LiveReactionView[] = remove || !principal ? [] : [{ user_id: principal, reaction_type: emoji, profiles: { display_name: 'You', avatar_url: null } }];
      if (principal) queryClient.setQueryData<LivePostDetails>(detailsKey, old => ({
        ...(old ?? { ownerName: post.ownerName, ownerAvatarUrl: post.ownerAvatarUrl, comments: post.comments, reactions: post.reactions }),
        reactions: updateMemberReaction(old?.reactions ?? post.reactions, principal, mine),
      }));
      if (previous && principal) {
        queryClient.setQueryData<LiveMediaFeed>(key, {
          ...previous,
          posts: previous.posts.map((p) => {
            if (p.id !== post.id) return p;
            return {
              ...p,
              reactions: updateMemberReaction(p.reactions, principal, mine),
            };
          }),
        });
      }
      return { previousMine, previousDetails, detailsKey, key, edit, postId: post.id };
    },
    onError: (err, _vars, context) => {
      if (context && principal && reactionEdits.current.get(context.postId) === context.edit) {
        queryClient.setQueryData<LiveMediaFeed>(context.key, old => old && ({ ...old, posts: old.posts.map(post => post.id === context.postId
          ? { ...post, reactions: updateMemberReaction(post.reactions, principal, context.previousMine) } : post) }));
        queryClient.setQueryData<LivePostDetails>(context.detailsKey, old => old && ({ ...old, reactions: updateMemberReaction(old.reactions, principal,
          context.previousDetails?.reactions.filter(r => r.user_id === principal) ?? context.previousMine) }));
      }
      toast.error(err instanceof Error ? err.message : "Reaction failed");
    },
    onSettled: () => { if (queryClient.isMutating({ mutationKey: ['icp-gallery-reaction'] }) <= 1) return invalidate(); },
    mutationKey: ['icp-gallery-reaction'],
  });

  const commentMutation = useMutation({
    mutationFn: async ({ post, text, replyToId }: { post: LiveMediaPost; text: string; replyToId?: string }) =>
      withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: (ctx) => addLiveComment(ctx, post.representativeAssetId, text, Date.now(), replyToId),
      }, writeOnce({ clubId: post.clubId })),
    // Show the comment the moment Send is tapped; the feed refetch replaces
    // it with the canister copy (the sheet reads the live post).
    onMutate: ({ post, text, replyToId }) => {
      setCommentError(null);
      setCommentInput("");
      setReplyingTo(null);
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
            reply_to_id: replyToId ?? null,
            profiles: { display_name: "You", avatar_url: null },
          },
        ],
      }));
      return { pendingId };
    },
    onSuccess: (receipt, { post }, context) => {
      const saved = {
        ...galleryCommentFromReceipt(receipt),
        profiles: { display_name: profile?.display_name ?? "You", avatar_url: profile?.avatar_url ?? null },
      };
      setPendingComments(prev => ({ ...prev, [post.id]: mergeGalleryComments(
        (prev[post.id] ?? []).filter(c => c.id !== context?.pendingId), [saved]),
      }));
      const key = ["icp-gallery-comments", principal, post.clubId, post.representativeAssetId];
      queryClient.setQueryData<LiveCommentView[]>(key, old => mergeGalleryComments(old ?? [], [saved]));
      queryClient.setQueryData<LiveMediaFeed>(["icp-media-feed", principal], old => {
        if (!old) return old;
        const next = { ...old, posts: old.posts.map(p => p.id === post.id
          ? { ...p, comments: mergeGalleryComments(p.comments, [saved]) } : p) };
        if (principal) writeFeedSnapshot(principal, next);
        return next;
      });
      void queryClient.invalidateQueries({ queryKey: key });
    },
    onError: (err, { post, text }, context) => {
      setPendingComments((prev) => ({
        ...prev,
        [post.id]: (prev[post.id] ?? []).filter((c) => c.id !== context?.pendingId),
      }));
      setCommentInput(current => current || text);
      setCommentError("Your comment wasn't posted. Please try sending it again.");
      toast.error(err instanceof Error ? err.message : "Comment failed");
    },
    onSettled: invalidate,
  });

  const deleteMutation = useMutation({
    mutationFn: async ({ post, mode }: { post: LiveMediaPost; mode: 'feed_only' | 'feed_and_vault' }) =>
      withFeatureBackend("media", {
        supabase: async () => {
          throw new Error("unreachable");
        },
        icp: async (ctx) => {
          for (const asset of post.assets) {
            await removeLiveGalleryAsset(ctx, asset.id, mode);
          }
        },
      }, writeOnce({ photoId: post.representativeAssetId })),
    onSuccess: () => toast.success("Deleted"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "Delete failed"),
    onSettled: invalidate,
  });

  const linkedFeedAsset = useQuery({ queryKey: ['icp-gallery-linked-post', principal, link.photoId], enabled: !!principal && !!link.photoId,
    queryFn: async () => withFeatureBackend('media', { supabase: async () => null, icp: async ctx => {
      const asset = await getLiveAsset(ctx, link.photoId ?? ''); if (!asset) return null;
      const source = liveAssetSource(asset);
      return { id: asset.album_id[0] ?? asset.id, representativeAssetId: asset.id, assets: [{ id: asset.id, url: LOADING_PHOTO_URL,
        sourceUrl: source.kind === 'icp-blob' ? source.url : null, loading: true, isVideo: asset.mime.startsWith('video/') }],
        ownerId: asset.owner.toText(), ownerName: 'Member', ownerAvatarUrl: null, clubId: asset.club_id, clubName: '',
        teamId: asset.team_id[0] ?? null, teamName: null, miniLeagueId: asset.mini_league_id[0] ?? null, miniLeagueName: null,
        competitionId: asset.competition_id[0] ?? null, competitionName: null, eventId: asset.event_id[0] ?? null,
        caption: asset.caption[0] ?? null, createdAtMs: Number(asset.created_at_ms), reactions: [], comments: [] } satisfies LiveMediaPost;
    } }, { photoId: link.photoId ?? undefined }) });
  const galleryCardQuery = useQuery({ queryKey: ['icp-gallery-card', principal, link.cardId], enabled: !!principal && !!link.cardId,
    queryFn: () => withFeatureBackend('media', { supabase: async () => null,
      icp: ctx => getLiveGalleryChatCard(ctx, link.cardId ?? '') }, { galleryCardId: link.cardId ?? undefined }) });
  const cardPhotoQuery = useQuery({ queryKey: ['icp-gallery-card-assets', principal, link.cardId], enabled: !!principal && !!galleryCardQuery.data,
    queryFn: async () => {
      const card = galleryCardQuery.data; if (!card) return [];
      return withFeatureBackend('media', { supabase: async () => [], icp: async ctx => {
        const rows = await Promise.all(card.photo_ids.slice(0, 200).map(id => getLiveAsset(ctx, id)));
        return rows.flatMap(asset => { if (!asset) return []; const source = liveAssetSource(asset);
          return [{ id: asset.album_id[0] ?? asset.id, representativeAssetId: asset.id, assets: [{ id: asset.id, url: LOADING_PHOTO_URL,
            sourceUrl: source.kind === 'icp-blob' ? source.url : null, loading: true, isVideo: asset.mime.startsWith('video/') }], ownerId: asset.owner.toText(),
            ownerName: 'Member', ownerAvatarUrl: null, clubId: asset.club_id, clubName: '', teamId: asset.team_id[0] ?? null, teamName: null,
            miniLeagueId: asset.mini_league_id[0] ?? null, miniLeagueName: null, competitionId: asset.competition_id[0] ?? null, competitionName: null,
            eventId: asset.event_id[0] ?? null, caption: asset.caption[0] ?? null, createdAtMs: Number(asset.created_at_ms), reactions: [], comments: [] } satisfies LiveMediaPost]; });
      } }, { clubId: card.club_id });
    } });
  const allFeedPosts = useMemo(() => {
    const loaded = feedQuery.data?.posts ?? [];
    const linked = linkedFeedAsset.data;
    const known = new Set(loaded.flatMap(p => p.assets.map(a => a.id)));
    const extra = (cardPhotoQuery.data ?? []).filter(p => !known.has(p.representativeAssetId));
    const confirmed = [...(linked && !known.has(link.photoId ?? '') ? [linked] : []), ...extra, ...loaded];
    const local = principal ? acknowledgedGalleryPosts(pendingUploads, principal) : [];
    const merged = confirmed.map(post => {
      const addition = local.find(row => row.clubId === post.clubId && row.id === post.id);
      if (!addition) return post;
      const ids = new Set(post.assets.map(asset => asset.id));
      return { ...post, assets: [...post.assets, ...addition.assets.filter(asset => !ids.has(asset.id))] };
    });
    return [...local.filter(row => !confirmed.some(post => post.clubId === row.clubId && post.id === row.id)), ...merged];
  }, [feedQuery.data?.posts, linkedFeedAsset.data, link.photoId, cardPhotoQuery.data, pendingUploads, principal]);
  useEffect(() => {
    if (principal) reconcileGalleryUploads(queryClient, principal, (feedQuery.data?.posts ?? []).flatMap(post => post.assets.map(asset => asset.id)));
  }, [principal, queryClient, feedQuery.data?.posts]);
  const loadedAssetIds = new Set(allFeedPosts.flatMap(post => post.assets.map(asset => asset.id)));
  const pendingPreviews = pendingUploads.filter(row => (!row.assetId || !loadedAssetIds.has(row.assetId))
    && (effectiveClubId === 'all' || row.clubId === effectiveClubId)
    && (selectedTeamId === 'all' || row.teamId === selectedTeamId)
    && (!competitionId || row.competitionId === competitionId));
  const resolvedUrls = useResolvedAssetUrls(allFeedPosts);
  const freshPosts = useMemo(() => {
    const all = allFeedPosts;
    return all
      .filter((post) => {
        if (isBlocked(post.ownerId)) return false;
        if (link.cardId && !post.assets.some(a => galleryCardQuery.data?.photo_ids.includes(a.id))) return false;
        if (link.eventId && post.eventId !== link.eventId) return false;
        if (competitionId && post.competitionId !== competitionId) return false;

        if (effectiveClubId !== "all" && post.clubId !== effectiveClubId) return false;
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
  }, [allFeedPosts, link.photoId, effectiveClubId, selectedTeamId, resolvedUrls, user?.id, principal, profile?.avatar_url, isBlocked, link.eventId, link.cardId, galleryCardQuery.data]);
  const posts = useStableVisibleList(freshPosts, {
    enabled: true,
    scope: JSON.stringify([principal, effectiveClubId, selectedTeamId, competitionId, link.photoId, link.eventId, link.cardId]),
    key: post => `${post.clubId}:${post.id}`,
  });

  // Read comments from the freshest feed copy, not the snapshot taken when
  // the sheet opened, and keep just-sent comments until the canister has them.
  const activeComments = useMemo<LiveCommentView[]>(() => {
    if (!commentPost) return [];
    const live = feedQuery.data?.posts.find((p) => p.id === commentPost.id) ?? commentPost;
    // Your own comments always show your name, even if the batch profile
    // lookup missed it (e.g. linked accounts keyed by an older id).
    const ownName = profile?.display_name || null;
    return mergeGalleryComments(mergeGalleryComments(commentsQuery.data ?? [], live.comments), pendingComments[commentPost.id] ?? []).map((c) =>
      ownName && principal && c.user_id === principal && (!c.profiles?.display_name || c.profiles.display_name === "You")
        ? { ...c, profiles: { ...c.profiles, display_name: ownName, avatar_url: c.profiles?.avatar_url ?? profile?.avatar_url ?? null } }
        : c,
    );
  }, [commentPost, feedQuery.data?.posts, commentsQuery.data, pendingComments, principal, profile?.display_name, profile?.avatar_url]);

  const options = feedQuery.data?.options;
  const filterTeams = options?.teams.filter(team => effectiveClubId === "all" || team.club_id === effectiveClubId) ?? [];
  const filterMiniLeagues = options?.miniLeagues.filter(league => effectiveClubId === "all" || league.club_id === effectiveClubId) ?? [];
  const hasFilters = (!activeClubFilter && (options?.clubs.length ?? 0) > 1) || filterTeams.length > 0 || filterMiniLeagues.length > 0;
  const hasActiveFilters = (!activeClubFilter && selectedClubId !== "all") || selectedTeamId !== "all";

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

  const handledLink = useRef<string | null>(null);
  useEffect(() => {
    if (!link.photoId) { handledLink.current = null; return; }
    if (handledLink.current === `${link.photoId}:${link.comments}`) return;
    const index = flatPhotos.findIndex(photo => photo.id === link.photoId);
    if (index < 0) return;
    handledLink.current = `${link.photoId}:${link.comments}`;
    if (link.comments) setCommentPost(flatPhotos[index].post); else setLightboxIndex(index);
  }, [link.photoId, link.comments, flatPhotos]);
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
    <div ref={readingPosition} className="py-6 pb-32 space-y-6 soft-reveal">
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
        {(feedQuery.isLoading || feedQuery.isFetching || feedQuery.data?.sources?.some(source => source.state === "loading") || (feedQuery.isError && isCancelledError(feedQuery.error))) && !feedQuery.data?.posts.length && (
          <div className="space-y-6" aria-label="Photos loading">
            <PhotoSkeleton />
            <PhotoSkeleton />
          </div>
        )}

        {feedQuery.isError && !isCancelledError(feedQuery.error) && (
          <div className="flex flex-col items-center gap-3 py-16 text-center">
            <p className="text-sm text-muted-foreground">
              {feedQuery.error instanceof Error ? feedQuery.error.message : "Media could not be loaded."}
            </p>
            <Button variant="outline" onClick={() => feedQuery.refetch()}>
              Try again
            </Button>
          </div>
        )}
        {feedQuery.data?.sources?.some(source => source.state === 'failed' || source.state === 'denied') && !feedQuery.data.sources?.some(source => source.state === "loading") && (
          <div className="flex items-center justify-between gap-3 py-3" role="status">
            <p className="text-sm text-muted-foreground">Some club media couldn't be loaded.</p>
            <Button variant="outline" onClick={() => feedQuery.refetch()}>Try again</Button>
          </div>
        )}

        {feedQuery.isSuccess && !feedQuery.data?.incomplete && posts.length === 0 && pendingPreviews.length === 0 && (
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
              {pending.isVideo ? <video src={pending.src} muted controls className="aspect-square w-full object-cover" />
                : <img src={pending.src} alt="" className="aspect-square w-full object-cover" />}
              <div className="absolute bottom-2 left-2 flex items-center gap-1.5 rounded-full bg-background/85 px-2.5 py-1">
                {!pending.settled && <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />}
                <p className="text-xs font-medium text-foreground">{pending.settled ? 'Publication not confirmed' : pending.assetId ? 'Finishing publication…' : 'Uploading…'}</p>
              </div>
            </div>
          ))}
          {posts.map((post, index) => (
            <div key={`${post.clubId}:${post.id}`} data-reading-row={`${post.clubId}:${post.id}`}>
              <MediaPostArticle post={post} principal={principal} userId={user?.id} profile={profile} index={index}
                onReact={(item, emoji) => reactionMutation.mutate({ post: item, emoji })}
                onRemove={(item, emoji) => reactionMutation.mutate({ post: item, emoji, remove: true })}
                onComments={item => { setCommentError(null); setCommentPost(item); }}
                onLongPress={startLongPress} onCancelPress={cancelLongPress} onPhoto={openPostLightbox} />
              {(index + 1) % 8 === 0 && (
                <div className="mt-6">
                  <MediaSponsorTile seed={index} clubId={post.clubId} />
                </div>
              )}
            </div>
          ))}
        </div>
        {feedQuery.data?.hasMore && (
          <div ref={olderSentinel} className="h-8" aria-hidden="true" />
        )}
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
                teams={filterTeams}
                miniLeagues={filterMiniLeagues}
                selectedClubId={effectiveClubId}
                showClubFilter={!activeClubFilter}
                selectedTeamId={selectedTeamId}
                onClubChange={(id) => {
                  setSelectedClubId(activeClubFilter ?? id);
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
          principal={principal}
          open={uploadOpen}
          onOpenChange={setUploadOpen}
          onUploaded={() => undefined}
          clubs={options.clubs}
          teams={options.teams}
          miniLeagues={options.miniLeagues}
          competitions={options.competitions}
          defaultClubId={selectedClubId !== "all" ? selectedClubId : undefined}
          defaultCompetitionId={competitionId ?? undefined}
          defaultEventId={link.eventId ?? undefined}
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
        comments={activeComments.filter(c => !isBlocked(c.user_id))}
        commentInput={commentInput}
        onCommentInputChange={setCommentInput}
        onSubmitComment={() => {
          const text = commentInput.trim();
          if (commentPost && text) commentMutation.mutate({ post: commentPost, text, replyToId: replyingTo?.id });
        }}
        isPending={commentMutation.isPending}
        errorMessage={commentError ?? (commentsQuery.isError ? "We couldn't refresh comments. Please reopen to try again." : null)}
        replyingTo={replyingTo}
        onSetReplyingTo={reply => setReplyingTo(reply ?? null)}
        currentUserId={principal}
      />

      <PhotoLightbox
        isOpen={lightboxIndex !== null}
        onClose={() => setLightboxIndex(null)}
        photos={flatPhotos}
        currentIndex={lightboxIndex ?? 0}
        onNavigate={(i) => setLightboxIndex(i)}
        canDelete={
          lightboxIndex !== null && !!flatPhotos[lightboxIndex] && canDeletePost(flatPhotos[lightboxIndex].post)
        }
        onDelete={(photoId) => {
          const entry = flatPhotos.find((p) => p.id === photoId);
          if (entry) {
            setActionPost(entry.post);
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
            {actionPost && canDeletePost(actionPost) ? (
              <Button
                variant="destructive"
                className="w-full"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  deleteMutation.mutate({ post: actionPost, mode: 'feed_only' });
                  setActionPost(null);
                }}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Remove from feed only
              </Button>
            ) : (
              <p className="text-sm text-muted-foreground">
                Only the person who shared this can delete it.
              </p>
            )}
            {actionPost && canDeletePost(actionPost) && <Button variant="destructive" className="w-full" disabled={deleteMutation.isPending}
              onClick={() => { deleteMutation.mutate({ post: actionPost, mode: 'feed_and_vault' }); setActionPost(null); }}>Delete from feed and Vault</Button>}
            {actionPost && actionPost.ownerId !== principal && <Button variant="outline" className="w-full"
              onClick={() => { setBlockTarget(actionPost); setActionPost(null); }}>Block {actionPost.ownerName}</Button>}
          </div>
        </SheetContent>
      </Sheet>
      {blockTarget && <BlockUserDialog open onOpenChange={open => !open && setBlockTarget(null)} userId={blockTarget.ownerId} userName={blockTarget.ownerName} />}
    </div>
  );
}

/** Each visible post owns its ancillary read; photos never wait for comments or profiles. */
function MediaPostArticle({ post: base, principal, userId, profile, index, onReact, onRemove, onComments, onLongPress, onCancelPress, onPhoto }: {
  post: LiveMediaPost; principal?: string; userId?: string;
  profile: { display_name?: string | null; avatar_url?: string | null } | null;
  index: number; onReact: (post: LiveMediaPost, emoji: string) => void; onRemove: (post: LiveMediaPost, emoji: string) => void;
  onComments: (post: LiveMediaPost) => void; onLongPress: (post: LiveMediaPost) => void; onCancelPress: () => void;
  onPhoto: (post: LiveMediaPost, index: number) => void;
}) {
  const articleRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(index < 2);
  useEffect(() => {
    if (visible) return;
    const element = articleRef.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') { setVisible(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect(); }
    }, { rootMargin: '400px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  const details = useQuery({
    queryKey: ['icp-media-post-details', principal, base.clubId, base.representativeAssetId],
    enabled: !!principal && visible,
    refetchInterval: visible ? 30_000 : false,
    refetchIntervalInBackground: false,
    queryFn: () => withFeatureBackend('media', {
      supabase: async () => { throw new Error('unreachable'); },
      icp: async ctx => {
        const [rawReactions, rawComments] = await Promise.all([
          listLiveReactions(ctx, base.representativeAssetId), listLiveComments(ctx, base.representativeAssetId),
        ]);
        const reactions: LiveReactionView[] = rawReactions.map(r => ({ user_id: r.user.toText(), reaction_type: r.kind }));
        const comments = rawComments.filter(c => !c.deleted).map(galleryCommentFromReceipt);
        const ids = [...new Set([base.ownerId, ...reactions.map(r => r.user_id), ...comments.map(c => c.user_id)])];
        const profiles = await listLiveProfilesByIds(ctx, ids, { clubId: base.clubId });
        const directory = mediaProfileDirectory(profiles as unknown as Parameters<typeof mediaProfileDirectory>[0]);
        return { reactions: reactions.map(r => ({ ...r, profiles: directory.get(r.user_id) })),
          comments: comments.map(c => ({ ...c, profiles: directory.get(c.user_id) })),
          ownerName: directory.get(base.ownerId)?.display_name ?? 'Member',
          ownerAvatarUrl: directory.get(base.ownerId)?.avatar_url ?? null };
      },
    }, { clubId: base.clubId }),
    retry: 1,
  });
  const viewRecorded = useRef<string | null>(null);
  useEffect(() => {
    if (!principal || !visible || viewRecorded.current === `${principal}:${base.representativeAssetId}`) return;
    viewRecorded.current = `${principal}:${base.representativeAssetId}`;
    void withFeatureBackend('media', { supabase: async () => undefined, icp: async ctx => {
      const { recordLiveGalleryView } = await import('@/live/features/media');
      return recordLiveGalleryView(ctx, base.representativeAssetId);
    } }, writeOnce({ clubId: base.clubId })).catch(() => undefined);
  }, [visible, principal, base.clubId, base.representativeAssetId]);
  const views = useQuery({ queryKey: ['icp-gallery-views', principal, base.clubId, base.representativeAssetId], enabled: !!principal && visible,
    queryFn: () => withFeatureBackend('media', { supabase: async () => [], icp: async ctx => {
      const { readLiveGalleryViewCounts } = await import('@/live/features/media');
      return readLiveGalleryViewCounts(ctx, [base.representativeAssetId]);
    } }, { clubId: base.clubId }), refetchInterval: 30_000, refetchIntervalInBackground: false });
  const post = details.data ? { ...base, ...details.data, comments: mergeGalleryComments(details.data.comments, base.comments) } : base;
  return <div ref={articleRef}>
              <article className="overflow-hidden rounded-xl border border-border bg-card">
                <div className="flex items-center gap-3 px-3 py-2.5">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={post.ownerAvatarUrl || undefined} alt={post.ownerName} className="object-cover" />
                    <AvatarFallback>{((post.ownerId === userId || post.ownerId === principal) ? profile?.display_name || post.ownerName : post.ownerName).slice(0, 2).toUpperCase()}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{(post.ownerId === userId || post.ownerId === principal) ? profile?.display_name || post.ownerName : post.ownerName}</p>
                    <p className="truncate text-xs text-muted-foreground">{post.teamName ? `${post.clubName} · ${post.teamName}` : post.miniLeagueName ? `${post.clubName} · ${post.miniLeagueName}` : post.competitionName ? `${post.clubName} · ${post.competitionName}` : post.clubName}</p>
                  </div>
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {post.createdAtMs > 0 ? formatTimeShort(new Date(post.createdAtMs)) : ""}
                  </span>
                </div>

                <div
                  onTouchStart={() => onLongPress(post)}
                  onTouchMove={onCancelPress}
                  onTouchEnd={onCancelPress}
                  onTouchCancel={onCancelPress}
                >
                  <AlbumCarousel
                    photos={post.assets.map((asset) => ({
                      id: asset.id,
                      // Still-unlocked photos pass no URL so the carousel's
                      // LazyImage renders its pulsing skeleton until the
                      // decrypted bytes arrive.
                      file_url: asset.loading ? null : asset.url,
                      loading: asset.loading,
                    }))}
                    onTap={(i) => onPhoto(post, i)}
                    priority={index < 2}
                  />
                </div>

                <div className="flex items-center gap-2 px-3 py-2">
                  <EmojiReactions
                    reactions={post.reactions}
                    currentUserId={principal}
                    onReact={(type) => onReact(post, type)}
                    onRemove={() => {
                      const mine = post.reactions.find((r) => r.user_id === principal);
                      if (mine) onRemove(post, mine.reaction_type);
                    }}
                  />
                  <Button
                    variant="ghost" size="sm"
                    className="flex items-center gap-1 text-muted-foreground"
                    onClick={() => { onComments(post); }}
                    aria-label="Comments"
                  >
                    <MessageCircle className="h-5 w-5" />
                    {post.comments.length > 0 && (
                      <span className="text-xs">{post.comments.length}</span>
                    )}
                  </Button>
                </div>

                {post.caption && (
                  <p className="px-3 pb-3 text-sm">{post.caption}</p>
                )}
              </article>
    {views.data?.[0] && <div className="flex items-center gap-1 text-xs text-muted-foreground py-1"><Eye className="h-3 w-3" />{Number(views.data[0][1])}</div>}
    {details.isError && <Button variant="ghost" size="sm" onClick={() => details.refetch()}>Retry comments and reactions</Button>}
  </div>;
}
