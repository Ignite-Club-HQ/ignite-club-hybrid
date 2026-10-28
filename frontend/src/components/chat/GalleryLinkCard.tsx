import { getCachedTeam } from "@/lib/clubTeamCache";
import { useAuth } from "@/hooks/useAuth";
import { skipToken, useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation, useNavigate } from "react-router-dom";
import { ImageIcon, ChevronRight } from "lucide-react";
import { memo, useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveGalleryChatCard } from "@/live/features/media";
import { getLiveTeam } from "@/live/features/club";
import { resolveSignedUrl } from "@/hooks/useSignedPhotoUrl";
import { withReadDeadline } from "@/live/readDeadline";
import { Skeleton } from "@/components/ui/skeleton";
import { chatVaultLocation, readChatVaultCard } from "@/features/messaging/thread/chatVaultCardRead";
import { isIcpBlobUrl } from "@/hooks/useResolvedIcpBlobSrc";
import { Button } from "@/components/ui/button";
import { chatScopeFromPath } from "@/live/chatScope";

interface GalleryLinkCardProps {
  cardId: string;
  isPromptHint?: boolean;
}

export const GalleryLinkCard = memo(function GalleryLinkCard({ cardId, isPromptHint = false }: GalleryLinkCardProps) {
  const navigate = useNavigate();
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const isIcp = isFeatureRoutedToIcp('media');
  const { user, sessionRestoration } = useAuth();
  const queryClient = useQueryClient();
  const { pathname } = useLocation();
  const chatScope = chatScopeFromPath(pathname);
  const teamId = chatScope && "teamId" in chatScope ? chatScope.teamId : undefined;
  // Subscribe without fetching: React.memo otherwise hides the header's
  // newly resolved owning club from a card already showing its skeleton.
  useQuery({ queryKey: ["team", teamId], queryFn: skipToken, notifyOnChangeProps: ["data"] });
  const location = isIcp ? chatVaultLocation(queryClient, user?.id, pathname) : undefined;
  const locationKey = location && "clubId" in location ? `club:${location.clubId}`
    : location && "teamId" in location ? `team:${location.teamId}` : "resource";

  const { data: card, isLoading, isError, refetch } = useQuery({
    // Resolving the open team's club must replace an earlier cold team/resource
    // discovery, not leave this card attached to its stalled promise.
    queryKey: ["gallery-chat-card", cardId, user?.id, isIcp, locationKey],
    queryFn: async ({ signal }) => {
      if (isIcp) {
        return withReadDeadline(readChatVaultCard(location, { galleryCardId: cardId }, scope => withFeatureBackend("media", {
          icp: async (ctx) => {
            const row = await getLiveGalleryChatCard(ctx, cardId);
            if (!row) return null;
            // Team name resolves from club_domain; the canister Event record
            // has no opponent field, so opponentLabel/eventStart stay null and
            // the headline falls back to the team-name wording.
            const team = getCachedTeam(row.team_id);
            const teamRow = Array.isArray(team) ? team[0] : team;
            return {
              id: row.id,
              team_id: row.team_id,
              club_id: row.club_id,
              hero_image_url: row.hero_image_url[0] ?? null,
              photo_count: row.photo_count,
              event_id: row.event_id[0] ?? null,
              is_prompt: row.is_prompt,
              created_at: new Date(Number(row.created_at_ms)).toISOString(),
              teams: teamRow ? { name: (teamRow as { name?: string }).name ?? "Team" } : null,
              opponentLabel: null,
              eventStart: null,
            };
          },
          supabase: async () => null,
        }, scope)), "Photo update read", 45_000, signal).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          console.warn("[GalleryLinkCard] photo update read failed", { cardId, message });
          // Discovery reports a card no group holds for this account as
          // "not found or not authorized": that is a removed/unshared card,
          // not a retryable failure.
          if (/not found or not authorized/i.test(message)) return null;
          throw error;
        });
      }
      const { data } = await supabase
        .from("gallery_chat_cards")
        .select("id, team_id, hero_image_url, photo_count, event_id, is_prompt, created_at, teams(name)")
        .eq("id", cardId)
        .maybeSingle();

      let opponentLabel: string | null = null;
      let eventStart: string | null = null;
      if (data?.event_id) {
        const { data: ev } = await supabase
          .from("events")
          .select("opponent, type, start_time")
          .eq("id", data.event_id)
          .maybeSingle();
        if (ev?.opponent) opponentLabel = ev.opponent as string;
        if (ev?.start_time) eventStart = ev.start_time as string;
      }

      return data ? { ...data, opponentLabel, eventStart } : null;
    },
    enabled: !!cardId && !!user && sessionRestoration === 'authenticated',
    staleTime: 30 * 1000,
    // One quiet retry covers cold group discovery right after resume.
    retry: isIcp ? 1 : undefined,
    retryDelay: 2_000,
  });

  const { data: teamLabel } = useQuery({
    queryKey: ["gallery-card-team-label", card?.team_id, user?.id, isIcp],
    enabled: isIcp && !!card && !card.teams && sessionRestoration === "authenticated",
    queryFn: async () => {
      if (!card) return null;
      return withFeatureBackend("membership", { supabase: async () => null,
        icp: async ctx => (await getLiveTeam(ctx, card.team_id))[0]?.name ?? null },
        { clubId: (card as { club_id: string }).club_id });
    },
    retry: false,
    staleTime: 5 * 60_000,
  });

  const originalHero = card?.hero_image_url ?? null;
  const imageQuery = useQuery({
    queryKey: ["gallery-card-image", user?.id, isIcp, originalHero],
    enabled: !!originalHero && !!user && sessionRestoration === "authenticated",
    queryFn: ({ signal }) => originalHero
      ? withReadDeadline(resolveSignedUrl(originalHero), "Photo unlock", 20_000, signal)
      : Promise.resolve(null),
    staleTime: 5 * 60_000,
    gcTime: 5 * 60_000,
    retry: false,
  });
  const heroSrc = imageQuery.data || (originalHero && !isIcpBlobUrl(originalHero) ? originalHero : null);
  const imgLoaded = !!heroSrc && loadedSrc === heroSrc;
  const imgError = !!heroSrc && failedSrc === heroSrc;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (!card) return;
      if (card.is_prompt) {
        // Prompt cards open the upload flow, scoped to this team (and event if any).
        navigate(`/media?team=${card.team_id}&upload=1${card.event_id ? `&event=${card.event_id}` : ""}`);
        return;
      }
      navigate(`/media?team=${card.team_id}&card=${card.id}`);
    },
    [card, navigate],
  );

  if (isLoading) {
    // Match the final gallery-card slot exactly. The card itself keeps a
    // stable outer height after query/image hydration, so Virtuoso never has
    // to correct paddingTop for gallery rows during fast upward scrolling.
    return <Skeleton className={`${isPromptHint ? "h-[76px]" : "h-[240px]"} w-full max-w-[320px] rounded-2xl`} />;
  }

  if (!card) {
    return (
      <div className={`flex ${isPromptHint ? "h-[76px]" : "h-[240px]"} max-w-[320px] items-center rounded-xl border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground`}>
        {isError ? <div>Couldn’t open this photo update.<Button variant="ghost" size="sm" onClick={() => void refetch()}>Try again</Button></div> : "This photo update is no longer available."}
      </div>
    );
  }

  const teamName = teamLabel || (card as { teams?: { name?: string } | null }).teams?.name || "Team";
  const isPrompt = card.is_prompt;
  const count = card.photo_count;
  const promptHeadline = (() => {
    const ref = (card as { eventStart?: string | null }).eventStart || card.created_at;
    if (!ref) return "Got photos from the game?";
    const refDate = new Date(ref);
    const now = new Date();
    const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
    const dayDiff = Math.round((startOfDay(now) - startOfDay(refDate)) / 86400000);
    if (dayDiff <= 0) return "Got photos from today?";
    if (dayDiff === 1) return "Got photos from yesterday?";
    if (dayDiff < 7) {
      const weekday = refDate.toLocaleDateString(undefined, { weekday: "long" });
      return `Got photos from ${weekday}?`;
    }
    return "Got photos from the game?";
  })();
  const headline = isPrompt
    ? promptHeadline
    : card.opponentLabel
      ? `📸 ${count} photo${count === 1 ? "" : "s"} from vs ${card.opponentLabel}`
      : `📸 ${count} new ${teamName} photo${count === 1 ? "" : "s"}`;
  const subline = isPrompt
    ? `Add them to the ${teamName} gallery`
    : `${teamName} · Just now`;

  const ctaLabel = isPrompt ? "Open uploader" : "View Gallery";

  return (
    <div
      className={`group block w-full max-w-[320px] overflow-hidden rounded-2xl border border-border/60 bg-card text-left shadow-[0_1px_2px_hsl(var(--foreground)/0.04)] transition-colors hover:border-primary/30 hover:shadow-[0_2px_8px_hsl(var(--foreground)/0.06)] active:bg-primary/[0.04] touch-manipulation dark:border-border/40 dark:bg-card/80 dark:hover:border-primary/40 ${isPrompt ? "h-[76px]" : "h-[240px]"}`}
    >
      {/* Fixed hero slot for all non-prompt cards so image URL/signing/error
          state never changes the row height after Virtuoso has measured it. */}
      {!isPrompt && (
        <div className="relative w-full aspect-video bg-muted overflow-hidden">
          {heroSrc && !imgError ? (
            <>
              {!imgLoaded && <Skeleton className="absolute inset-0" />}
              <img
                src={heroSrc}
                alt=""
                loading="eager"
                decoding="async"
                onLoad={() => setLoadedSrc(heroSrc)}
                onError={() => setFailedSrc(heroSrc)}
                className={`h-full w-full object-cover ${imgLoaded ? "opacity-100" : "opacity-0"}`}
              />
            </>
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-primary/10">
              {imageQuery.isError || imgError ? (
                <div className="text-center text-xs text-muted-foreground">
                  <p>Couldn’t load this photo.</p>
                  <Button variant="ghost" size="sm" onClick={() => {
                    setFailedSrc(null);
                    setLoadedSrc(null);
                    void imageQuery.refetch();
                  }}>Try photo again</Button>
                </div>
              ) : <ImageIcon className="h-7 w-7 text-primary/70" />}
            </div>
          )}
          {count > 1 && heroSrc && !imgError && (
            <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1 rounded-full bg-black/70 px-2 py-0.5 text-[10px] font-medium text-white">
              <ImageIcon className="h-2.5 w-2.5" />
              {count}
            </div>
          )}
        </div>
      )}

      <Button variant="ghost" onClick={handleClick} className="h-auto w-full justify-start rounded-none p-0 text-left whitespace-normal">
      {isPrompt ? (
        <div className="flex items-center gap-3 px-3.5 py-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15">
            <ImageIcon className="h-4 w-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px] font-semibold leading-snug text-foreground line-clamp-2">
              {headline}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] leading-tight text-muted-foreground/90">
              {subline}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 self-center text-[11px] font-medium text-muted-foreground/80">
            <span className="hidden xs:inline">Upload</span>
            <ChevronRight className="h-4 w-4 text-muted-foreground/70" />
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-3 px-3.5 py-3">
          {(!heroSrc || imgError) && (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 ring-1 ring-primary/15">
              <ImageIcon className="h-4 w-4 text-primary" />
            </div>
          )}
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold leading-snug text-foreground">
              {headline}
            </p>
            <p className="mt-0.5 truncate text-[11.5px] leading-tight text-muted-foreground/90">
              {subline}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-0.5 self-center text-[11px] font-medium text-primary">
            {ctaLabel}
            <ChevronRight className="h-3.5 w-3.5" />
          </div>
        </div>
      )}
      </Button>
    </div>
  );
});
