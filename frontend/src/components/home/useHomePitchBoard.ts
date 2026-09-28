import { useCallback, useEffect, useRef, useState } from "react";
import type { HomePitchBoardTeam } from "./HomePitchBoardRuntime";

interface HomePitchBoardMember {
  id: string;
  user_id: string;
  role: string;
  profiles: {
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface HomePitchBoardChild {
  child_id: string;
  child_name: string;
}

interface HomePitchBoardRsvp {
  user_id: string | null;
  child_id: string | null;
}

interface UseHomePitchBoardArgs {
  isAppAdmin: boolean;
  notifyProRequired: () => void;
  hasProFootballAccess: (teamId: string) => Promise<boolean>;
  loadRoster: (teamId: string) => Promise<{
    members: HomePitchBoardMember[];
    children: HomePitchBoardChild[];
  }>;
  findNearbyEvent: (teamId: string) => Promise<string | null>;
  loadGoingRsvps: (eventId: string) => Promise<HomePitchBoardRsvp[]>;
}

const STAFF_ROLES = new Set([
  "team_admin",
  "coach",
  "club_admin",
  "app_admin",
]);

export function useHomePitchBoard({
  isAppAdmin,
  notifyProRequired,
  hasProFootballAccess,
  loadRoster,
  findNearbyEvent,
  loadGoingRsvps,
}: UseHomePitchBoardArgs) {
  const [pitchBoardTeam, setPitchBoardTeam] =
    useState<HomePitchBoardTeam | null>(null);
  const [pitchBoardLoading, setPitchBoardLoading] = useState(false);
  const dependenciesRef = useRef({
    isAppAdmin,
    notifyProRequired,
    hasProFootballAccess,
    loadRoster,
    findNearbyEvent,
    loadGoingRsvps,
  });
  dependenciesRef.current = {
    isAppAdmin,
    notifyProRequired,
    hasProFootballAccess,
    loadRoster,
    findNearbyEvent,
    loadGoingRsvps,
  };

  const openPitchBoard = useCallback(
    async (teamId: string, teamName: string, readOnly = false) => {
      setPitchBoardLoading(true);
      try {
        const dependencies = dependenciesRef.current;
        const hasAccess = await dependencies.hasProFootballAccess(teamId);
        if (!hasAccess && !dependencies.isAppAdmin) {
          dependencies.notifyProRequired();
          return;
        }

        const [roster, linkedEventId] = await Promise.all([
          dependencies.loadRoster(teamId),
          dependencies.findNearbyEvent(teamId),
        ]);
        let goingChildIds: Set<string> | null = null;
        let goingAdultIds: Set<string> | null = null;
        if (linkedEventId) {
          const rsvps = await dependencies.loadGoingRsvps(linkedEventId);
          goingChildIds = new Set(
            rsvps
              .map((rsvp) => rsvp.child_id)
              .filter((id): id is string => !!id),
          );
          goingAdultIds = new Set(
            rsvps
              .map((rsvp) => rsvp.user_id)
              .filter((id): id is string => !!id),
          );
        }

        const members = roster.members.filter(
          (member) =>
            !goingAdultIds ||
            STAFF_ROLES.has(member.role) ||
            goingAdultIds.has(member.user_id),
        );
        const children = roster.children
          .filter(
            (child) =>
              !goingChildIds || goingChildIds.has(child.child_id),
          )
          .map((child): HomePitchBoardMember => ({
            id: `child-${child.child_id}`,
            user_id: child.child_id,
            role: "player",
            profiles: {
              display_name: child.child_name,
              avatar_url: null,
            },
          }));

        setPitchBoardTeam({
          id: teamId,
          name: teamName,
          members: [...members, ...children],
          readOnly,
          linkedEventId,
        });
      } finally {
        setPitchBoardLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const handleOpenPitchBoard = () => {
      try {
        const timerStateRaw = localStorage.getItem("pitch-board-timer-state");
        if (!timerStateRaw) return;
        const timerState = JSON.parse(timerStateRaw);
        if (timerState?.teamId && timerState?.teamName) {
          void openPitchBoard(timerState.teamId, timerState.teamName, false);
        }
      } catch {
        // Invalid or unavailable persisted state is ignored.
      }
    };
    window.addEventListener("open-pitch-board", handleOpenPitchBoard);
    return () =>
      window.removeEventListener("open-pitch-board", handleOpenPitchBoard);
  }, [openPitchBoard]);

  useEffect(() => {
    let cancelled = false;
    const tryRestore = () => {
      if (cancelled || pitchBoardTeam) return;
      try {
        if (localStorage.getItem("ignite-pitch-board-open") !== "true") return;
        const storedPath = localStorage.getItem("ignite-pitch-board-open-path");
        const isHomePath =
          !storedPath ||
          storedPath === "/" ||
          storedPath === "/home" ||
          storedPath.startsWith("/?") ||
          storedPath.startsWith("/home?");
        if (!isHomePath) return;

        const contextRaw = localStorage.getItem(
          "ignite-pitch-board-last-context",
        );
        if (!contextRaw) return;
        const context = JSON.parse(contextRaw);
        if (context?.teamId && context?.teamName) {
          void openPitchBoard(
            context.teamId,
            context.teamName,
            !!context.readOnly,
          );
        }
      } catch {
        // Invalid or unavailable persisted state is ignored.
      }
    };

    tryRestore();
    let removeListener: (() => void) | undefined;
    void (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { App } = await import("@capacitor/app");
        const handle = await App.addListener(
          "appStateChange",
          ({ isActive }) => isActive && tryRestore(),
        );
        if (cancelled) {
          void handle.remove();
        } else {
          removeListener = () => {
            void handle.remove();
          };
        }
      } catch {
        // Native lifecycle is optional on web.
      }
    })();

    const handleVisibility = () => {
      if (document.visibilityState === "visible") tryRestore();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", handleVisibility);
      removeListener?.();
    };
  }, [openPitchBoard, pitchBoardTeam]);

  return {
    pitchBoardTeam,
    pitchBoardLoading,
    openPitchBoard,
    closePitchBoard: () => setPitchBoardTeam(null),
  };
}
