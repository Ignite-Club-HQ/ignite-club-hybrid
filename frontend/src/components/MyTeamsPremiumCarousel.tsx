import { useState, useCallback, useMemo, useEffect } from "react";
import { LogoImage } from "@/components/ui/logo-image";
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";
import { useAuth } from "@/hooks/useAuth";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { useClubTheme } from "@/hooks/useClubTheme";
import { Users, Trophy, Plus, ChevronRight, MessageCircle, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea, ScrollBar } from "@/components/ui/scroll-area";
import { cacheTeams, getCachedClub } from "@/lib/clubTeamCache";
import { getSignedPhotoUrls } from "@/hooks/useSignedPhotoUrl";
import { setCachedCarousel, getCachedCarouselWithTs } from "@/lib/myTeamsCarouselCache";
import { format, isToday, isTomorrow, parseISO, differenceInDays } from "date-fns";

// Render Supabase storage URLs through the image-transform endpoint at a tiny
// width so the 28×28 avatar thumbnails don't download full-resolution originals.
function toThumb(src: string, width = 96, quality = 60): string {
  if (!src) return src;
  const objectMatch = src.match(/\/storage\/v1\/object\/(public|sign|authenticated)\//);
  const renderMatch = src.match(/\/storage\/v1\/render\/image\/(public|sign)\//);
  if (!objectMatch && !renderMatch) return src;
  let transformed = src;
  if (objectMatch) {
    transformed = src.replace(
      `/storage/v1/object/${objectMatch[1]}/`,
      `/storage/v1/render/image/${objectMatch[1] === "authenticated" ? "sign" : objectMatch[1]}/`,
    );
  }
  const [base, query = ""] = transformed.split("?");
  const params = new URLSearchParams(query);
  params.delete("width"); params.delete("height"); params.delete("quality"); params.delete("resize");
  params.set("width", String(width));
  params.set("quality", String(quality));
  params.set("resize", "cover");
  return `${base}?${params.toString()}`;
}

interface TeamOrLeague {
  id: string;
  name: string;
  logo_url: string | null;
  club_logo_url: string | null;
  type: "team" | "league" | "competition";
  club_name: string;
  sport: string | null;
  club_id: string;
  canManage: boolean;
  isOnTrial?: boolean;
  /** For competition cards: comma-separated list of the user's teams entered */
  competitionTeamsLabel?: string;
}

interface NextEventInfo {
  title: string;
  dateLabel: string;
  type: string;
  eventDate: string;
}

interface DateParts {
  timeLabel: string;
  dayLabel: string;
  pill: string | null;
}

function formatShortDate(dateStr: string): string {
  const p = formatDateParts(dateStr);
  return `${p.dayLabel} ${p.timeLabel}${p.pill ? ` (${p.pill})` : ""}`;
}

function formatDateParts(dateStr: string): DateParts {
  const date = parseISO(dateStr);
  const now = new Date();
  const time = format(date, "h:mma").toLowerCase();
  const days = differenceInDays(date, now);
  if (isToday(date)) return { timeLabel: time, dayLabel: "Today", pill: "Today" };
  if (isTomorrow(date)) return { timeLabel: time, dayLabel: "Tomorrow", pill: "in 1d" };
  if (days >= 0 && days <= 6) return { timeLabel: time, dayLabel: format(date, "EEEE"), pill: `in ${days}d` };
  return { timeLabel: time, dayLabel: format(date, "EEE d MMM"), pill: null };
}


interface MemberSummary {
  count: number;
  avatars: string[];
}

function MyTeamsCarouselSkeleton() {
  return (
    <section className="space-y-2.5" aria-hidden="true">
      <h2 className="text-xl font-bold px-1 tracking-tight">My Teams</h2>
      <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 pb-2 snap-x snap-mandatory pr-4">
          {[1, 2].map((i) => (
            <div
              key={i}
              className="shrink-0 w-[85vw] max-w-[320px] h-[212px] rounded-lg border border-border/60 bg-card p-4 space-y-3 animate-pulse"
            >
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-full bg-muted shrink-0" />
                <div className="min-w-0 flex-1 space-y-2 pt-1">
                  <div className="h-4 w-2/3 rounded bg-muted" />
                  <div className="h-3 w-1/2 rounded bg-muted/80" />
                </div>
              </div>
              <div className="rounded-md bg-muted/40 px-3 py-2.5 min-h-[62px] space-y-2">
                <div className="h-3 w-4/5 rounded bg-muted" />
                <div className="h-3 w-3/5 rounded bg-muted/80" />
              </div>
              <div className="flex items-center gap-2 pt-3 border-t border-border/40 min-h-[36px]">
                <div className="h-7 w-7 rounded-full bg-muted" />
                <div className="h-3 w-24 rounded bg-muted/80" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function TeamCard({ item, nextEvent, photos, photoCount, unreadMessages, members, competitionName }: {
  item: TeamOrLeague;
  nextEvent?: NextEventInfo;
  photos: { id: string; url: string }[];
  photoCount?: number;
  unreadMessages?: number;
  members?: MemberSummary;
  competitionName?: string;
}) {
  const totalPhotos = photoCount ?? photos.length;
  const navigate = useNavigate();

  const navTarget =
    item.type === "team" ? `/teams/${item.id}` :
    item.type === "league" ? `/mini-leagues/${item.id}` :
    `/competitions/${item.id}`;
  const handleCardClick = useCallback(() => {
    navigate(navTarget);
  }, [navigate, navTarget]);


  const hasActivity = !!nextEvent || photos.length > 0 || (unreadMessages && unreadMessages > 0);

  const eventTypeStyles: Record<string, { dot: string; label: string }> = {
    game: { dot: "bg-destructive", label: "Game" },
    mini_league: { dot: "bg-destructive", label: "Match" },
    training: { dot: "bg-primary", label: "Training" },
    social: { dot: "bg-warning", label: "Social" },
  };
  const evStyle = nextEvent ? (eventTypeStyles[nextEvent.type] || { dot: "bg-primary", label: "Event" }) : null;
  const dateParts = nextEvent ? formatDateParts(nextEvent.eventDate) : null;

  // Competition cards are simpler: header + competition badge + teams list. No
  // events, photos or member rows — those don't apply to a competition entity.
  if (item.type === "competition") {
    return (
      <Card
        className="shrink-0 w-[85vw] max-w-[320px] h-[212px] cursor-pointer border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-border transition-all snap-start overflow-hidden relative"
        role="button"
        tabIndex={0}
        aria-label={`${item.name} — Competition`}
        onClick={handleCardClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); navigate(navTarget); }
        }}
      >
        <CardContent className="p-4 h-full flex flex-col gap-3">
          <div className="flex items-start gap-3">
            {item.logo_url ? (
              <LogoImage
                src={item.logo_url}
                className="h-10 w-10 rounded-full object-cover shrink-0"
                fallback={
                  <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-primary/10">
                    <Trophy className="h-5 w-5 text-primary" />
                  </div>
                }
              />
            ) : (
              <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-primary/10">
                <Trophy className="h-5 w-5 text-primary" />
              </div>
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <Badge variant="outline" className="text-[9px] px-1 py-0 h-[16px] shrink-0 border-primary/40 text-primary">
                  Competition
                </Badge>
              </div>
              <h3 className="font-semibold text-base leading-tight truncate text-foreground mt-1">{item.name}</h3>
              {item.club_name && (
                <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.club_name}</p>
              )}
            </div>
          </div>

          <div className="rounded-md bg-muted/40 px-3 py-2.5 flex flex-col gap-1 min-h-[62px]">
            <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground">Your entries</span>
            <span className="text-sm font-medium text-foreground line-clamp-2">
              {item.competitionTeamsLabel || "—"}
            </span>
          </div>

          <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40 min-h-[36px]">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="h-7 w-7 rounded-md bg-primary/10 ring-2 ring-card shrink-0 flex items-center justify-center">
                <Trophy className="h-3.5 w-3.5 text-primary" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate">View fixtures & ladder</span>
            </div>
            <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card
      className="shrink-0 w-[85vw] max-w-[320px] h-[212px] cursor-pointer border border-border/60 bg-card shadow-sm hover:shadow-md hover:border-border transition-all snap-start overflow-hidden relative"
      role="button"
      tabIndex={0}
      aria-label={`${item.name} — ${item.club_name}`}
      onClick={handleCardClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          navigate(navTarget);
        }
      }}
    >
      <CardContent className="p-4 h-full flex flex-col gap-3">
        {/* Header: logo + name/club + actions */}
        <div className="flex items-start gap-3">
          {(item.logo_url || item.club_logo_url) ? (
            <LogoImage
              src={(item.logo_url || item.club_logo_url)!}
              className="h-10 w-10 rounded-full object-cover shrink-0"
              fallback={
                <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-muted">
                  {item.type === "team" ? <Users className="h-5 w-5 text-muted-foreground" /> : <Trophy className="h-5 w-5 text-muted-foreground" />}
                </div>
              }
            />
          ) : (
            <div className="h-10 w-10 rounded-full flex items-center justify-center shrink-0 bg-muted">
              {item.type === "team" ? <Users className="h-5 w-5 text-muted-foreground" /> : <Trophy className="h-5 w-5 text-muted-foreground" />}
            </div>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <h3 className="font-semibold text-base leading-tight truncate text-foreground">{item.name}</h3>
              {item.isOnTrial && (
                <Badge variant="outline" className="text-amber-600 border-amber-500 text-[9px] px-1 py-0 h-[16px] shrink-0">Trial</Badge>
              )}
            </div>
            <p className="text-[11px] text-muted-foreground truncate mt-0.5">{item.club_name}</p>
            {competitionName && (
              <p className="text-[10px] text-muted-foreground/80 truncate flex items-center gap-1 mt-0.5">
                <Trophy className="h-2.5 w-2.5 shrink-0" />
                <span className="truncate">{competitionName}</span>
              </p>
            )}
          </div>
        </div>

        {/* Event block — fixed min-height so the placeholder and resolved
            event variants don't change card size when nextEvents resolves. */}
        {nextEvent && evStyle && dateParts ? (
          <div className="rounded-md bg-muted/40 px-3 py-2.5 flex flex-col gap-1 min-h-[62px]">
            <div className="flex items-center gap-2 min-w-0">
              <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${evStyle.dot}`} aria-hidden="true" />
              <span className="text-[10px] uppercase tracking-wide font-semibold text-muted-foreground shrink-0">{evStyle.label}</span>
              <span className="text-sm font-medium text-foreground truncate">{nextEvent.title.replace(/^(Game|Training|Social|Match)\s*v?\s*/i, "")}</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="truncate">{dateParts.dayLabel} · {dateParts.timeLabel}</span>
              {dateParts.pill && (
                <span className="ml-auto shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-primary/10 text-primary">
                  {dateParts.pill}
                </span>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-md bg-muted/30 px-3 py-2.5 flex items-center justify-between gap-2 min-h-[62px]">
            <span className="text-xs text-muted-foreground italic">No upcoming events</span>
            {item.canManage ? (
              <button
                className="flex items-center gap-1 text-xs text-primary font-medium hover:underline shrink-0"
                onClick={(e) => { e.stopPropagation(); navigate(item.type === "league" ? `/events/new?type=mini_league&mini_league_id=${item.id}&club_id=${item.club_id}` : "/events/new"); }}
              >
                <Plus className="h-3 w-3" />
                Schedule
              </button>
            ) : (
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            )}
          </div>
        )}

        {/* Footer: priority cascade — unread > photos > members fallback. */}
        <div className="flex items-center justify-between gap-3 pt-1 border-t border-border/40 min-h-[36px]">
          {unreadMessages && unreadMessages > 0 ? (
            <button
              type="button"
              className="flex items-center gap-2 min-w-0 flex-1"
              onClick={(e) => {
                e.stopPropagation();
                navigate(item.type === "league" ? `/mini-leagues/${item.id}` : `/teams/${item.id}`);
              }}
            >
              <span className="relative flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 shrink-0">
                <MessageCircle className="h-3.5 w-3.5 text-primary" />
                <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-card" />
              </span>
              <span className="text-[11px] font-medium text-foreground truncate">
                {unreadMessages} new message{unreadMessages > 1 ? "s" : ""}
              </span>
            </button>
          ) : photos.length > 0 && totalPhotos > 0 ? (
            <button
              type="button"
              className="group flex items-center gap-2 min-w-0 flex-1 rounded-sm -mx-1 px-1 py-1 transition-colors active:bg-muted/50"
              onClick={(e) => {
                e.stopPropagation();
                navigate(item.type === "league" ? `/media?miniLeague=${item.id}` : `/media?team=${item.id}`);
              }}
            >
              <div className="flex -space-x-1.5 shrink-0">
                {photos.slice(0, 3).map((photo, i) => (
                  <div
                    key={i}
                    className="h-7 w-7 rounded-md overflow-hidden bg-muted ring-2 ring-card shrink-0"
                  >
                    <img
                      src={toThumb(photo.url)}
                      alt=""
                      className="h-full w-full object-cover"
                      loading="lazy"
                      decoding="async"
                    />
                  </div>
                ))}
              </div>
              <span className="text-[11px] text-muted-foreground truncate flex-1 text-left">
                {totalPhotos} new photo{totalPhotos !== 1 ? "s" : ""}
              </span>
              <ChevronRight
                className="ml-auto h-4 w-4 shrink-0 text-muted-foreground opacity-70 transition-all duration-200 group-hover:translate-x-0.5 group-hover:opacity-100"
                strokeWidth={2.25}
                aria-hidden="true"
              />
            </button>

          ) : members && members.count > 0 ? (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="flex -space-x-1.5 shrink-0">
                {members.avatars.slice(0, 3).map((url, i) => (
                  <div key={i} className="h-7 w-7 rounded-full overflow-hidden bg-muted ring-2 ring-card shrink-0">
                    <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
                  </div>
                ))}
                {members.avatars.length === 0 && (
                  <div className="h-7 w-7 rounded-full bg-muted ring-2 ring-card shrink-0 flex items-center justify-center">
                    <Users className="h-3 w-3 text-muted-foreground" />
                  </div>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground truncate">
                {members.count} member{members.count > 1 ? "s" : ""}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <div className="h-7 w-7 rounded-full bg-muted ring-2 ring-card shrink-0 flex items-center justify-center">
                <Users className="h-3 w-3 text-muted-foreground" />
              </div>
              <span className="text-[11px] text-muted-foreground truncate">
                {item.type === "league" ? "Mini-league" : "Your team"}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

interface CarouselSnapshot {
  items: TeamOrLeague[];
  nextEvents: Record<string, NextEventInfo>;
  teamPhotos: Record<string, { id: string; url: string }[]>;
  unreadCounts: Record<string, number>;
  teamMembers?: Record<string, MemberSummary>;
}

interface MyTeamsPremiumCarouselProps {
  onReadyChange?: (ready: boolean) => void;
}

type RequestIdleCallback = (callback: () => void, options?: { timeout: number }) => number;
type CancelIdleCallback = (handle: number) => void;

interface UserRoleRow {
  team_id: string | null;
  club_id: string | null;
  role: string;
}

interface TeamQueryRow {
  id: string;
  name: string;
  logo_url: string | null;
  club_id: string;
  is_pro: boolean | null;
  pro_expires_at: string | null;
}

interface MiniLeaguePlayerRow {
  mini_league_id: string | null;
}

interface AdminLeagueRow {
  id: string;
  club_id: string;
}

interface ManagedPlayhqCompetitionRow {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
  organizer_club_id: string;
  clubs: { name: string | null; logo_url: string | null; sport: string | null } | { name: string | null; logo_url: string | null; sport: string | null }[] | null;
}

export function MyTeamsPremiumCarousel({ onReadyChange }: MyTeamsPremiumCarouselProps = {}) {
  const { user, initialized } = useAuth();
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();

  // Hydrate from localStorage so cold opens paint real cards instantly
  const snapshotWithTs = useMemo(
    () => getCachedCarouselWithTs<CarouselSnapshot>(user?.id, activeClubFilter),
    [user?.id, activeClubFilter]
  );
  const snapshot = snapshotWithTs?.data ?? null;


  // Defer non-critical queries (photos) until after first paint to free up the main thread
  const [deferredReady, setDeferredReady] = useState(false);
  useEffect(() => {
    const w = window as Window & {
      requestIdleCallback?: RequestIdleCallback;
      cancelIdleCallback?: CancelIdleCallback;
    };
    const ric = w.requestIdleCallback;
    if (ric) {
      const handle = ric(() => setDeferredReady(true), { timeout: 1500 });
      return () => {
        const cic = w.cancelIdleCallback;
        if (cic) cic(handle);
      };
    }
    const t = setTimeout(() => setDeferredReady(true), 800);
    return () => clearTimeout(t);
  }, []);

  // Fetch teams & leagues
  const { data: items = snapshot?.items ?? [], isLoading, isFetching } = useQuery({
    queryKey: ["my-teams-premium-v2", user?.id, activeClubFilter],
    retry: 3,
    initialData: snapshot?.items,
    initialDataUpdatedAt: snapshotWithTs?.timestamp,
    queryFn: async () => {
      if (!user) return [];


      const { data: roles, error: rolesError } = await supabase
        .from("user_roles")
        .select("team_id, club_id, role")
        .eq("user_id", user.id);

      if (rolesError) throw rolesError;
      if (!roles) return [];

      const teamIds = [...new Set(roles.filter(r => r.team_id).map(r => r.team_id))] as string[];
      const leagueAdminClubIds = roles
        .filter(r => r.club_id && r.role === "league_admin")
        .map(r => r.club_id) as string[];
      const managedCompetitionClubIds = [...new Set(
        roles
          .filter(r => r.club_id && ["club_admin", "league_admin", "app_admin"].includes(r.role))
          .map(r => r.club_id),
      )] as string[];
      // Parallel: teams, player-league memberships, and league-admin clubs all depend only on `roles`
      const [teamsRes, playerLeaguesRes, adminLeaguesRes, managedPlayhqCompsRes] = await Promise.all([
        teamIds.length > 0
          ? supabase
              .from("teams")
              .select("id, name, logo_url, club_id, is_pro, pro_expires_at")
              .in("id", teamIds)
              .is("deleted_at", null)
          : Promise.resolve({ data: [] as TeamQueryRow[] }),
        supabase
          .from("mini_league_players")
          .select("mini_league_id")
          .eq("parent_user_id", user.id),
        leagueAdminClubIds.length > 0
          ? supabase
              .from("mini_leagues")
              .select("id, club_id")
              .in("club_id", leagueAdminClubIds)
          : Promise.resolve({ data: [] as AdminLeagueRow[] }),
        managedCompetitionClubIds.length > 0
          ? supabase
              .from("competitions")
              .select("id, name, logo_url, sport, organizer_club_id, clubs:organizer_club_id(name, logo_url, sport)")
              .eq("source", "playhq")
              .eq("status", "active")
              .in("organizer_club_id", managedCompetitionClubIds)
          : Promise.resolve({ data: [] as ManagedPlayhqCompetitionRow[] }),
      ]);

      const result: TeamOrLeague[] = [];
      const teams = teamsRes.data;
      if (teams && teams.length > 0) {
        cacheTeams(teams.map(t => ({
          id: t.id, name: t.name, logo_url: t.logo_url, club_id: t.club_id, level_age: null,
        })));

        // Resolve any missing club metadata (cache hit avoids the join)
        const neededClubIds = [...new Set(teams.map(t => t.club_id).filter(Boolean) as string[])];
        const missingClubIds = neededClubIds.filter(id => !getCachedClub(id));
        if (missingClubIds.length > 0) {
          const { data: clubsData } = await supabase
            .from("clubs")
            .select("id, name, logo_url, sport, is_pro")
            .in("id", missingClubIds);
          if (clubsData) {
            const { cacheClubs } = await import("@/lib/clubTeamCache");
            cacheClubs(clubsData);
          }
        }

        for (const team of teams) {
          if (activeClubFilter && team.club_id !== activeClubFilter) continue;
          const teamRoles = roles.filter(r => r.team_id === team.id);
          const clubRoles = roles.filter(r => r.club_id === team.club_id);
          const canManage = teamRoles.some(r => ['coach', 'team_admin'].includes(r.role)) ||
            clubRoles.some(r => ['club_admin', 'app_admin'].includes(r.role));
          const cachedClub = getCachedClub(team.club_id);
          result.push({
            id: team.id, name: team.name, logo_url: team.logo_url,
            club_logo_url: cachedClub?.logo_url || null,
            type: "team",
            club_name: cachedClub?.name || "", sport: cachedClub?.sport || null,
            club_id: team.club_id, canManage,
            isOnTrial: !!(team.is_pro && team.pro_expires_at),
          });
        }
      }

      // Mini leagues — combine player + league-admin memberships, then fetch full rows
      const leagueIds = new Set((playerLeaguesRes.data as MiniLeaguePlayerRow[] | null)?.map((p) => p.mini_league_id).filter(Boolean) || []);
      (adminLeaguesRes.data as AdminLeagueRow[] | null)?.forEach((l) => leagueIds.add(l.id));

      if (leagueIds.size > 0) {
        const { data: leagues } = await supabase
          .from("mini_leagues")
          .select("id, name, club_id, clubs!club_id(name, sport, logo_url)")
          .in("id", Array.from(leagueIds));

        if (leagues) {
          for (const league of leagues) {
            if (activeClubFilter && league.club_id !== activeClubFilter) continue;
            const canManage = leagueAdminClubIds.includes(league.club_id);
            const cachedClub = getCachedClub(league.club_id);
            result.push({
              id: league.id, name: league.name, logo_url: null,
              club_logo_url: cachedClub?.logo_url || league.clubs?.logo_url || null,
              type: "league",
              club_name: cachedClub?.name || league.clubs?.name || "",
              sport: cachedClub?.sport || league.clubs?.sport || null,
              club_id: league.club_id, canManage,
            });
          }
        }
      }

      if (managedPlayhqCompsRes.data && managedPlayhqCompsRes.data.length > 0) {
        for (const comp of managedPlayhqCompsRes.data as ManagedPlayhqCompetitionRow[]) {
          const organizer = Array.isArray(comp.clubs) ? comp.clubs[0] : comp.clubs;
          // Only show a managed PlayHQ competition under the club that
          // actually organises it — never bleed it into other clubs the
          // user is a member of via the header club filter.
          if (activeClubFilter && comp.organizer_club_id !== activeClubFilter) continue;
          result.push({
            id: comp.id,
            name: comp.name,
            logo_url: comp.logo_url || null,
            club_logo_url: organizer?.logo_url || null,
            type: "competition",
            club_name: organizer?.name || "PlayHQ",
            sport: comp.sport || organizer?.sport || null,
            club_id: comp.organizer_club_id,
            canManage: true,
            competitionTeamsLabel: "Managed competition",
          });
        }
      }

      // Initial sort (without event dates — final activity sort happens in render once nextEvents resolves)
      return result.sort((a, b) => {
        if (a.canManage && !b.canManage) return -1;
        if (!a.canManage && b.canManage) return 1;
        if (a.type === "team" && b.type === "league") return -1;
        if (a.type === "league" && b.type === "team") return 1;
        return a.name.localeCompare(b.name);
      });
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch next events
  const teamIds = items.filter(i => i.type === "team").map(i => i.id);
  const leagueItemIds = items.filter(i => i.type === "league").map(i => i.id);

  const { data: nextEvents = snapshot?.nextEvents ?? {} } = useQuery({
    queryKey: ["team-next-events-premium", teamIds, leagueItemIds],
    queryFn: async () => {
      const now = new Date().toISOString();
      const map: Record<string, NextEventInfo> = {};

      const extractOpponent = (title: string): string | null => {
        // Match " v " or " vs " (case-insensitive). Take the right-hand side.
        const m = title.match(/\s+vs?\.?\s+(.+)$/i);
        return m ? m[1].trim() : null;
      };
      const buildLabel = (type: string | null, opponent: string | null, title: string, isBye: boolean) => {
        if (type === "training") return "Training";
        if (type === "social") return "Social";
        if ((type === "game" || type === "mini_league") && isBye) return "BYE — no match";
        const opp = opponent || extractOpponent(title);
        if ((type === "game" || type === "mini_league") && opp) return `Game v ${opp}`;
        if (type === "game" || type === "mini_league") return "Game";
        return title;
      };

      // PER-SCOPE FAN-OUT: one `.in(...)` query with a global limit lets a
      // busy team's fixture list consume the whole window and starve quieter
      // teams of their "next event" label. Bound each team individually.
      if (teamIds.length > 0) {
        const results = await Promise.all(
          teamIds.map((teamId) =>
            supabase
              .from("events")
              .select("team_id, title, type, opponent, event_date, is_bye")
              .eq("team_id", teamId)
              .gte("event_date", now)
              .eq("is_cancelled", false)
              .order("event_date", { ascending: true })
              .limit(1)
          )
        );
        const data = results.flatMap((r) => r.data || []);
        {
          for (const event of data) {
            if (event.team_id && !map[event.team_id]) {
              map[event.team_id] = {
                title: buildLabel(event.type, event.opponent, event.title, !!event.is_bye),
                dateLabel: formatShortDate(event.event_date),
                type: event.type,
                eventDate: event.event_date,
              };
            }
          }
        }
      }

      if (leagueItemIds.length > 0) {
        const results = await Promise.all(
          leagueItemIds.map((leagueId) =>
            supabase
              .from("events")
              .select("mini_league_id, title, type, opponent, event_date, is_bye")
              .eq("mini_league_id", leagueId)
              .gte("event_date", now)
              .eq("is_cancelled", false)
              .order("event_date", { ascending: true })
              .limit(1)
          )
        );
        const data = results.flatMap((r) => r.data || []);
        {
          for (const event of data) {
            if (event.mini_league_id && !map[event.mini_league_id]) {
              map[event.mini_league_id] = {
                title: buildLabel(event.type, event.opponent, event.title, !!event.is_bye),
                dateLabel: formatShortDate(event.event_date),
                type: event.type,
                eventDate: event.event_date,
              };
            }
          }
        }
      }

      return map;
    },
    enabled: items.length > 0,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch recent photos per team (3 thumbnails) + total photo count per team.
  const { data: teamPhotos = snapshot?.teamPhotos ?? {} } = useQuery({
    queryKey: ["team-photos-premium", teamIds],
    queryFn: async () => {
      if (teamIds.length === 0) return {};
      const map: Record<string, { id: string; url: string }[]> = {};

      const { data } = await supabase
        .from("photos")
        .select("id, team_id, file_url, image_url")
        .in("team_id", teamIds)
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(teamIds.length * 3);

      if (data) {
        const rawUrls: string[] = [];
        const entries: { teamId: string; id: string; rawUrl: string }[] = [];
        for (const photo of data) {
          if (!photo.team_id) continue;
          const url = photo.file_url || photo.image_url;
          if (!url) continue;
          if (!map[photo.team_id]) map[photo.team_id] = [];
          if (entries.filter((e) => e.teamId === photo.team_id).length >= 3) continue;
          entries.push({ teamId: photo.team_id, id: photo.id, rawUrl: url });
          rawUrls.push(url);
        }

        const signed = await getSignedPhotoUrls(rawUrls);
        for (const entry of entries) {
          const resolved = signed[entry.rawUrl];
          if (!resolved) {
            // Private URL that failed signing — skip rather than expose raw URL.
            if (entry.rawUrl.includes("/storage/v1/object/")) continue;
            map[entry.teamId].push({ id: entry.id, url: entry.rawUrl });
            continue;
          }
          map[entry.teamId].push({ id: entry.id, url: resolved });
        }
      }

      return map;
    },
    enabled: teamIds.length > 0 && deferredReady,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Count of NEW photos per team (uploaded in the last 7 days) so the card
  // label reflects fresh activity rather than the full gallery size.
  const { data: teamPhotoCounts = {} as Record<string, number> } = useQuery({
    queryKey: ["team-photo-counts-premium-new", teamIds],
    queryFn: async () => {
      if (teamIds.length === 0) return {} as Record<string, number>;
      const counts: Record<string, number> = {};
      const sinceIso = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data } = await supabase
        .from("photos")
        .select("team_id")
        .in("team_id", teamIds)
        .eq("show_in_feed", true)
        .is("deleted_at", null)
        .gte("created_at", sinceIso)
        .limit(2000);
      if (data) {
        for (const row of data as { team_id: string | null }[]) {
          if (!row.team_id) continue;
          counts[row.team_id] = (counts[row.team_id] || 0) + 1;
        }
      }
      return counts;
    },
    enabled: teamIds.length > 0 && deferredReady,
    staleTime: 5 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Fetch active competition rows per team via security-definer RPC so all
  // team members (not just admins) can see which competitions their team is
  // entered in — RLS on competition_entries would otherwise hide it.
  type CompetitionRow = {
    team_id: string;
    competition_id: string;
    competition_name: string;
    competition_logo_url: string | null;
    competition_sport: string | null;
  };
  const { data: competitionRows = [] as CompetitionRow[] } = useQuery({
    queryKey: ["team-competitions-premium-v3", teamIds],
    queryFn: async () => {
      if (teamIds.length === 0) return [] as CompetitionRow[];
      const { data, error } = await supabase.rpc("get_team_competition_names", {
        _team_ids: teamIds,
      });
      if (error) return [] as CompetitionRow[];
      return (data || []) as CompetitionRow[];
    },
    enabled: teamIds.length > 0,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Per-team competition name (small inline label on team cards).
  const competitionNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const row of competitionRows) {
      if (row.team_id && row.competition_name && !map[row.team_id]) {
        map[row.team_id] = row.competition_name;
      }
    }
    return map;
  }, [competitionRows]);

  // Unique competition cards: one per competition, with a comma-separated
  // list of the user's teams entered in that competition.
  const competitionItems = useMemo<TeamOrLeague[]>(() => {
    if (competitionRows.length === 0) return [];
    const byComp = new Map<string, { row: CompetitionRow; teamNames: string[] }>();
    const teamNameById = new Map(items.filter(i => i.type === "team").map(i => [i.id, i.name] as const));
    for (const row of competitionRows) {
      if (!row.competition_id) continue;
      const existing = byComp.get(row.competition_id);
      const teamName = teamNameById.get(row.team_id);
      if (existing) {
        if (teamName && !existing.teamNames.includes(teamName)) existing.teamNames.push(teamName);
      } else {
        byComp.set(row.competition_id, { row, teamNames: teamName ? [teamName] : [] });
      }
    }
    return Array.from(byComp.values()).map(({ row, teamNames }) => ({
      id: row.competition_id,
      name: row.competition_name,
      logo_url: row.competition_logo_url,
      club_logo_url: null,
      type: "competition" as const,
      club_name: "",
      sport: row.competition_sport,
      club_id: "",
      canManage: false,
      competitionTeamsLabel: teamNames.join(", "),
    }));
  }, [competitionRows, items]);




  // Messages inbox (notifications.is_read=false) so the team card and inbox
  // never disagree. Shared via useUnreadMessageCounts so the RPC is deduped
  // with MessagesPage + BottomNav.
  const { data: unreadCounts = snapshot?.unreadCounts ?? {} } = useUnreadMessageCounts(user?.id, {
    enabled: teamIds.length > 0,
    placeholderData: (prev) => prev,
    select: (counts) => {
      const map: Record<string, number> = {};
      for (const id of teamIds) {
        const n = counts.teams[id] ?? 0;
        if (n > 0) map[id] = n;
      }
      return map;
    },
  });

  // Fetch members + avatars per team for the social fallback footer state.
  // Deferred until idle so it never delays the first paint.
  const { data: teamMembers = snapshot?.teamMembers ?? {} } = useQuery({
    queryKey: ["team-members-premium", teamIds],
    queryFn: async () => {
      if (teamIds.length === 0) return {};
      const { data: roles } = await supabase
        .from("user_roles")
        .select("team_id, user_id")
        .in("team_id", teamIds);
      if (!roles) return {};

      const byTeam: Record<string, Set<string>> = {};
      for (const r of roles) {
        if (!r.team_id || !r.user_id) continue;
        if (!byTeam[r.team_id]) byTeam[r.team_id] = new Set();
        byTeam[r.team_id].add(r.user_id);
      }

      const allUserIds = Array.from(new Set(roles.map(r => r.user_id).filter(Boolean) as string[]));
      const profileMap = new Map<string, string | null>();
      if (allUserIds.length > 0) {
        const { data: profiles } = await selectCachedProfilesByIds(allUserIds);
        for (const p of profiles || []) profileMap.set(p.id, p.avatar_url);
      }

      // Sign avatar URLs in one batch
      const rawAvatarUrls = new Set<string>();
      for (const url of profileMap.values()) if (url) rawAvatarUrls.add(url);
      const signed = rawAvatarUrls.size > 0
        ? await getSignedPhotoUrls(Array.from(rawAvatarUrls))
        : {};

      const map: Record<string, MemberSummary> = {};
      for (const teamId of teamIds) {
        const userIds = Array.from(byTeam[teamId] || []);
        const avatars: string[] = [];
        for (const uid of userIds) {
          const raw = profileMap.get(uid);
          if (!raw) continue;
          const resolved = signed[raw];
          if (!resolved) {
            // Private avatar URL that couldn't be signed — skip rather than
            // hand the raw private URL to the <img>.
            if (raw.includes("/storage/v1/object/")) continue;
            avatars.push(raw);
          } else {
            avatars.push(resolved);
          }
          if (avatars.length >= 3) break;
        }
        map[teamId] = { count: userIds.length, avatars };
      }
      return map;
    },
    enabled: teamIds.length > 0 && deferredReady,
    staleTime: 10 * 60 * 1000,
    placeholderData: (prev) => prev,
  });

  // Guard against cross-club bleed: `placeholderData: (prev) => prev` keeps the
  // previous club's rows visible while the new query key loads, so anything not
  // belonging to the active club must be dropped at render time.
  const scopedItems = useMemo(
    () => (activeClubFilter ? items.filter(i => i.club_id === activeClubFilter) : items),
    [items, activeClubFilter]
  );

  // Persist snapshot for instant cold-start on next visit
  useEffect(() => {
    if (!user?.id || scopedItems.length === 0) return;
    setCachedCarousel<CarouselSnapshot>(user.id, activeClubFilter, {
      items: scopedItems,
      nextEvents,
      teamPhotos,
      unreadCounts,
      teamMembers,
    });
  }, [user?.id, activeClubFilter, scopedItems, nextEvents, teamPhotos, unreadCounts, teamMembers]);

  const showSkeleton = (!initialized || isLoading || (isFetching && scopedItems.length === 0)) && !snapshot;

  // Section is "ready" only once the primary teams query has actually settled
  // (i.e. not its first load and not a background refetch with no items yet).
  // Snapshot keeps the skeleton hidden for instant paint, but we must NOT
  // signal ready off the snapshot alone — otherwise My Teams reports ready
  // immediately while Next Up is still waiting on its first hero, and they
  // visibly desync on native cold opens.
  const dataSettled = initialized && !isLoading && !(isFetching && scopedItems.length === 0);
  const sectionReady = dataSettled || (!!snapshot && !isLoading);

  useEffect(() => {
    onReadyChange?.(sectionReady);
    // No false-reset on cleanup: it caused needless ready toggles when the
    // effect re-ran, which delayed the unified Home reveal.
  }, [onReadyChange, sectionReady]);

  if (showSkeleton) {
    return <MyTeamsCarouselSkeleton />;
  }


  const showCreateClub = !activeClubFilter;

  // Fall back to the last-known-good snapshot when the fresh query transiently
  // resolves to `[]` — e.g. on app resume after inactivity, when a refetch can
  // race a stale auth token or a momentary RLS hiccup and return zero rows.
  // Without this fallback the carousel vanishes until relaunch. The snapshot
  // write effect already refuses to overwrite the cache with an empty list,
  // so this only ever shows genuinely stale-but-real data during the blip.
  // Snapshot rows are scoped to the same club filter key, but re-filter anyway.
  const snapshotItems = activeClubFilter
    ? (snapshot?.items ?? []).filter(i => i.club_id === activeClubFilter)
    : (snapshot?.items ?? []);
  const displayItems = scopedItems.length > 0 ? scopedItems : snapshotItems;

  // Empty state: onboarding with clear paths
  if (displayItems.length === 0) {
    return null;
  }

  const createClubCard = showCreateClub ? (
    <Card
      className="min-w-[200px] max-w-[200px] snap-start cursor-pointer border border-dashed border-primary/30 bg-card/50 hover:border-primary/60 hover:bg-accent/30 transition-all shrink-0"
      onClick={() => navigate("/clubs", { state: { fromCreateClub: true } })}
    >
      <CardContent className="p-4 flex flex-col items-center justify-center gap-2 h-full text-center">
        <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Building2 className="h-5 w-5 text-primary" />
        </div>
        <p className="text-sm font-medium">Create a Club</p>
        <p className="text-[11px] text-muted-foreground leading-tight">Start a new organisation</p>
      </CardContent>
    </Card>
  ) : null;

  const renderedCompetitionItems = [
    ...competitionItems,
    ...displayItems.filter((item) =>
      item.type === "competition" && !competitionItems.some((c) => c.id === item.id),
    ),
  ];

  // Re-sort by upcoming activity once nextEvents resolves (without re-fetching)
  const sortedItems = displayItems.filter((item) => item.type !== "competition").sort((a, b) => {
    if (a.canManage && !b.canManage) return -1;
    if (!a.canManage && b.canManage) return 1;
    const aDate = nextEvents[a.id]?.eventDate;
    const bDate = nextEvents[b.id]?.eventDate;
    if (aDate && !bDate) return -1;
    if (!aDate && bDate) return 1;
    if (aDate && bDate && aDate !== bDate) return aDate < bDate ? -1 : 1;
    if (a.type === "team" && b.type === "league") return -1;
    if (a.type === "league" && b.type === "team") return 1;
    return a.name.localeCompare(b.name);
  });

  return (
    <section className="space-y-2.5">
      <h2 className="text-xl font-bold px-1 tracking-tight">
        {renderedCompetitionItems.length > 0 ? "My Teams & Competitions" : "My Teams"}
      </h2>
      <div className="-mx-4 px-4 overflow-x-auto scrollbar-hide">
        <div className="flex gap-3 pb-2 snap-x snap-mandatory pr-4">
          {renderedCompetitionItems.map((item) => (
            <TeamCard
              key={`${item.type}-${item.id}`}
              item={item}
              photos={[]}
            />
          ))}
          {sortedItems.map((item) => (
            <TeamCard
              key={`${item.type}-${item.id}`}
              item={item}
              nextEvent={nextEvents[item.id]}
              photos={teamPhotos[item.id] || []}
              photoCount={teamPhotoCounts[item.id]}
              unreadMessages={unreadCounts[item.id]}
              members={teamMembers[item.id]}
              competitionName={competitionNames[item.id]}
            />
          ))}
          {createClubCard}
        </div>
      </div>
    </section>
  );
}
