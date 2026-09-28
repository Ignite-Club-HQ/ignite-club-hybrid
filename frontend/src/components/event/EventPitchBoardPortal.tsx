import { Suspense } from "react";
import { createPortal } from "react-dom";
import { Flame, Loader2 } from "lucide-react";
import { clearPitchBoardOpenFlag } from "@/components/pitch/pitchBoardOpenFlag";
import { defaultMinutesPerHalfForTeamName } from "@/lib/teamAgeDefaults";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const PitchBoard = lazyWithRetry(() => import("@/components/pitch/PitchBoard"));

type EventPitchBoardPortalProps = {
  open: boolean;
  event: any;
  eventId: string | undefined;
  teamMembers: any[] | undefined;
  teamSubscription: any;
  isSoccerClub: boolean;
  accessGranted: boolean;
  canViewReadOnly: boolean;
  isSubsManager: boolean;
  setOpen: (open: boolean) => void;
};

export function EventPitchBoardPortal({
  open,
  event,
  eventId,
  teamMembers,
  teamSubscription,
  isSoccerClub,
  accessGranted,
  canViewReadOnly,
  isSubsManager,
  setOpen,
}: EventPitchBoardPortalProps) {
  if (!open || !isSoccerClub || !accessGranted || !teamMembers || !event?.team_id) {
    return null;
  }

  const close = () => {
    setOpen(false);
    clearPitchBoardOpenFlag();
  };

  return createPortal(
    <Suspense
      fallback={
        <div
          className="fixed inset-0 top-0 left-0 right-0 bottom-0 w-screen h-screen flex items-center justify-center"
          style={{ backgroundColor: "#2d5a27", zIndex: 999999 }}
        >
          <div className="flex flex-col items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="p-3 rounded-xl bg-primary">
                <Flame className="h-8 w-8 text-primary-foreground" />
              </div>
              <span className="text-4xl">⚽</span>
            </div>
            <Loader2 className="h-6 w-6 animate-spin text-white" />
            <p className="text-sm text-white/80">Loading pitch board...</p>
          </div>
        </div>
      }
    >
      <PitchBoard
        teamId={event.team_id}
        teamName={event.teams?.name || "Team"}
        members={teamMembers.map((member) => ({
          id: member.user_id,
          user_id: member.user_id,
          role: member.role,
          profiles: member.profiles,
        }))}
        onClose={close}
        disableAutoSubs={teamSubscription?.disable_auto_subs || false}
        initialRotationSpeed={teamSubscription?.rotation_speed || 1}
        initialDisablePositionSwaps={teamSubscription?.disable_position_swaps || false}
        initialDisableBatchSubs={teamSubscription?.disable_batch_subs || false}
        initialRotateGkAtHalftime={teamSubscription?.rotate_gk_at_halftime ?? true}
        initialMinutesPerHalf={
          teamSubscription?.minutes_per_half ||
          defaultMinutesPerHalfForTeamName(event.teams?.name)
        }
        initialMaxSpreadMinutes={teamSubscription?.max_spread_minutes ?? 5}
        initialTeamSize={teamSubscription?.team_size}
        initialFormation={teamSubscription?.formation || undefined}
        initialLinkedEventId={eventId}
        initialShowMatchHeader={teamSubscription?.show_match_header ?? true}
        initialShowLineupPicker={teamSubscription?.show_lineup_picker || false}
        readOnly={!!canViewReadOnly && !isSubsManager}
        isSubsManager={isSubsManager}
      />
    </Suspense>,
    document.body,
  );
}
