import { PlayCircle, Shirt, X } from "lucide-react";

import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const TEAM_A_FALLBACK_COLOR = "#ef4444";
const TEAM_B_FALLBACK_COLOR = "#3b82f6";

export interface GroupPlayer {
  id: string;
  name: string;
  team: "a" | "b" | null;
  ability_rating: number;
}

export interface EventGroup {
  id: string;
  name: string;
  ability_band: string | null;
  pitch_name: string | null;
  display_order: number;
  team_a_color: string;
  team_b_color: string;
  players: GroupPlayer[];
}

export interface EventGroupDuty {
  id: string;
  name: string;
  assigned_to: string | null;
  assignee?: {
    display_name?: string | null;
  } | null;
}

export interface SwapSource {
  groupId: string;
  playerId: string;
  team: "a" | "b" | null;
}

interface EventGroupCardProps {
  group: EventGroup;
  isAdmin: boolean;
  swapSource: SwapSource | null;
  duties: EventGroupDuty[];
  boardSupported: boolean;
  onDeleteGroup: (groupId: string) => void;
  onPlayerTap: (groupId: string, playerId: string, team: "a" | "b" | null) => void;
  onTeamTap: (groupId: string, team: "a" | "b") => void;
  onQuickAssignDuty: (dutyId: string, group: EventGroup) => void;
  onOpenPitchBoard: (group: EventGroup) => void;
}

function isLightColor(hex: string): boolean {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luminance > 0.6;
}

interface TeamSectionProps {
  label: string;
  team: "a" | "b";
  color: string;
  players: GroupPlayer[];
  isAdmin: boolean;
  swapSource: SwapSource | null;
  groupId: string;
  onPlayerTap: EventGroupCardProps["onPlayerTap"];
  onTeamTap: EventGroupCardProps["onTeamTap"];
}

function TeamSection({ label, team, color, players, isAdmin, swapSource, groupId, onPlayerTap, onTeamTap }: TeamSectionProps) {
  const useDarkText = isLightColor(color);
  const textColor = useDarkText ? "#1f2937" : "#ffffff";
  const countColor = useDarkText ? "#1f293799" : "#ffffffb3";
  const selectedPlayerId = swapSource?.groupId === groupId ? swapSource.playerId : null;

  return (
    <div
      className={`rounded-lg overflow-hidden ${swapSource && isAdmin ? "cursor-pointer ring-2 ring-primary/30 hover:ring-primary" : ""}`}
      onClick={() => swapSource && onTeamTap(groupId, team)}
    >
      <div className="flex items-center gap-1.5 px-2.5 py-1.5" style={{ backgroundColor: color }}>
        <Shirt className="h-3.5 w-3.5" style={{ color: textColor }} />
        <span className="text-xs font-bold" style={{ color: textColor }}>
          {label}
        </span>
        <span className="text-xs" style={{ color: countColor }}>
          ({players.length})
        </span>
      </div>
      <div className="p-2 border border-t-0 rounded-b-lg space-y-0.5" style={{ borderColor: `${color}40` }}>
        {players.map((player) => (
          <div
            key={player.id}
            onClick={(event) => {
              event.stopPropagation();
              onPlayerTap(groupId, player.id, team);
            }}
            className={`text-xs px-2 py-1 rounded transition-all ${
              isAdmin ? "cursor-pointer hover:bg-accent" : ""
            } ${
              selectedPlayerId === player.id ? "bg-primary/20 ring-1 ring-primary font-medium" : ""
            }`}
          >
            {player.name}
          </div>
        ))}
        {players.length === 0 && <span className="text-xs text-muted-foreground px-2">No players</span>}
      </div>
    </div>
  );
}

export function EventGroupCard({
  group,
  isAdmin,
  swapSource,
  duties,
  boardSupported,
  onDeleteGroup,
  onPlayerTap,
  onTeamTap,
  onQuickAssignDuty,
  onOpenPitchBoard,
}: EventGroupCardProps) {
  const teamAPlayers = group.players.filter((player) => player.team === "a");
  const teamBPlayers = group.players.filter((player) => player.team === "b");
  const unassignedPlayers = group.players.filter((player) => !player.team);
  const teamAColor = group.team_a_color || TEAM_A_FALLBACK_COLOR;
  const teamBColor = group.team_b_color || TEAM_B_FALLBACK_COLOR;

  return (
    <Card className="relative">
      {isAdmin && (
        <Button
          variant="ghost"
          size="icon"
          className="absolute top-2 right-2 h-6 w-6 text-muted-foreground hover:text-destructive"
          onClick={() => onDeleteGroup(group.id)}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <CardTitle className="text-base">{group.name}</CardTitle>
          {group.ability_band && (
            <Badge variant="outline" className="text-xs gap-1">
              <span className="text-muted-foreground">Ability:</span> {group.ability_band}
            </Badge>
          )}
        </div>
        {group.pitch_name && <CardDescription>{group.pitch_name}</CardDescription>}
      </CardHeader>
      <CardContent className="pt-0">
        <div className="grid grid-cols-2 gap-2 mb-3">
          <TeamSection
            label="Team A"
            team="a"
            color={teamAColor}
            players={teamAPlayers}
            isAdmin={isAdmin}
            swapSource={swapSource}
            groupId={group.id}
            onPlayerTap={onPlayerTap}
            onTeamTap={onTeamTap}
          />
          <TeamSection
            label="Team B"
            team="b"
            color={teamBColor}
            players={teamBPlayers}
            isAdmin={isAdmin}
            swapSource={swapSource}
            groupId={group.id}
            onPlayerTap={onPlayerTap}
            onTeamTap={onTeamTap}
          />
        </div>

        {unassignedPlayers.length > 0 && (
          <div className="mb-3 p-2 rounded-lg bg-muted/50">
            <span className="text-xs text-muted-foreground">Unassigned: </span>
            {unassignedPlayers.map((player) => (
              <Badge key={player.id} variant="outline" className="text-xs ml-1">
                {player.name}
              </Badge>
            ))}
          </div>
        )}

        {duties.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {duties.map((duty) => (
              <button
                key={duty.id}
                type="button"
                onClick={() => onQuickAssignDuty(duty.id, group)}
                className={cn(
                  "inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-colors touch-manipulation",
                  duty.assigned_to
                    ? "bg-primary/10 text-primary border border-primary/20"
                    : "bg-muted text-muted-foreground border border-border hover:border-primary/50",
                )}
              >
                <span
                  className={cn(
                    "w-1.5 h-1.5 rounded-full shrink-0",
                    duty.assigned_to ? "bg-primary" : "bg-muted-foreground",
                  )}
                />
                {duty.name}
                {duty.assignee?.display_name ? `: ${duty.assignee.display_name}` : ""}
              </button>
            ))}
          </div>
        )}

        {boardSupported && (
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="flex-1" onClick={() => onOpenPitchBoard(group)}>
              <PlayCircle className="h-4 w-4 mr-1" />
              Pitch Board
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
