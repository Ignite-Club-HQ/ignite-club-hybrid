import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, Loader2, Flame } from "lucide-react";
import { format } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { openHtmlReport, downloadTextReport } from "@/lib/reportExport";
import { useReportExtras, playerKey, type PlayerHonours } from "./playerStatsReportExtras";

interface PlayerStatsReportViewProps {
  teamId: string;
  teamName: string;
  teamLogoUrl: string | null;
  clubName?: string | null;
  clubLogoUrl?: string | null;
  eventId?: string;
  event?: {
    id: string;
    title: string;
    event_date: string;
    opponent: string | null;
  };
  dateRange?: {
    from: Date;
    to: Date;
  };
}

interface PlayerStat {
  id: string;
  user_id: string | null;
  child_id: string | null;
  fill_in_player_name: string | null;
  jersey_number: number | null;
  minutes_played: number;
  positions_played: string[];
  position_minutes: Record<string, number> | null;
  substitutions_count: number;
  started_on_pitch: boolean;
  goals_scored: number;
  games_played?: number;
  starts_count?: number;
  profiles?: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export default function PlayerStatsReportView({
  teamId,
  teamName,
  teamLogoUrl,
  clubName,
  clubLogoUrl,
  eventId,
  event,
  dateRange,
}: PlayerStatsReportViewProps) {
  const reportRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  // Fetch player stats
  const { data: playerStats, isLoading } = useQuery({
    queryKey: ["player-stats-report", teamId, eventId, dateRange?.from?.toISOString(), dateRange?.to?.toISOString()],
    queryFn: async () => {
      let query = supabase
        .from("game_player_stats")
        .select(`
          id,
          user_id,
          child_id,
          fill_in_player_name,
          jersey_number,
          minutes_played,
          positions_played,
          position_minutes,
          substitutions_count,
          started_on_pitch,
          goals_scored,
          profiles:user_id(display_name, avatar_url)
        `)
        .eq("team_id", teamId);

      if (eventId) {
        query = query.eq("event_id", eventId);
      } else if (dateRange) {
        // Get events in date range first
        const { data: events } = await supabase
          .from("events")
          .select("id")
          .eq("team_id", teamId)
          .eq("type", "game")
          .gte("event_date", dateRange.from.toISOString())
          .lte("event_date", dateRange.to.toISOString());

        if (!events || events.length === 0) return [];

        const eventIds = events.map((e) => e.id);
        query = query.in("event_id", eventIds);
      }

      const { data, error } = await query;
      if (error) throw error;

      // Aggregate stats if date range
      if (dateRange && data) {
        const aggregated = new Map<string, PlayerStat>();

        data.forEach((stat: any) => {
          const key = stat.user_id || stat.fill_in_player_name || stat.id;
          const existing = aggregated.get(key);

          if (existing) {
            existing.minutes_played += stat.minutes_played;
            existing.substitutions_count += stat.substitutions_count;
            existing.goals_scored += stat.goals_scored || 0;
            existing.games_played = (existing.games_played || 0) + 1;
            existing.starts_count = (existing.starts_count || 0) + (stat.started_on_pitch ? 1 : 0);
            stat.positions_played.forEach((pos: string) => {
              if (!existing.positions_played.includes(pos)) {
                existing.positions_played.push(pos);
              }
            });
            // Aggregate position minutes
            if (stat.position_minutes) {
              if (!existing.position_minutes) {
                existing.position_minutes = {};
              }
              Object.entries(stat.position_minutes as Record<string, number>).forEach(([pos, mins]) => {
                existing.position_minutes![pos] = (existing.position_minutes![pos] || 0) + mins;
              });
            }
          } else {
            aggregated.set(key, {
              ...stat,
              positions_played: [...stat.positions_played],
              position_minutes: stat.position_minutes ? { ...stat.position_minutes } : null,
              goals_scored: stat.goals_scored || 0,
              games_played: 1,
              starts_count: stat.started_on_pitch ? 1 : 0,
            });
          }
        });

        return Array.from(aggregated.values());
      }

      return data as PlayerStat[];
    },
    enabled: !!teamId && (!!eventId || !!dateRange),
  });

  // Fetch game summary for single game
  const { data: gameSummary } = useQuery({
    queryKey: ["game-summary-report", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("game_summaries")
        .select("*")
        .eq("event_id", eventId!)
        .single();

      if (error) throw error;
      return data;
    },
    enabled: !!eventId,
  });

  // Match scores + captain / POM / GK honours for the report range.
  const { data: extras } = useReportExtras(teamId, { eventId, dateRange });

  // When no pitch-board session was tracked (game_player_stats empty), we can
  // still show goal scorers entered via the Match Result sheet. Synthesize
  // lightweight PlayerStat rows from extras.scorersByPlayer so the report is
  // not a dead-end for teams that only log scores.
  const trackedStats = playerStats ?? [];
  const hasTrackedStats = trackedStats.length > 0;
  const scorerRows: PlayerStat[] = (() => {
    if (hasTrackedStats || !extras?.scorersByPlayer) return [];
    return Object.entries(extras.scorersByPlayer).map(([id, agg]) => ({
      id,
      user_id: null,
      child_id: null,
      fill_in_player_name: agg.name,
      jersey_number: null,
      minutes_played: 0,
      positions_played: [],
      position_minutes: null,
      substitutions_count: 0,
      started_on_pitch: false,
      goals_scored: agg.goals,
      games_played: agg.games,
      starts_count: 0,
      profiles: null,
    }));
  })();
  const reportStats = hasTrackedStats ? trackedStats : scorerRows;

  const honoursFor = (stat: PlayerStat): PlayerHonours => {
    const key = playerKey(stat.user_id, stat.child_id);
    return (
      extras?.honours?.[key] ?? {
        captain: 0,
        pom: 0,
        gkMatches: 0,
        gkAppointed: 0,
        gkSeconds: 0,
      }
    );
  };

  const playerName = (stat: PlayerStat) =>
    stat.fill_in_player_name || stat.profiles?.display_name || "Unknown";

  const formatMinutes = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, "0")}`;
  };

  const handleDownload = async () => {
    if (!reportRef.current) return;

    try {
      const logoUrl = teamLogoUrl || clubLogoUrl;
      const reportTitle = eventId && event
        ? `${teamName} vs ${event.opponent || "Unknown"} - ${format(new Date(event.event_date), "MMM d, yyyy")}`
        : `${teamName} Stats - ${format(dateRange!.from, "MMM d")} to ${format(dateRange!.to, "MMM d, yyyy")}`;

      const html = `
        <!DOCTYPE html>
        <html>
        <head>
          <title>${reportTitle}</title>
          <style>
            * { box-sizing: border-box; margin: 0; padding: 0; }
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; padding: 40px; color: #1a1a1a; }
            .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 30px; border-bottom: 2px solid #e5e5e5; padding-bottom: 20px; }
            .team-info { display: flex; align-items: center; gap: 16px; }
            .team-logo { width: 60px; height: 60px; border-radius: 8px; object-fit: cover; }
            .team-name { font-size: 24px; font-weight: bold; }
            .club-name { font-size: 14px; color: #666; }
            .ignite-branding { display: flex; align-items: center; gap: 8px; }
            .ignite-logo { color: #f97316; }
            .ignite-text { font-size: 14px; color: #666; }
            .report-title { font-size: 18px; font-weight: 600; margin-bottom: 20px; }
            .summary { display: flex; gap: 30px; margin-bottom: 30px; background: #f8f8f8; padding: 16px; border-radius: 8px; }
            .summary-item { text-align: center; }
            .summary-value { font-size: 24px; font-weight: bold; color: #f97316; }
            .summary-label { font-size: 12px; color: #666; text-transform: uppercase; }
            table { width: 100%; border-collapse: collapse; }
            th { background: #f3f3f3; padding: 12px 8px; text-align: left; font-size: 12px; text-transform: uppercase; color: #666; border-bottom: 2px solid #e5e5e5; }
            td { padding: 12px 8px; border-bottom: 1px solid #e5e5e5; }
            tr:nth-child(even) { background: #fafafa; }
            .player-name { font-weight: 500; }
            .jersey { color: #666; font-size: 12px; }
            .position-badge { display: inline-block; background: #e5e5e5; padding: 2px 6px; border-radius: 4px; font-size: 11px; margin: 2px; }
            .footer { margin-top: 40px; text-align: center; color: #999; font-size: 12px; }
            @media print {
              body { padding: 20px; }
              .header { page-break-after: avoid; }
            }
          </style>
        </head>
        <body>
          <div class="header">
            <div class="team-info">
              ${logoUrl ? `<img src="${logoUrl}" alt="${teamName}" class="team-logo" />` : ""}
              <div>
                <div class="team-name">${teamName}</div>
                ${clubName ? `<div class="club-name">${clubName}</div>` : ""}
              </div>
            </div>
            <div class="ignite-branding">
              <svg class="ignite-logo" width="24" height="24" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
              </svg>
              <span class="ignite-text">Powered by Ignite</span>
            </div>
          </div>

          <div class="report-title">${reportTitle}</div>

          ${gameSummary ? `
            <div class="summary">
              <div class="summary-item">
                <div class="summary-value">${formatMinutes(gameSummary.total_game_time)}</div>
                <div class="summary-label">Total Time</div>
              </div>
              <div class="summary-item">
                <div class="summary-value">${reportStats.length || 0}</div>
                <div class="summary-label">Players</div>
              </div>
              <div class="summary-item">
                <div class="summary-value">${gameSummary.total_substitutions}</div>
                <div class="summary-label">Substitutions</div>
              </div>
              ${gameSummary.formation_used ? `
                <div class="summary-item">
                  <div class="summary-value">${gameSummary.formation_used}</div>
                  <div class="summary-label">Formation</div>
                </div>
              ` : ""}
            </div>
          ` : ""}

          ${extras && extras.totals.played > 0 ? `
            <div class="summary">
              <div class="summary-item"><div class="summary-value">${extras.totals.played}</div><div class="summary-label">Played</div></div>
              <div class="summary-item"><div class="summary-value">${extras.totals.won}-${extras.totals.drawn}-${extras.totals.lost}</div><div class="summary-label">W-D-L</div></div>
              <div class="summary-item"><div class="summary-value">${extras.totals.goalsFor}</div><div class="summary-label">Goals For</div></div>
              <div class="summary-item"><div class="summary-value">${extras.totals.goalsAgainst}</div><div class="summary-label">Goals Against</div></div>
              <div class="summary-item"><div class="summary-value">${extras.totals.goalDifference > 0 ? "+" : ""}${extras.totals.goalDifference}</div><div class="summary-label">Goal Diff</div></div>
            </div>
          ` : ""}

          ${extras && extras.matches.length > 0 ? `
            <div class="report-title">Matches</div>
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Opponent</th>
                  <th style="width: 90px; text-align: center;">Score</th>
                  <th style="width: 50px; text-align: center;">Result</th>
                  <th>Periods</th>
                  <th>Captain</th>
                  <th>Player of the Match</th>
                  <th>Scorers</th>
                </tr>
              </thead>
              <tbody>
                ${extras.matches.map((m) => {
                  const mismatch =
                    m.homeScore != null && m.playerGoals !== m.homeScore
                      ? ` <span class="jersey">(player goals: ${m.playerGoals})</span>`
                      : "";
                  return `
                    <tr>
                      <td>${m.eventDate ? format(new Date(m.eventDate), "d MMM yyyy") : "-"}</td>
                      <td>${m.opponent || m.title || "-"}</td>
                      <td style="text-align: center;">${m.homeScore == null || m.awayScore == null ? "-" : `${m.homeScore}–${m.awayScore}`}${mismatch}</td>
                      <td style="text-align: center;">${m.result ?? "-"}</td>
                      <td>${m.periodScores.map((p) => `<span class="position-badge">${p.home}-${p.away}</span>`).join("") || "-"}</td>
                      <td>${m.captainNames.join(", ") || "-"}</td>
                      <td>${m.pomNames.join(", ") || "-"}</td>
                      <td>${m.scorers.map((s) => `${s.name} (${s.goals})`).join(", ") || "-"}</td>
                    </tr>
                  `;
                }).join("")}
              </tbody>
            </table>
            <div style="height: 24px;"></div>
          ` : ""}

          <table>
            <thead>
              <tr>
                <th style="width: 50px;">#</th>
                <th>Player</th>
                <th style="width: 60px; text-align: center;">Goals</th>
                <th style="width: 80px;">Total</th>
                <th>Minutes by Position</th>
                <th style="width: 60px; text-align: center;">Subs</th>
                <th style="width: 70px; text-align: center;">Captain (n)</th>
                <th style="width: 60px; text-align: center;">POM (n)</th>
                <th style="width: 90px; text-align: center;">GK matches (n)</th>
                <th style="width: 80px; text-align: center;">GK minutes</th>
                ${dateRange ? `
                <th style="width: 60px; text-align: center;">GP</th>
                <th style="width: 60px; text-align: center;">Starts</th>
                ` : `<th style="width: 70px; text-align: center;">Started</th>`}
              </tr>
            </thead>
            <tbody>
              ${sortedStats
                .sort((a, b) => b.minutes_played - a.minutes_played)
                .map((stat) => {
                  const positionMinsHtml = stat.position_minutes && Object.keys(stat.position_minutes).length > 0
                    ? Object.entries(stat.position_minutes)
                        .sort(([, a], [, b]) => (b as number) - (a as number))
                        .map(([pos, secs]) => `<span class="position-badge">${pos}: ${formatMinutes(secs as number)}</span>`)
                        .join("")
                    : stat.positions_played.map((p) => `<span class="position-badge">${p}</span>`).join("");

                  return `
                    <tr>
                      <td class="jersey">${stat.jersey_number || "-"}</td>
                      <td class="player-name">${stat.fill_in_player_name || stat.profiles?.display_name || "Unknown"}</td>
                      <td style="text-align: center; font-weight: ${stat.goals_scored > 0 ? 'bold' : 'normal'}; color: ${stat.goals_scored > 0 ? '#f97316' : 'inherit'};">${stat.goals_scored || 0}</td>
                      <td>${formatMinutes(stat.minutes_played)}</td>
                      <td>${positionMinsHtml}</td>
                      <td style="text-align: center;">${stat.substitutions_count}</td>
                      <td style="text-align: center;">${honoursFor(stat).captain}</td>
                      <td style="text-align: center;">${honoursFor(stat).pom}</td>
                      <td style="text-align: center;">${Math.max(honoursFor(stat).gkMatches, honoursFor(stat).gkAppointed)}</td>
                      <td style="text-align: center;">${formatMinutes(honoursFor(stat).gkSeconds)}</td>
                      ${dateRange
                        ? `<td style="text-align: center;">${stat.games_played ?? 1}</td><td style="text-align: center;">${stat.starts_count ?? (stat.started_on_pitch ? 1 : 0)}</td>`
                        : `<td style="text-align: center;">${stat.started_on_pitch ? "Yes" : "No"}</td>`}
                    </tr>
                  `;
                }).join("")}
            </tbody>
          </table>

          <div class="footer">
            Generated on ${format(new Date(), "MMMM d, yyyy 'at' h:mm a")} • Ignite Club HQ
          </div>
        </body>
        </html>
      `;

      const result = await openHtmlReport(html, `${reportTitle}.html`);
      if (result === "popup_blocked") {
        toast({
          title: "Popup blocked",
          description: "Please allow popups to download the report.",
          variant: "destructive",
        });
      }
    } catch (error) {
      console.error("Failed to generate report:", error);
      toast({
        title: "Failed to generate report",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleDownloadCsv = async () => {
    const csvCell = (value: unknown) => {
      const text = value == null ? "" : String(value);
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const rows: string[][] = [];

    if (extras && extras.matches.length > 0) {
      rows.push(["Matches"]);
      rows.push([
        "Date", "Opponent", "Home", "Away", "Result", "Periods",
        "Captain", "Player of the Match", "Goalkeeper", "Player goals recorded",
      ]);
      extras.matches.forEach((m) => {
        rows.push([
          m.eventDate ? format(new Date(m.eventDate), "yyyy-MM-dd") : "",
          m.opponent || m.title || "",
          m.homeScore == null ? "" : String(m.homeScore),
          m.awayScore == null ? "" : String(m.awayScore),
          m.result ?? "",
          m.periodScores.map((p) => `${p.home}-${p.away}`).join(" | "),
          m.captainNames.join(" | "),
          m.pomNames.join(" | "),
          m.goalkeeperNames.join(" | "),
          String(m.playerGoals),
        ]);
      });
      rows.push([]);
      rows.push([
        "Played", "Won", "Drawn", "Lost", "Goals For", "Goals Against", "Goal Difference",
      ]);
      rows.push([
        String(extras.totals.played), String(extras.totals.won), String(extras.totals.drawn),
        String(extras.totals.lost), String(extras.totals.goalsFor),
        String(extras.totals.goalsAgainst), String(extras.totals.goalDifference),
      ]);
      rows.push([]);
    }

    rows.push(["Players"]);
    rows.push([
      "#", "Player", "Goals", "Minutes", "Subs", "Captain (n)", "POM (n)",
      "GK matches (n)", "GK minutes", "Games played", "Starts", "Positions",
    ]);
    sortedStats.forEach((stat) => {
      const h = honoursFor(stat);
      rows.push([
        stat.jersey_number == null ? "" : String(stat.jersey_number),
        playerName(stat),
        String(stat.goals_scored || 0),
        formatMinutes(stat.minutes_played),
        String(stat.substitutions_count),
        String(h.captain),
        String(h.pom),
        String(Math.max(h.gkMatches, h.gkAppointed)),
        formatMinutes(h.gkSeconds),
        String(stat.games_played ?? 1),
        String(stat.starts_count ?? (stat.started_on_pitch ? 1 : 0)),
        stat.positions_played.join(" | "),
      ]);
    });

    const csv = rows.map((r) => r.map(csvCell).join(",")).join("\n");
    const name = `${teamName.replace(/[^a-zA-Z0-9]+/g, "-")}-player-stats.csv`;
    try {
      await downloadTextReport(csv, name, "text/csv");
    } catch (error) {
      console.error("Failed to export CSV:", error);
      toast({
        title: "Failed to export CSV",
        description: "Please try again.",
        variant: "destructive",
      });
    }
  };

  if (isLoading) {
    return (
      <Card>
        <CardContent className="py-8 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  // No pitch-board stats AND no match scores — nothing to show at all.
  const hasAnyData =
    reportStats.length > 0 ||
    (extras && extras.totals.played > 0) ||
    (extras && extras.matches.length > 0);
  if (!hasAnyData) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground">
          No player statistics found for this selection.
        </CardContent>
      </Card>
    );
  }

  const sortedStats = [...reportStats].sort((a, b) => b.minutes_played - a.minutes_played);
  const isScorerOnly = !hasTrackedStats && scorerRows.length > 0;

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base flex items-center gap-2">
          <Flame className="h-5 w-5 text-primary" />
          Player Statistics
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button onClick={handleDownloadCsv} size="sm" variant="outline" className="gap-2">
            <Download className="h-4 w-4" />
            CSV
          </Button>
          <Button onClick={handleDownload} size="sm" className="gap-2">
            <Download className="h-4 w-4" />
            Download Report
          </Button>
        </div>
      </CardHeader>
      <CardContent ref={reportRef}>
        {/* Summary Stats */}
        {gameSummary && (
          <div className="grid grid-cols-3 sm:grid-cols-4 gap-4 mb-6">
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-xl font-bold text-primary">
                {formatMinutes(gameSummary.total_game_time)}
              </div>
              <div className="text-xs text-muted-foreground">Total Time</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-xl font-bold text-primary">
                {reportStats.length}
              </div>
              <div className="text-xs text-muted-foreground">Players</div>
            </div>
            <div className="text-center p-3 bg-muted rounded-lg">
              <div className="text-xl font-bold text-primary">
                {gameSummary.total_substitutions}
              </div>
              <div className="text-xs text-muted-foreground">Subs</div>
            </div>
            {gameSummary.formation_used && (
              <div className="text-center p-3 bg-muted rounded-lg">
                <div className="text-xl font-bold text-primary">
                  {gameSummary.formation_used}
                </div>
                <div className="text-xs text-muted-foreground">Formation</div>
              </div>
            )}
          </div>
        )}

        {/* Team result summary */}
        {extras && extras.totals.played > 0 && (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 mb-6">
            {[
              { label: "Played", value: String(extras.totals.played) },
              { label: "W-D-L", value: `${extras.totals.won}-${extras.totals.drawn}-${extras.totals.lost}` },
              { label: "Goals For", value: String(extras.totals.goalsFor) },
              { label: "Goals Against", value: String(extras.totals.goalsAgainst) },
              { label: "Goal Diff", value: `${extras.totals.goalDifference > 0 ? "+" : ""}${extras.totals.goalDifference}` },
            ].map((item) => (
              <div key={item.label} className="text-center p-3 bg-muted rounded-lg">
                <div className="text-xl font-bold text-primary">{item.value}</div>
                <div className="text-xs text-muted-foreground">{item.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Per-match results */}
        {extras && extras.matches.length > 0 && (
          <div className="mb-6 overflow-x-auto -mx-6 px-6">
            <h3 className="text-sm font-semibold mb-2">Matches</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Opponent</TableHead>
                  <TableHead className="text-center">Score</TableHead>
                  <TableHead className="text-center">Result</TableHead>
                  <TableHead className="hidden sm:table-cell">Periods</TableHead>
                  <TableHead className="hidden sm:table-cell">Captain</TableHead>
                  <TableHead className="hidden sm:table-cell">POM</TableHead>
                  <TableHead className="hidden sm:table-cell">Scorers</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {extras.matches.map((m) => (
                  <TableRow key={m.eventId}>
                    <TableCell className="whitespace-nowrap">
                      {m.eventDate ? format(new Date(m.eventDate), "d MMM yyyy") : "-"}
                    </TableCell>
                    <TableCell>{m.opponent || m.title || "-"}</TableCell>
                    <TableCell className="text-center font-mono">
                      {m.homeScore == null || m.awayScore == null
                        ? "-"
                        : `${m.homeScore}\u2013${m.awayScore}`}
                      {m.homeScore != null && m.playerGoals !== m.homeScore && (
                        <span className="ml-1 text-xs text-muted-foreground">
                          (players: {m.playerGoals})
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-center font-medium">{m.result ?? "-"}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                      {m.periodScores.map((p) => `${p.home}-${p.away}`).join(" · ") || "-"}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">{m.captainNames.join(", ") || "-"}</TableCell>
                    <TableCell className="hidden sm:table-cell">{m.pomNames.join(", ") || "-"}</TableCell>
                    <TableCell className="hidden sm:table-cell text-xs">
                      {m.scorers.map((s) => `${s.name} (${s.goals})`).join(", ") || "-"}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {/* Scorer-only notice — goals logged via Match Result, no pitch-board tracking */}
        {isScorerOnly && (
          <div className="mb-4 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-700 dark:text-amber-400">
            Showing goal scorers from match results. Track games on the pitch board to capture minutes, positions, and substitutions.
          </div>
        )}

        {/* Player Stats Table */}
        {reportStats.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground text-sm">
            No per-player tracking data for this selection. Scores and match results are shown above.
          </div>
        ) : (
        <div className="overflow-x-auto -mx-6 px-6">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[50px]">#</TableHead>
                <TableHead>Player</TableHead>
                <TableHead className="text-center w-[60px]">Goals</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead className="hidden sm:table-cell">Minutes by Position</TableHead>
                <TableHead className="text-center hidden sm:table-cell">Subs</TableHead>
                <TableHead className="text-center">Captain</TableHead>
                <TableHead className="text-center">POM</TableHead>
                <TableHead className="text-center hidden sm:table-cell">GK matches</TableHead>
                <TableHead className="text-center hidden sm:table-cell">GK mins</TableHead>
                {dateRange ? (
                  <>
                    <TableHead className="text-center">GP</TableHead>
                    <TableHead className="text-center">Starts</TableHead>
                  </>
                ) : (
                  <TableHead className="text-center hidden sm:table-cell">Started</TableHead>
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedStats.map((stat) => (
                <TableRow key={stat.id}>
                  <TableCell className="font-medium text-muted-foreground">
                    {stat.jersey_number || "-"}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      {stat.profiles?.avatar_url ? (
                        <Avatar className="h-6 w-6">
                          <AvatarImage src={stat.profiles.avatar_url} />
                          <AvatarFallback className="text-xs">
                            {(stat.profiles?.display_name || stat.fill_in_player_name || "?").charAt(0)}
                          </AvatarFallback>
                        </Avatar>
                      ) : null}
                      <span className="font-medium">
                        {stat.fill_in_player_name || stat.profiles?.display_name || "Unknown"}
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className={`text-center font-mono ${stat.goals_scored > 0 ? 'font-bold text-primary' : ''}`}>
                    {stat.goals_scored || 0}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    {formatMinutes(stat.minutes_played)}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell">
                    <div className="flex flex-wrap gap-1">
                      {stat.position_minutes && Object.keys(stat.position_minutes).length > 0 ? (
                        Object.entries(stat.position_minutes)
                          .sort(([, a], [, b]) => (b as number) - (a as number))
                          .map(([pos, secs]) => (
                            <span
                              key={pos}
                              className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted"
                            >
                              {pos}: {formatMinutes(secs as number)}
                            </span>
                          ))
                      ) : (
                        stat.positions_played.map((pos) => (
                          <span
                            key={pos}
                            className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-muted"
                          >
                            {pos}
                          </span>
                        ))
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center hidden sm:table-cell">
                    {stat.substitutions_count}
                  </TableCell>
                  <TableCell className="text-center font-mono">{honoursFor(stat).captain}</TableCell>
                  <TableCell className="text-center font-mono">{honoursFor(stat).pom}</TableCell>
                  <TableCell className="text-center font-mono hidden sm:table-cell">
                    {Math.max(honoursFor(stat).gkMatches, honoursFor(stat).gkAppointed)}
                  </TableCell>
                  <TableCell className="text-center font-mono hidden sm:table-cell">
                    {formatMinutes(honoursFor(stat).gkSeconds)}
                  </TableCell>
                  {dateRange ? (
                    <>
                      <TableCell className="text-center font-mono">{stat.games_played ?? 1}</TableCell>
                      <TableCell className="text-center font-mono">
                        {stat.starts_count ?? (stat.started_on_pitch ? 1 : 0)}
                      </TableCell>
                    </>
                  ) : (
                    <TableCell className="text-center hidden sm:table-cell">
                      {stat.started_on_pitch ? "✓" : "-"}
                    </TableCell>
                  )}

                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
        )}
      </CardContent>
    </Card>
  );
}
