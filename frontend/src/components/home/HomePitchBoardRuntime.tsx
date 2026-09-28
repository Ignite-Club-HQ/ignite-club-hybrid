import { Suspense } from "react";
import { createPortal } from "react-dom";
import { Flame, Loader2 } from "lucide-react";
import SoccerBall from "@/components/pitch/SoccerBall";
import { clearPitchBoardOpenFlag } from "@/components/pitch/pitchBoardOpenFlag";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));
const GameTimerWidget = lazyWithRetry(() =>
  import("@/components/pitch/GameTimerWidget"),
);
const QuickRSVPDialog = lazyWithRetry(() =>
  import("@/components/QuickRSVPDialog").then((module) => ({
    default: module.QuickRSVPDialog,
  })),
);

interface PitchBoardMember {
  id: string;
  user_id: string;
  role: string;
  profiles: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

export interface HomePitchBoardTeam {
  id: string;
  name: string;
  members: PitchBoardMember[];
  readOnly: boolean;
  linkedEventId?: string | null;
}

export interface HomeQuickRsvpEvent {
  id: string;
  title: string;
  event_date: string;
  type: "game" | "training" | "social";
  team_id: string | null;
  suburb: string | null;
  opponent: string | null;
  club_id: string;
  clubs: { name: string };
  amount: number | null;
}

interface HomePitchBoardRuntimeProps {
  loading: boolean;
  pitchBoardTeam: HomePitchBoardTeam | null;
  quickRsvpEvent: HomeQuickRsvpEvent | null;
  onClosePitchBoard: () => void;
  onCloseQuickRsvp: () => void;
}

function PitchBoardLoadingOverlay() {
  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center"
      role="status"
      aria-label="Loading Pitch Board"
      style={{ backgroundColor: "#2d5a27" }}
    >
      <div className="flex flex-col items-center gap-4">
        <div className="flex items-center gap-3">
          <div className="p-3 rounded-xl bg-primary">
            <Flame className="h-8 w-8 text-primary-foreground" />
          </div>
          <div className="animate-bounce">
            <SoccerBall size={48} readOnly />
          </div>
        </div>
        <Loader2 className="h-6 w-6 animate-spin text-white" />
        <p className="text-lg font-medium text-white">Loading Pitch Board...</p>
      </div>
    </div>,
    document.body,
  );
}

export function HomePitchBoardRuntime({
  loading,
  pitchBoardTeam,
  quickRsvpEvent,
  onClosePitchBoard,
  onCloseQuickRsvp,
}: HomePitchBoardRuntimeProps) {
  return (
    <>
      {loading && <PitchBoardLoadingOverlay />}
      {pitchBoardTeam && (
        <Suspense fallback={<PitchBoardLoadingOverlay />}>
          <PitchBoard
            teamId={pitchBoardTeam.id}
            teamName={pitchBoardTeam.name}
            members={pitchBoardTeam.members}
            onClose={() => {
              clearPitchBoardOpenFlag();
              onClosePitchBoard();
            }}
            readOnly={pitchBoardTeam.readOnly}
            initialLinkedEventId={pitchBoardTeam.linkedEventId}
          />
        </Suspense>
      )}
      {quickRsvpEvent && (
        <Suspense fallback={null}>
          <QuickRSVPDialog
            open
            onOpenChange={(open) => !open && onCloseQuickRsvp()}
            eventId={quickRsvpEvent.id}
            eventTitle={quickRsvpEvent.title}
            eventDate={quickRsvpEvent.event_date}
            eventType={quickRsvpEvent.type}
            teamId={quickRsvpEvent.team_id}
            suburb={quickRsvpEvent.suburb}
            opponent={quickRsvpEvent.opponent}
            clubId={quickRsvpEvent.club_id}
            clubName={quickRsvpEvent.clubs?.name || "Your club"}
            eventAmount={quickRsvpEvent.amount}
          />
        </Suspense>
      )}
    </>
  );
}

interface HomeGameTimerRuntimeProps {
  userRoles: Array<{ role: string; team_id?: string | null; club_id?: string | null }> | undefined;
  isAppAdmin: boolean;
  editableTeams: Array<{ id: string; name: string; club_id: string }> | undefined;
  readOnlyTeams: Array<{ id: string; name: string; club_id: string }> | undefined;
  onOpenPitchBoard: (
    teamId: string,
    teamName: string,
    readOnly: boolean,
  ) => void;
}

export function resolveHomeGameTimerAccess({
  timerTeamId,
  userRoles,
  isAppAdmin,
  editableTeams,
  readOnlyTeams,
}: Omit<HomeGameTimerRuntimeProps, "onOpenPitchBoard"> & {
  timerTeamId: string;
}) {
  const isTeamMember = userRoles?.some(
    (role) => role.team_id === timerTeamId,
  );
  const timerTeam =
    editableTeams?.find((team) => team.id === timerTeamId) ||
    readOnlyTeams?.find((team) => team.id === timerTeamId);
  const isClubAdminOfTeam =
    timerTeam &&
    userRoles?.some(
      (role) =>
        role.role === "club_admin" && role.club_id === timerTeam.club_id,
    );
  const canView = !!(isAppAdmin || isTeamMember || isClubAdminOfTeam);
  const canEdit = !!(
    isAppAdmin ||
    isClubAdminOfTeam ||
    userRoles?.some(
      (role) =>
        role.team_id === timerTeamId &&
        (role.role === "coach" || role.role === "team_admin"),
    )
  );
  return { canView, canEdit };
}

export function HomeGameTimerRuntime({
  userRoles,
  isAppAdmin,
  editableTeams,
  readOnlyTeams,
  onOpenPitchBoard,
}: HomeGameTimerRuntimeProps) {
  const timerStateRaw =
    typeof window !== "undefined"
      ? localStorage.getItem("pitch-board-timer-state")
      : null;
  if (!timerStateRaw) return null;

  let timerTeamId: string | null = null;
  try {
    timerTeamId = JSON.parse(timerStateRaw).teamId;
  } catch {
    return null;
  }
  if (!timerTeamId) return null;

  const access = resolveHomeGameTimerAccess({
    timerTeamId,
    userRoles,
    isAppAdmin,
    editableTeams,
    readOnlyTeams,
  });
  if (!access.canView) return null;

  return (
    <Suspense fallback={null}>
      <GameTimerWidget
        onOpenPitchBoard={(teamId, teamName) =>
          onOpenPitchBoard(teamId, teamName, !access.canEdit)
        }
        readOnly={!access.canEdit}
      />
    </Suspense>
  );
}
