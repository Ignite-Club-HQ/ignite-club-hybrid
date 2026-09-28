import { AdminRsvpChanger } from "@/components/event/AdminRsvpChanger";
import { AttendanceRow } from "@/components/event/AttendanceRow";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, DollarSign, Hand, Loader2, Shield, Trophy } from "lucide-react";

export type EventRsvpStatus = "going" | "maybe" | "not_going";

interface EventRoleMember {
  roles?: string[];
  role_team_pairs?: { role: string; team_id: string | null }[];
}

interface EventRoleScope {
  team_id?: string | null;
  target_team_ids?: string[] | null;
}

interface EventAttendeeRsvp {
  child_id?: string | null;
  mini_league_player_id?: string | null;
  mini_league_players?: { name?: string | null } | null;
  children?: { name?: string | null } | null;
  profiles?: { display_name?: string | null; avatar_url?: string | null } | null;
  notes?: string | null;
}

const ROLE_LABEL_PRIORITY = [
  "club_admin",
  "association_admin",
  "committee_member",
  "team_admin",
  "coach",
  "league_admin",
  "competition_admin",
  "parent",
  "player",
  "basic_user",
];

const pickRoleByPriority = (roles: string[]): string | undefined => {
  if (roles.length === 0) return undefined;
  for (const role of ROLE_LABEL_PRIORITY) if (roles.includes(role)) return role;
  return roles[0];
};

export function resolveEventAttendeeRoleLabel(
  member: EventRoleMember | undefined,
  event: EventRoleScope | undefined,
): string | undefined {
  if (!member) return undefined;
  const pairs = member.role_team_pairs ?? [];
  const scopeTeams = event?.team_id
    ? [event.team_id]
    : event?.target_team_ids?.length
      ? event.target_team_ids
      : null;

  if (scopeTeams) {
    const scoped = pairs
      .filter((pair) => pair.team_id && scopeTeams.includes(pair.team_id))
      .map((pair) => pair.role);
    const inScope = pickRoleByPriority(scoped);
    if (inScope) return inScope;

    const clubRole = pickRoleByPriority(
      pairs.filter((pair) => !pair.team_id).map((pair) => pair.role),
    );
    if (clubRole) return clubRole;
    if (pairs.length === 0) return pickRoleByPriority(member.roles ?? []);
    return undefined;
  }

  return pickRoleByPriority(member.roles ?? pairs.map((pair) => pair.role));
}

interface EventAttendeeCardProps {
  rsvp: EventAttendeeRsvp;
  hasPaid?: boolean;
  isAdmin?: boolean;
  showPrice?: boolean;
  onTogglePayment?: () => void;
  isPending?: boolean;
  isMiniLeague?: boolean;
  onChangeStatus?: (status: EventRsvpStatus) => void;
  currentStatus?: EventRsvpStatus;
  memberRole?: string;
  isCaptain?: boolean;
  isPotm?: boolean;
  isGoalkeeper?: boolean;
}

export function EventAttendeeCard({
  rsvp,
  hasPaid,
  isAdmin,
  showPrice,
  onTogglePayment,
  isPending,
  isMiniLeague,
  onChangeStatus,
  currentStatus,
  memberRole,
  isCaptain,
  isPotm,
  isGoalkeeper,
}: EventAttendeeCardProps) {
  const isChildRsvp = !!rsvp.child_id;
  const isMiniLeaguePlayerRsvp = !!rsvp.mini_league_player_id;
  const displayName = isMiniLeaguePlayerRsvp
    ? rsvp.mini_league_players?.name
    : isChildRsvp
      ? rsvp.children?.name
      : rsvp.profiles?.display_name;
  const avatarInitial = displayName?.charAt(0)?.toUpperCase() || "?";

  const matchIcons = (isCaptain || isPotm || isGoalkeeper) ? (
    <span className="inline-flex items-center gap-1 shrink-0">
      {isCaptain && (
        <span title="Captain" className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-blue-500/15 text-blue-600 dark:text-blue-400">
          <Shield className="h-3 w-3" />
        </span>
      )}
      {isGoalkeeper && (
        <span title="Goalkeeper" className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
          <Hand className="h-3 w-3" />
        </span>
      )}
      {isPotm && (
        <span title="Player of the Match" className="inline-flex items-center justify-center h-5 w-5 rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400">
          <Trophy className="h-3 w-3" />
        </span>
      )}
    </span>
  ) : null;

  return (
    <AttendanceRow
      name={displayName || "Unknown"}
      avatarUrl={!isChildRsvp && !isMiniLeaguePlayerRsvp ? rsvp.profiles?.avatar_url || null : null}
      avatarFallback={avatarInitial}
      roleLabel={
        isChildRsvp && !isMiniLeague
          ? "Child"
          : !isChildRsvp && !isMiniLeaguePlayerRsvp && memberRole
            ? memberRole.replace(/_/g, " ")
            : null
      }
      roleTone={isChildRsvp && !isMiniLeague ? "child" : "neutral"}
      secondaryLine={rsvp.notes || null}
      rightSlot={
        <>
          {matchIcons}
          {showPrice && hasPaid && (
            <Badge variant="default" className="text-[10px] h-5 px-1.5 bg-primary shrink-0">
              <Check className="h-3 w-3 mr-0.5" />
              Paid
            </Badge>
          )}
          {isAdmin && onChangeStatus && currentStatus && (
            <AdminRsvpChanger
              currentStatus={currentStatus}
              playerName={displayName || "Unknown"}
              onChangeStatus={onChangeStatus}
              isPending={isPending}
            />
          )}
          {isAdmin && showPrice && onTogglePayment && (
            <Button
              variant={hasPaid ? "secondary" : "outline"}
              size="sm"
              onClick={onTogglePayment}
              disabled={isPending}
              className="h-8 px-2 shrink-0"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : hasPaid ? (
                <Check className="h-4 w-4" />
              ) : (
                <>
                  <DollarSign className="h-4 w-4 mr-1" />
                  <span className="text-xs">Mark Paid</span>
                </>
              )}
            </Button>
          )}
        </>
      }
    />
  );
}
