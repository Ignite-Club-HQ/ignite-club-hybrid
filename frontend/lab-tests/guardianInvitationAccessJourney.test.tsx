import { describe, expect, test } from 'vitest';

/**
 * Synthetic local equivalent of the exported Postgres/RLS journey test
 * `local journey: guardian invitation, access and removal` (the real
 * fixture-backed journey requires a live local Supabase/Postgres instance
 * with the `accept_guardian_invite` / `remove_team_member` RPCs and
 * Realtime channels, all out of scope for this lab).
 *
 * This reconstructs the reducible database-access contract in-memory:
 *   - accepting a guardian invite atomically grants exactly one role +
 *     one child_guardians link, is idempotent against replay, and grants
 *     event visibility scoped to the invited team only;
 *   - removing a team member revokes select/write access for that member
 *     while leaving unrelated guardians and the child's team assignment
 *     untouched, and is itself idempotent (repeat removal reports zero
 *     additional roles removed / no additional exclusion).
 *
 * Irreducible/out-of-scope subset (documented, not ported): the Realtime
 * "postgres_changes" channel delivery assertions (cold-start retry, control
 * vs. removed-member channel isolation) depend on a live local Supabase
 * Realtime server and are not reconstructed here.
 */

type PendingInvite = {
  id: string;
  role: 'parent';
  invitedUserId: string;
  clubId: string;
  teamId: string;
  childId: string;
  status: 'pending' | 'accepted';
  acceptedAt: string | null;
};

type RoleRow = { id: string; userId: string; role: 'parent'; clubId: string; teamId: string };
type GuardianLink = { childId: string; guardianId: string };
type ExclusionRow = { userId: string; teamId: string };
type EventRow = { id: string; clubId: string; teamId: string };

function createGuardianAccessModel() {
  const invites = new Map<string, PendingInvite>();
  const roles: RoleRow[] = [];
  const guardianLinks: GuardianLink[] = [];
  const exclusions: ExclusionRow[] = [];
  const childTeamAssignments = new Map<string, Set<string>>(); // childId -> teamIds
  const events: EventRow[] = [];
  let nextRoleId = 0;

  return {
    seedEvent(event: EventRow) {
      events.push(event);
    },
    assignChildToTeam(childId: string, teamId: string) {
      const set = childTeamAssignments.get(childId) ?? new Set<string>();
      set.add(teamId);
      childTeamAssignments.set(childId, set);
    },
    createInvite(invite: Omit<PendingInvite, 'status' | 'acceptedAt'>) {
      const row: PendingInvite = { ...invite, status: 'pending', acceptedAt: null };
      invites.set(row.id, row);
      return row;
    },
    acceptInvite(userId: string, inviteId: string, childId: string) {
      const invite = invites.get(inviteId);
      if (!invite || invite.invitedUserId !== userId) {
        return { error: 'Invite not found for this user' };
      }
      if (invite.status === 'accepted') {
        return { error: 'Invite already accepted' };
      }
      if (invite.childId !== childId) {
        return { error: 'Child mismatch' };
      }
      invite.status = 'accepted';
      invite.acceptedAt = new Date().toISOString();
      roles.push({
        id: `role-${nextRoleId++}`,
        userId,
        role: 'parent',
        clubId: invite.clubId,
        teamId: invite.teamId,
      });
      guardianLinks.push({ childId, guardianId: userId });
      this.assignChildToTeam(childId, invite.teamId);
      return { error: null };
    },
    // Excluded team members are permanently denied access to that team's
    // events, distinct from simply lacking a currently-active role row.
    removeTeamMember(teamId: string, userId: string) {
      const before = roles.length;
      for (let i = roles.length - 1; i >= 0; i -= 1) {
        if (roles[i].teamId === teamId && roles[i].userId === userId) roles.splice(i, 1);
      }
      const rolesRemoved = before - roles.length;
      const alreadyExcluded = exclusions.some((row) => row.teamId === teamId && row.userId === userId);
      if (!alreadyExcluded && rolesRemoved > 0) exclusions.push({ teamId, userId });
      return { rolesRemoved, exclusionAdded: !alreadyExcluded && rolesRemoved > 0 };
    },
    canSeeEvent(userId: string, eventId: string) {
      const event = events.find((e) => e.id === eventId);
      if (!event) return false;
      const excluded = exclusions.some((row) => row.teamId === event.teamId && row.userId === userId);
      if (excluded) return false;
      return roles.some((r) => r.userId === userId && r.teamId === event.teamId);
    },
    canRsvp(userId: string, eventId: string) {
      return this.canSeeEvent(userId, eventId);
    },
    rolesFor(userId: string, teamId: string) {
      return roles.filter((r) => r.userId === userId && r.teamId === teamId);
    },
    guardianLinksFor(childId: string, guardianIds: string[]) {
      return guardianLinks.filter((g) => g.childId === childId && guardianIds.includes(g.guardianId));
    },
    childTeamAssignmentCount(childId: string, teamId: string) {
      return childTeamAssignments.get(childId)?.has(teamId) ? 1 : 0;
    },
    inviteStatus(inviteId: string) {
      return invites.get(inviteId);
    },
  };
}

