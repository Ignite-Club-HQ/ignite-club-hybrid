import type { FeatureBackendContext } from "@/live/featureRouter";
import { getLiveTeam, getLiveTeamPitchNotify } from "@/live/features/club";
import { listLiveDuties, listLiveGroupDuties, listLiveEvents, listLiveEventGroups } from "@/live/features/events";
import { listLiveTeamRoleGrants } from "@/live/features/membership";

export async function livePitchEvent(ctx: FeatureBackendContext, teamId: string, eventId: string) {
  const group = teamId.startsWith("event-group-");
  const rows = await listLiveEvents(ctx, null, group ? null : teamId);
  return rows.find((event) => event.id === eventId) ?? null;
}

export async function livePitchRecipients(
  ctx: FeatureBackendContext, teamId: string, eventId: string | null | undefined,
  userId: string, includeSelf: boolean, honourFlags: boolean,
) {
  const ids = new Set<string>(includeSelf ? [userId] : []);
  const group = teamId.startsWith("event-group-");
  const event = eventId ? await livePitchEvent(ctx, teamId, eventId) : null;
  if (eventId && !event) throw new Error("Linked match is not in this pitch-board scope");
  let clubId: string;
  if (group) {
    if (!event) throw new Error("A match must be linked to notify its duty holders");
    clubId = event.club_id;
    const groupId = teamId.slice("event-group-".length);
    const groups = await listLiveEventGroups(ctx, event.id);
    if (!groups.some((item) => item.id === groupId)) throw new Error("Pitch-board group is not in the linked match");
    const duties = await listLiveGroupDuties(ctx, groupId);
    for (const duty of duties) {
      const id = duty.account_id[0];
      if ((duty.duty === "Referee" || duty.duty === "Subs Manager") && id) ids.add(id);
    }
  } else {
    const [team] = await getLiveTeam(ctx, teamId);
    if (!team?.club_id) throw new Error("Pitch board has no club scope");
    clubId = team.club_id;
    const [grants, flags, duties] = await Promise.all([
      listLiveTeamRoleGrants(ctx, teamId),
      honourFlags ? getLiveTeamPitchNotify(ctx, teamId) : Promise.resolve({ coach: true, team_admin: true, subs_manager: true }),
      eventId ? listLiveDuties(ctx, eventId) : Promise.resolve([]),
    ]);
    for (const grant of grants) {
      if (((grant.role === "coach" && flags.coach) || (grant.role === "team_admin" && flags.team_admin)) && grant.account_id) ids.add(grant.account_id);
    }
    if (flags.subs_manager) for (const duty of duties) {
      if (duty.duty === "Subs Manager" && duty.account_id) ids.add(duty.account_id);
    }
  }
  if (!includeSelf) ids.delete(userId);
  return { userIds: [...ids], clubId, event };
}