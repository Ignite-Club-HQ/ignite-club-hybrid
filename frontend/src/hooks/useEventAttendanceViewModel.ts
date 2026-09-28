import { useMemo } from "react";
import { buildEventRsvpBuckets } from "@/features/events/eventRsvpBuckets";
import { resolveRsvpAudience } from "@/lib/rsvpAudience";

type UseEventAttendanceViewModelArgs = {
  event: any;
  rsvps: any[] | undefined;
  playerMembers: any[] | undefined;
  effectiveShowAll: boolean;
  isMiniLeagueEvent: boolean;
  targetTeamIdsForFetch: string[] | undefined;
  allChildrenOnTeam: any[] | undefined;
  attendanceMembers: any[] | undefined;
  attendancePlayerMembers: any[] | undefined;
  childGuardiansOnTeam: any[] | undefined;
  scopedChildNames: Map<string, string>;
  miniLeaguePlayers: any[] | undefined;
  miniLeagueAdults: any[] | undefined;
  members: any[] | undefined;
  linkedAdultProfiles: any[] | undefined;
  reminderMembers: any[] | undefined;
  eventGuests: any[] | undefined;
};

export function useEventAttendanceViewModel({
  event,
  rsvps,
  playerMembers,
  effectiveShowAll,
  isMiniLeagueEvent,
  targetTeamIdsForFetch,
  allChildrenOnTeam,
  attendanceMembers,
  attendancePlayerMembers,
  childGuardiansOnTeam,
  scopedChildNames,
  miniLeaguePlayers,
  miniLeagueAdults,
  members,
  linkedAdultProfiles,
  reminderMembers,
  eventGuests,
}: UseEventAttendanceViewModelArgs) {
  return useMemo(() => {
    const playerUserIds = new Set(playerMembers?.map((member) => member.id) || []);
    const attendanceAudience = resolveRsvpAudience(
      event?.rsvp_audience,
      event?.teams?.default_rsvp_audience,
    );
    const adultsAreTheAudience = attendanceAudience === "parents_only";
    const scopedChildIds = new Set((allChildrenOnTeam || []).map((child) => child.id));
    const scopedAdultIds = new Set((attendanceMembers || []).map((member) => member.id));

    (allChildrenOnTeam || []).forEach((child) => {
      if (child.parent_id) scopedAdultIds.add(child.parent_id);
    });
    (childGuardiansOnTeam || []).forEach((guardian) => {
      if (guardian.guardian_id) scopedAdultIds.add(guardian.guardian_id);
    });

    const isTargetedScope = !!targetTeamIdsForFetch;
    const { goingRsvps, maybeRsvps, notGoingRsvps } = buildEventRsvpBuckets({
      rsvps,
      effectiveShowAll,
      isMiniLeagueEvent,
      adultsAreTheAudience,
      playerUserIds,
      isTargetedScope,
      scopedChildIds,
      scopedAdultIds,
      scopedChildNames,
    });

    const respondedUserIds = new Set(
      rsvps?.filter((rsvp) => !rsvp.child_id).map((rsvp) => rsvp.user_id) || [],
    );
    const respondedChildIds = new Set(
      rsvps?.filter((rsvp) => rsvp.child_id).map((rsvp) => rsvp.child_id) || [],
    );
    const respondedMiniLeaguePlayerIds = new Set(
      rsvps
        ?.filter((rsvp) => rsvp.mini_league_player_id)
        .map((rsvp) => rsvp.mini_league_player_id) || [],
    );

    let notResponded: any[] = [];
    let notRespondedChildren: any[] = [];

    if (isMiniLeagueEvent && miniLeaguePlayers) {
      notRespondedChildren = miniLeaguePlayers.filter((player) => {
        if (respondedMiniLeaguePlayerIds.has(player.id)) return false;
        if (player.child_id && respondedChildIds.has(player.child_id)) return false;
        return true;
      });
      if (effectiveShowAll) {
        notResponded = (miniLeagueAdults || []).filter(
          (adult) => !respondedUserIds.has(adult.id),
        );
      }
    } else {
      const baseMembersToShow = effectiveShowAll ? attendanceMembers : attendancePlayerMembers;
      const adultPool = [...(members || []), ...(linkedAdultProfiles || [])];
      const membersToShow = effectiveShowAll
        ? [
            ...(baseMembersToShow || []),
            ...adultPool.filter(
              (member, index) =>
                scopedAdultIds.has(member.id) &&
                !(baseMembersToShow || []).some((base) => base.id === member.id) &&
                adultPool.findIndex((adult) => adult.id === member.id) === index,
            ),
          ]
        : baseMembersToShow;

      const parentIdsWithRespondedChildren = new Set<string>();
      if (attendanceAudience === "players_only") {
        (allChildrenOnTeam || []).forEach((child) => {
          if (child.parent_id && respondedChildIds.has(child.id)) {
            parentIdsWithRespondedChildren.add(child.parent_id);
          }
        });
        (childGuardiansOnTeam || []).forEach((guardian) => {
          if (guardian.guardian_id && respondedChildIds.has(guardian.child_id)) {
            parentIdsWithRespondedChildren.add(guardian.guardian_id);
          }
        });
      }
      notResponded = membersToShow?.filter(
        (member) =>
          !respondedUserIds.has(member.id) &&
          !parentIdsWithRespondedChildren.has(member.id),
      ) || [];
      notRespondedChildren = allChildrenOnTeam?.filter(
        (child) => !respondedChildIds.has(child.id),
      ) || [];
    }

    const respondedChildGuardianIds = new Set<string>([
      ...(allChildrenOnTeam || [])
        .filter((child) => respondedChildIds.has(child.id))
        .map((child) => child.parent_id)
        .filter(Boolean),
      ...(childGuardiansOnTeam || [])
        .filter((guardian) => respondedChildIds.has(guardian.child_id))
        .map((guardian) => guardian.guardian_id)
        .filter(Boolean),
    ]);

    const allNotRespondedForReminders = isMiniLeagueEvent
      ? (miniLeagueAdults || []).filter((adult) => !respondedUserIds.has(adult.id))
      : reminderMembers?.filter(
          (member) =>
            !respondedUserIds.has(member.id) &&
            !respondedChildGuardianIds.has(member.id),
        ) || [];

    const restrictedRoles = event?.restricted_to_roles as string[] | null | undefined;
    const addressableMembers = isMiniLeagueEvent
      ? miniLeagueAdults ?? []
      : restrictedRoles?.length
        ? (members ?? []).filter((member) =>
            (member.roles ?? []).some(
              (role: string) =>
                restrictedRoles.includes(role) ||
                role === "club_admin" ||
                role === "app_admin",
            ),
          )
        : members;

    return {
      goingRsvps,
      maybeRsvps,
      notGoingRsvps,
      notResponded,
      notRespondedChildren,
      totalNotResponded: notResponded.length + notRespondedChildren.length,
      allNotRespondedForReminders,
      isTargetedScope,
      goingTotal: goingRsvps.length + (eventGuests?.length || 0),
      trackableMembers: members?.length || 0,
      addressableMembers,
    };
  }, [
    event,
    rsvps,
    playerMembers,
    effectiveShowAll,
    isMiniLeagueEvent,
    targetTeamIdsForFetch,
    allChildrenOnTeam,
    attendanceMembers,
    attendancePlayerMembers,
    childGuardiansOnTeam,
    scopedChildNames,
    miniLeaguePlayers,
    miniLeagueAdults,
    members,
    linkedAdultProfiles,
    reminderMembers,
    eventGuests,
  ]);
}