describe('local journey: guardian invitation, access and removal', () => {
  test('grants exact access atomically, then removes database access', () => {
    const model = createGuardianAccessModel();
    const CLUB_A = 'club-guardian-a';
    const TEAM_A = 'team-guardian-a';
    const CHILD_A = 'child-guardian-a';
    const EVENT_A = 'event-guardian-a';
    const INVITEE = 'guardian-invitee';
    const SECOND_GUARDIAN = 'second-guardian';

    model.seedEvent({ id: EVENT_A, clubId: CLUB_A, teamId: TEAM_A });

    expect(model.canSeeEvent(INVITEE, EVENT_A)).toBe(false);

    const invitation = model.createInvite({
      id: 'invite-1',
      role: 'parent',
      invitedUserId: INVITEE,
      clubId: CLUB_A,
      teamId: TEAM_A,
      childId: CHILD_A,
    });

    const accepted = model.acceptInvite(INVITEE, invitation.id, CHILD_A);
    expect(accepted.error).toBeNull();

    expect(model.inviteStatus(invitation.id)?.status).toBe('accepted');
    expect(model.inviteStatus(invitation.id)?.acceptedAt).toBeTruthy();
    expect(model.rolesFor(INVITEE, TEAM_A)).toEqual([expect.objectContaining({
      role: 'parent', clubId: CLUB_A, teamId: TEAM_A,
    })]);
    expect(model.guardianLinksFor(CHILD_A, [INVITEE])).toHaveLength(1);
    expect(model.canSeeEvent(INVITEE, EVENT_A)).toBe(true);

    // Replay is rejected and does not create a second role row.
    const repeated = model.acceptInvite(INVITEE, invitation.id, CHILD_A);
    expect(repeated.error).not.toBeNull();
    expect(model.rolesFor(INVITEE, TEAM_A)).toHaveLength(1);

    const secondInvitation = model.createInvite({
      id: 'invite-2',
      role: 'parent',
      invitedUserId: SECOND_GUARDIAN,
      clubId: CLUB_A,
      teamId: TEAM_A,
      childId: CHILD_A,
    });
    const secondAccepted = model.acceptInvite(SECOND_GUARDIAN, secondInvitation.id, CHILD_A);
    expect(secondAccepted.error).toBeNull();

    const removed = model.removeTeamMember(TEAM_A, INVITEE);
    expect(removed).toEqual({ rolesRemoved: 1, exclusionAdded: true });

    expect(model.canSeeEvent(INVITEE, EVENT_A)).toBe(false);
    expect(model.canRsvp(INVITEE, EVENT_A)).toBe(false);
    expect(model.canSeeEvent(SECOND_GUARDIAN, EVENT_A)).toBe(true);
    expect(model.childTeamAssignmentCount(CHILD_A, TEAM_A)).toBe(1);

    const secondRemoval = model.removeTeamMember(TEAM_A, SECOND_GUARDIAN);
    expect(secondRemoval).toEqual({ rolesRemoved: 1, exclusionAdded: true });

    expect(model.canSeeEvent(SECOND_GUARDIAN, EVENT_A)).toBe(false);
    expect(model.childTeamAssignmentCount(CHILD_A, TEAM_A)).toBe(1);
    expect(model.guardianLinksFor(CHILD_A, [INVITEE, SECOND_GUARDIAN])).toHaveLength(2);

    // Removing an already-excluded, role-less member again is idempotent.
    const repeatedRemoval = model.removeTeamMember(TEAM_A, INVITEE);
    expect(repeatedRemoval).toEqual({ rolesRemoved: 0, exclusionAdded: false });
  });
});
