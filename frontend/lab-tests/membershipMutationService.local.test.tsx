/**
 * Local, synthetic-mock-client port of all 101 exported
 * `src/features/membership/membershipMutationService.test.ts` cases,
 * against `src/lab/membership/membershipMutationService.local.ts` - a
 * line-for-line behavioral port of the exported service module. This
 * replaces the prior 1-case placeholder stub that used to occupy this
 * file path.
 *
 * Every mock-client helper below mirrors the bundle's own ad-hoc mock
 * shapes (`insertClient`, `placementClient`, `secondParentClient`,
 * `pendingInviteClient`, `bulkDeliveryClient`, etc.) so each ported case
 * preserves its original assertion intent (exact insert/update payload
 * shape, error-classification branch, and orchestration call order), not
 * merely a superficial text check.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  addBulkSelectedSecondGuardian,
  addExistingSecondParent,
  assignBulkExistingTeamRole,
  assignExistingTeamRole,
  buildExistingParentTeamEmailRequest,
  buildPendingTeamInviteEmailRequest,
  completeBulkExistingMember,
  createBulkPendingTeamInvite,
  createChildForParentOnTeam,
  createPendingSecondParentInvite,
  createPendingTeamInvite,
  deliverBulkPendingInviteEmail,
  ensureBulkChildTeamAssignmentBestEffort,
  ensureChildTeamAssignment,
  inviteBulkPendingSecondGuardian,
  isDuplicateMembershipError,
  linkGuardianToExistingChild,
  notifyExistingTeamMember,
  persistChildJerseyPosition,
  processBulkExistingParentChildren,
  processBulkExistingRecipient,
  processBulkPendingRecipient,
  processExistingParentChildren,
  recordPendingInviteEmailDelivery,
  sendExistingParentTeamEmail,
  sendPendingTeamInviteEmail,
  type LocalMembershipClient,
} from '../src/lab/membership/membershipMutationService.local';

function insertClient(error: unknown = null) {
  const insert = vi.fn(async () => ({ data: null, error }));
  const from = vi.fn(() => ({ insert }));
  return { client: { from } as LocalMembershipClient, from, insert };
}

describe('existing team-role mutation service', () => {
  it('inserts the exact user, team, club and role scope', async () => {
    const { client, from, insert } = insertClient();
    await expect(
      assignExistingTeamRole({ userId: 'user-a', teamId: 'team-a', clubId: 'club-a', role: 'coach' }, client),
    ).resolves.toEqual({ roleWasDuplicate: false });
    expect(from).toHaveBeenCalledWith('user_roles');
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-a', team_id: 'team-a', club_id: 'club-a', role: 'coach' });
  });

  it('treats PostgreSQL unique-violation code as idempotent success', async () => {
    const { client } = insertClient({ code: '23505', message: 'conflict' });
    await expect(
      assignExistingTeamRole({ userId: 'user-a', teamId: 'team-a', clubId: 'club-a', role: 'parent' }, client),
    ).resolves.toEqual({ roleWasDuplicate: true });
  });

  it.each(['duplicate key value violates constraint', 'UNIQUE CONSTRAINT failed'])(
    'preserves the existing duplicate-message fallback: %s',
    (message) => {
      expect(isDuplicateMembershipError({ message })).toBe(true);
    },
  );

  it('rethrows the original non-duplicate write error', async () => {
    const error = { code: '42501', message: 'permission denied' };
    const { client } = insertClient(error);
    await expect(
      assignExistingTeamRole({ userId: 'user-a', teamId: 'team-a', clubId: 'club-a', role: 'team_admin' }, client),
    ).rejects.toBe(error);
  });

  it('does not classify absent or unrelated errors as duplicates', () => {
    expect(isDuplicateMembershipError(null)).toBe(false);
    expect(isDuplicateMembershipError({ code: '23503', message: 'foreign key' })).toBe(false);
  });
});

describe('bulk existing-user team-role assignment', () => {
  const assignment = { userId: 'user-a', teamId: 'team-a', clubId: 'club-a', role: 'coach' as const };

  it('returns an assigned outcome for the exact successful role write', async () => {
    const { client, from, insert } = insertClient();
    await expect(assignBulkExistingTeamRole(assignment, client)).resolves.toEqual({
      assigned: true,
      roleWasDuplicate: false,
      error: null,
    });
    expect(from).toHaveBeenCalledWith('user_roles');
    expect(insert).toHaveBeenCalledWith({ user_id: 'user-a', team_id: 'team-a', club_id: 'club-a', role: 'coach' });
  });

  it.each([{ code: '23505', message: 'conflict' }, { message: 'duplicate membership' }, { message: 'UNIQUE CONSTRAINT failed' }])(
    'preserves duplicate role idempotency: %j',
    async (duplicateError) => {
      const { client } = insertClient(duplicateError);
      await expect(assignBulkExistingTeamRole(assignment, client)).resolves.toEqual({
        assigned: true,
        roleWasDuplicate: true,
        error: null,
      });
    },
  );

  it('returns the original non-duplicate error so only that recipient is skipped', async () => {
    const error = { code: '42501', message: 'role denied' };
    const { client } = insertClient(error);
    await expect(assignBulkExistingTeamRole(assignment, client)).resolves.toEqual({
      assigned: false,
      roleWasDuplicate: false,
      error,
    });
  });
});

describe('bulk existing-parent child processing', () => {
  function operations(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    return {
      calls,
      value: {
        linkGuardian: vi.fn(async () => {
          calls.push('guardian');
          return { status: 'linked' as const };
        }),
        createChild: vi.fn(async () => {
          calls.push('create');
          return 'child-new';
        }),
        ensureAssignment: vi.fn(async () => {
          calls.push('assignment');
          return 'insert-attempted' as const;
        }),
        ...overrides,
      },
    };
  }

  const base = {
    parentUserId: 'parent-a',
    teamId: 'team-a',
    clubChildren: [{ id: 'child-existing', parent_id: 'parent-b', year_of_birth: 2016 }],
  };

  it('links and assigns an existing child in sequence', async () => {
    const { value, calls } = operations();
    await expect(
      processBulkExistingParentChildren(
        { ...base, children: [{ name: ' Existing ', yearOfBirth: '', jerseyNumber: '', existingChildId: 'child-existing' }] },
        value as any,
      ),
    ).resolves.toEqual([{ childName: 'Existing', childId: 'child-existing', status: 'processed', error: null }]);
    expect(calls).toEqual(['guardian', 'assignment']);
    expect(value.createChild).not.toHaveBeenCalled();
  });

  it('creates and assigns a new child in sequence', async () => {
    const { value, calls } = operations();
    await processBulkExistingParentChildren(
      { ...base, children: [{ name: ' New ', yearOfBirth: '2017', jerseyNumber: '' }] },
      value as any,
    );
    expect(calls).toEqual(['create', 'assignment']);
    expect(value.createChild).toHaveBeenCalledWith({ parentUserId: 'parent-a', teamId: 'team-a', name: ' New ', yearOfBirth: '2017' });
  });

  it('skips pending-invite children without any writes', async () => {
    const { value, calls } = operations();
    await expect(
      processBulkExistingParentChildren(
        { ...base, children: [{ name: 'Pending', yearOfBirth: '', jerseyNumber: '', pendingInviteId: 'invite-a' }] },
        value as any,
      ),
    ).resolves.toEqual([{ childName: 'Pending', childId: null, status: 'pending-skipped', error: null }]);
    expect(calls).toEqual([]);
  });

  it('records a creation failure and continues with the next child', async () => {
    const failure = { code: '42501', message: 'create denied' };
    let attempts = 0;
    const { value } = operations({
      createChild: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw failure;
        return 'child-second';
      }),
    });
    const result = await processBulkExistingParentChildren(
      { ...base, children: [{ name: 'First', yearOfBirth: '', jerseyNumber: '' }, { name: 'Second', yearOfBirth: '', jerseyNumber: '' }] },
      value as any,
    );
    expect(result[0]).toEqual({ childName: 'First', childId: null, status: 'creation-failed', error: failure });
    expect(result[1]).toEqual({ childName: 'Second', childId: 'child-second', status: 'processed', error: null });
  });

  it('preserves guardian failure as an abort before assignment', async () => {
    const failure = { code: '42501', message: 'guardian denied' };
    const { value } = operations({ linkGuardian: vi.fn(async () => { throw failure; }) });
    await expect(
      processBulkExistingParentChildren(
        { ...base, children: [{ name: 'Existing', yearOfBirth: '', jerseyNumber: '', existingChildId: 'child-existing' }] },
        value as any,
      ),
    ).rejects.toBe(failure);
    expect(value.ensureAssignment).not.toHaveBeenCalled();
  });
});

describe('bulk child assignment compatibility', () => {
  function assignmentClient(existing: unknown, selectError: unknown = null, insertError: unknown = null) {
    const maybeSingle = vi.fn(async () => ({ data: existing, error: selectError }));
    const secondEq = vi.fn(() => ({ maybeSingle }));
    const firstEq = vi.fn(() => ({ eq: secondEq }));
    const select = vi.fn(() => ({ eq: firstEq }));
    const insert = vi.fn(async () => ({ data: null, error: insertError }));
    const from = vi.fn(() => ({ select, insert }));
    return { client: { from } as LocalMembershipClient, from, select, firstEq, secondEq, maybeSingle, insert };
  }

  it('uses exact child/team scope and skips insertion for an existing assignment', async () => {
    const mock = assignmentClient({ id: 'assignment-a' });
    await expect(ensureBulkChildTeamAssignmentBestEffort({ childId: 'child-a', teamId: 'team-a' }, mock.client)).resolves.toBe(
      'already-assigned',
    );
    expect(mock.firstEq).toHaveBeenCalledWith('child_id', 'child-a');
    expect(mock.secondEq).toHaveBeenCalledWith('team_id', 'team-a');
    expect(mock.insert).not.toHaveBeenCalled();
  });

  it('preserves best-effort insertion when lookup or insertion reports an error', async () => {
    const mock = assignmentClient(null, { message: 'lookup failed' }, { message: 'insert failed' });
    await expect(ensureBulkChildTeamAssignmentBestEffort({ childId: 'child-a', teamId: 'team-a' }, mock.client)).resolves.toBe(
      'insert-attempted',
    );
    expect(mock.insert).toHaveBeenCalledWith({ child_id: 'child-a', team_id: 'team-a' });
  });
});

describe('bulk selected second-guardian workflow', () => {
  function selectedGuardianClient(results: Array<{ error: unknown }>) {
    let index = 0;
    const writes: Array<{ table: string; payload: unknown }> = [];
    const from = vi.fn((table: string) => ({
      insert: (payload: unknown) => {
        writes.push({ table, payload });
        return { select: () => ({ maybeSingle: async () => ({ data: null, error: results[index++]?.error ?? null }) }) };
      },
    }));
    return { client: { from } as LocalMembershipClient, from, writes };
  }

  const input = {
    secondGuardianUserId: 'parent-b',
    teamId: 'team-a',
    clubId: 'club-a',
    children: [
      { name: 'Child A', yearOfBirth: '', jerseyNumber: '', existingChildId: 'child-a' },
      { name: 'New Child', yearOfBirth: '', jerseyNumber: '' },
      { name: 'Child B', yearOfBirth: '', jerseyNumber: '', existingChildId: 'child-b' },
    ],
  };

  it('writes the exact parent role then links only resolved existing child ids', async () => {
    const { client, writes } = selectedGuardianClient([{ error: null }, { error: null }, { error: null }]);
    await expect(addBulkSelectedSecondGuardian(input, client)).resolves.toEqual({ roleError: null, guardianErrors: [] });
    expect(writes).toEqual([
      { table: 'user_roles', payload: { user_id: 'parent-b', team_id: 'team-a', club_id: 'club-a', role: 'parent' } },
      { table: 'child_guardians', payload: { child_id: 'child-a', guardian_id: 'parent-b' } },
      { table: 'child_guardians', payload: { child_id: 'child-b', guardian_id: 'parent-b' } },
    ]);
  });

  it('preserves best-effort continuation and exposes every returned error', async () => {
    const roleError = { code: '42501', message: 'role denied' };
    const guardianError = { code: '23505', message: 'guardian duplicate' };
    const { client, writes } = selectedGuardianClient([{ error: roleError }, { error: guardianError }, { error: null }]);
    await expect(addBulkSelectedSecondGuardian(input, client)).resolves.toEqual({
      roleError,
      guardianErrors: [{ childId: 'child-a', error: guardianError }],
    });
    expect(writes).toHaveLength(3);
  });

  it('still creates the role when no children have existing ids', async () => {
    const { client, writes } = selectedGuardianClient([{ error: null }]);
    await addBulkSelectedSecondGuardian({ ...input, children: [{ name: 'New', yearOfBirth: '', jerseyNumber: '' }] }, client);
    expect(writes).toHaveLength(1);
    expect(writes[0].table).toBe('user_roles');
  });
});

describe('bulk pending second-guardian workflow', () => {
  const input = {
    teamId: 'team-a',
    clubId: 'club-a',
    inviterUserId: 'admin-a',
    guardianName: ' Parent B ',
    guardianEmail: ' PARENT.B@EXAMPLE.TEST ',
    children: [
      { name: ' Child A ', yearOfBirth: '', jerseyNumber: '', existingChildId: 'child-a' },
      { name: ' Child B ', yearOfBirth: '', jerseyNumber: '' },
    ],
    teamName: 'Synthetic Team',
    appOrigin: 'https://app.example.test',
    clubName: 'Synthetic Club' as string | null,
    clubLogoUrl: 'https://example.test/logo.png' as string | null,
    clubContactEmail: 'club@example.test' as string | null,
  };

  function pendingGuardianClient(inviteError: unknown = null, invokeResult: unknown = { data: {}, error: null }) {
    const insert = vi.fn(async () => ({ data: null, error: inviteError }));
    const from = vi.fn(() => ({ insert }));
    const invoke = vi.fn(async () => invokeResult);
    return { client: { from, functions: { invoke } } as LocalMembershipClient, from, insert, invoke };
  }

  it('creates the exact guardian invitation then sends the exact normalized email', async () => {
    const { client, insert, invoke } = pendingGuardianClient();
    await expect(inviteBulkPendingSecondGuardian(input, client, () => 'token-b')).resolves.toEqual({
      inviteToken: 'token-b',
      inviteError: null,
      emailError: null,
    });
    expect(insert).toHaveBeenCalledWith({
      team_id: 'team-a',
      club_id: 'club-a',
      role: 'parent',
      invited_user_id: null,
      invited_by_user_id: 'admin-a',
      invited_label: 'Parent B',
      invited_email: 'parent.b@example.test',
      invite_token: 'token-b',
      metadata: {
        guardian_child_id: 'child-a',
        guardian_all_team_ids: ['team-a'],
        invited_by_parent: true,
        children: [
          { name: 'Child A', existingChildId: 'child-a' },
          { name: 'Child B', existingChildId: null },
        ],
      },
    });
    expect(invoke).toHaveBeenCalledWith('send-email', {
      body: {
        to: 'parent.b@example.test',
        subject: "Synthetic Club: You've been invited as a guardian ⚽",
        template: 'team-invite',
        senderName: 'Synthetic Club',
        replyTo: 'club@example.test',
        templateData: {
          recipientName: 'Parent B',
          invitedEmail: 'parent.b@example.test',
          teamName: 'Synthetic Team',
          clubName: 'Synthetic Club',
          roleName: 'Parent',
          inviteLink: 'https://app.example.test/join/p/token-b',
          clubLogoUrl: 'https://example.test/logo.png',
          childrenNames: ['Child A', 'Child B'],
        },
      },
    });
  });

  it('attempts email even when invitation insertion returns an error', async () => {
    const inviteError = { code: '42501', message: 'invite denied' };
    const { client, invoke } = pendingGuardianClient(inviteError);
    await expect(inviteBulkPendingSecondGuardian(input, client, () => 'token-b')).resolves.toEqual({
      inviteToken: 'token-b',
      inviteError,
      emailError: null,
    });
    expect(invoke).toHaveBeenCalledOnce();
  });

  it('exposes a returned invocation error without throwing', async () => {
    const emailError = { message: 'function unavailable' };
    const { client } = pendingGuardianClient(null, { data: null, error: emailError });
    await expect(inviteBulkPendingSecondGuardian(input, client, () => 'token-b')).resolves.toEqual({
      inviteToken: 'token-b',
      inviteError: null,
      emailError,
    });
  });

  it('catches and exposes a thrown invocation failure', async () => {
    const thrown = new Error('network failed');
    const insert = vi.fn(async () => ({ data: null, error: null }));
    const invoke = vi.fn(async () => { throw thrown; });
    const client = { from: () => ({ insert }), functions: { invoke } } as LocalMembershipClient;
    await expect(inviteBulkPendingSecondGuardian(input, client, () => 'token-b')).resolves.toEqual({
      inviteToken: 'token-b',
      inviteError: null,
      emailError: thrown,
    });
  });

  it('uses null guardian_child_id and branding fallbacks without resolved children', async () => {
    const { client, insert, invoke } = pendingGuardianClient();
    await inviteBulkPendingSecondGuardian(
      { ...input, children: [{ name: 'Child A', yearOfBirth: '', jerseyNumber: '' }], clubName: null, clubLogoUrl: null, clubContactEmail: null },
      client,
      () => 'token-b',
    );
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ guardian_child_id: null }) }));
    expect(invoke).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        body: expect.objectContaining({
          subject: "Your club: You've been invited as a guardian ⚽",
          senderName: undefined,
          replyTo: undefined,
          templateData: expect.objectContaining({ clubName: 'The Club', clubLogoUrl: undefined }),
        }),
      }),
    );
  });
});

describe('bulk existing-member notification and result completion', () => {
  const input = {
    userId: 'user-a',
    displayName: 'Existing User',
    enteredName: ' Entered Name ',
    enteredEmail: ' USER@EXAMPLE.TEST ',
    teamId: 'team-a',
    teamName: 'Synthetic Team',
    appOrigin: 'https://app.example.test',
    role: 'coach' as const,
    roleLabel: 'Coach' as string | undefined,
    childrenCount: 2,
  };

  it('writes the exact notification and composes the successful existing-user result', async () => {
    const { client, from, insert } = insertClient();
    await expect(completeBulkExistingMember(input, client)).resolves.toEqual({
      notificationError: null,
      memberResult: {
        name: 'Existing User',
        email: 'USER@EXAMPLE.TEST',
        link: 'https://app.example.test/teams/team-a',
        sent: true,
        role: 'coach',
        childrenCount: 2,
      },
    });
    expect(from).toHaveBeenCalledWith('notifications');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-a',
      type: 'membership',
      message: 'You have been added to Synthetic Team as Coach',
      related_id: 'team-a',
    });
  });

  it('falls back to the trimmed entered name and preserves missing-label interpolation', async () => {
    const { client, insert } = insertClient();
    const result = await completeBulkExistingMember({ ...input, displayName: null, roleLabel: undefined }, client);
    expect(result.memberResult.name).toBe('Entered Name');
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ message: 'You have been added to Synthetic Team as undefined' }));
  });

  it('exposes notification failure without changing the successful member result', async () => {
    const notificationError = { code: '42501', message: 'notification denied' };
    const { client } = insertClient(notificationError);
    await expect(completeBulkExistingMember(input, client)).resolves.toEqual({
      notificationError,
      memberResult: expect.objectContaining({ sent: true, name: 'Existing User' }),
    });
  });
});

describe('bulk pending-recipient orchestration', () => {
  const input = {
    teamId: 'team-a',
    teamName: 'Synthetic Team',
    clubId: 'club-a',
    inviterUserId: 'admin-a',
    role: 'parent' as const,
    roleLabel: 'Parent',
    invitedName: ' Parent A ',
    invitedEmail: ' PARENT@EXAMPLE.TEST ',
    inviteToken: 'token-a',
    metadata: null,
    childrenNames: ['Child A'],
    customMessage: ' Welcome ',
    appOrigin: 'https://app.example.test',
    clubName: 'Synthetic Club' as string | null,
    clubLogoUrl: null as string | null,
    clubContactEmail: null as string | null,
  };

  function operations(overrides: Record<string, unknown> = {}) {
    const calls: string[] = [];
    return {
      calls,
      value: {
        createInvite: vi.fn(async () => {
          calls.push('create');
          return { created: true, error: null };
        }),
        deliverEmail: vi.fn(async () => {
          calls.push('deliver');
          return { sent: true, emailId: 'email-a', emailError: null, writeError: null };
        }),
        ...overrides,
      },
    };
  }

  it('creates then delivers in order and composes the exact recipient result', async () => {
    const { value, calls } = operations();
    await expect(processBulkPendingRecipient(input, value as any)).resolves.toEqual({
      inviteError: null,
      deliveryResult: { sent: true, emailId: 'email-a', emailError: null, writeError: null },
      memberResult: {
        name: 'Parent A',
        email: 'PARENT@EXAMPLE.TEST',
        link: 'https://app.example.test/join/p/token-a',
        sent: true,
        role: 'parent',
        childrenCount: 1,
      },
    });
    expect(calls).toEqual(['create', 'deliver']);
    expect(value.deliverEmail).toHaveBeenCalledWith(
      expect.objectContaining({ inviteToken: 'token-a', recipientEmail: 'PARENT@EXAMPLE.TEST', roleLabel: 'Parent', childrenNames: ['Child A'] }),
    );
  });

  it('does not deliver or compose success after invitation failure', async () => {
    const inviteError = { code: '42501', message: 'invite denied' };
    const { value } = operations({ createInvite: vi.fn(async () => ({ created: false, error: inviteError })) });
    await expect(processBulkPendingRecipient(input, value as any)).resolves.toEqual({
      memberResult: null,
      inviteError,
      deliveryResult: null,
    });
    expect(value.deliverEmail).not.toHaveBeenCalled();
  });

  it('retains an unsent recipient result after delivery failure', async () => {
    const { value } = operations({
      deliverEmail: vi.fn(async () => ({ sent: false, emailId: null, emailError: 'provider rejected', writeError: null })),
    });
    const result = await processBulkPendingRecipient(input, value as any);
    expect(result.memberResult).toEqual(expect.objectContaining({ sent: false }));
    expect(result.deliveryResult?.emailError).toBe('provider rejected');
  });

  it('retains the share-link result for a blank email without special-casing orchestration', async () => {
    const { value } = operations({
      deliverEmail: vi.fn(async () => ({ sent: false, emailId: null, emailError: null, writeError: null })),
    });
    const result = await processBulkPendingRecipient({ ...input, invitedEmail: ' ' }, value as any);
    expect(result.memberResult).toEqual(
      expect.objectContaining({ email: '', link: 'https://app.example.test/join/p/token-a', sent: false }),
    );
  });
});

describe('existing-user child and guardian mutations', () => {
  it('does not create a guardian row when the user is already the primary parent', async () => {
    const { client, from, insert } = insertClient();
    await expect(
      linkGuardianToExistingChild({ childId: 'child-a', guardianId: 'parent-a', primaryParentId: 'parent-a' }, client),
    ).resolves.toEqual({ status: 'primary-parent' });
    expect(from).not.toHaveBeenCalled();
    expect(insert).not.toHaveBeenCalled();
  });

  it('links an additional guardian using exact child and guardian IDs', async () => {
    const { client, from, insert } = insertClient();
    await expect(
      linkGuardianToExistingChild({ childId: 'child-a', guardianId: 'guardian-a', primaryParentId: 'parent-a' }, client),
    ).resolves.toEqual({ status: 'linked' });
    expect(from).toHaveBeenCalledWith('child_guardians');
    expect(insert).toHaveBeenCalledWith({ child_id: 'child-a', guardian_id: 'guardian-a' });
  });

  it('treats an existing guardian relationship as idempotent', async () => {
    const { client } = insertClient({ code: '23505', message: 'duplicate' });
    await expect(
      linkGuardianToExistingChild({ childId: 'child-a', guardianId: 'guardian-a', primaryParentId: 'parent-a' }, client),
    ).resolves.toEqual({ status: 'already-linked' });
  });

  it('blocks permission, foreign-key and merged-child guardian failures', async () => {
    for (const error of [
      { code: '42501', message: 'permission denied' },
      { code: '23503', message: 'foreign key violation' },
      { code: 'P0002', message: 'child was merged' },
    ]) {
      const { client } = insertClient(error);
      await expect(
        linkGuardianToExistingChild({ childId: 'child-a', guardianId: 'guardian-a', primaryParentId: 'parent-a' }, client),
      ).rejects.toBe(error);
    }
  });

  it('creates a child through the secure RPC with normalized values', async () => {
    const rpc = vi.fn(async () => ({ data: 'child-new', error: null }));
    const client = { rpc } as LocalMembershipClient;
    await expect(
      createChildForParentOnTeam({ parentUserId: 'parent-a', teamId: 'team-a', name: ' Child A ', yearOfBirth: '2016' }, client),
    ).resolves.toBe('child-new');
    expect(rpc).toHaveBeenCalledWith('create_child_for_parent_on_team', {
      p_parent_user_id: 'parent-a',
      p_team_id: 'team-a',
      p_name: 'Child A',
      p_year_of_birth: 2016,
    });
  });

  it('uses the RPC null default for an omitted year and rethrows the original RPC error', async () => {
    const error = { code: '42501', message: 'creation denied' };
    const rpc = vi.fn(async () => ({ data: null, error }));
    const client = { rpc } as LocalMembershipClient;
    await expect(
      createChildForParentOnTeam({ parentUserId: 'parent-a', teamId: 'team-a', name: 'Child A', yearOfBirth: '' }, client),
    ).rejects.toBe(error);
    expect(rpc).toHaveBeenCalledWith('create_child_for_parent_on_team', expect.objectContaining({ p_year_of_birth: undefined }));
  });
});

type PlacementState = { assignment?: { id: string } | null; position?: { id: string } | null; assignmentInsertError?: unknown };

function placementClient(state: PlacementState = {}) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const from = (table: string) => {
    let writeResult = { data: null, error: null as unknown };
    const query: Record<string, unknown> = {};
    const record = (method: string) => (...args: unknown[]) => {
      calls.push({ table, method, args });
      return query;
    };
    query.select = record('select');
    query.eq = record('eq');
    query.update = (...args: unknown[]) => {
      calls.push({ table, method: 'update', args });
      writeResult = { data: null, error: null };
      return query;
    };
    query.insert = async (...args: unknown[]) => {
      calls.push({ table, method: 'insert', args });
      return { data: null, error: table === 'child_team_assignments' ? state.assignmentInsertError ?? null : null };
    };
    query.maybeSingle = async () => ({
      data: table === 'child_team_assignments' ? state.assignment ?? null : state.position ?? null,
      error: null,
    });
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(writeResult).then(resolve);
    return query;
  };
  return { client: { from } as LocalMembershipClient, calls };
}

describe('child team placement mutation service', () => {
  it('does not insert a duplicate team assignment', async () => {
    const { client, calls } = placementClient({ assignment: { id: 'assignment-a' } });
    await expect(ensureChildTeamAssignment({ childId: 'child-a', teamId: 'team-a' }, client)).resolves.toBe('already-assigned');
    expect(calls).toEqual(
      expect.arrayContaining([
        { table: 'child_team_assignments', method: 'eq', args: ['child_id', 'child-a'] },
        { table: 'child_team_assignments', method: 'eq', args: ['team_id', 'team-a'] },
      ]),
    );
    expect(calls.some((call) => call.method === 'insert')).toBe(false);
  });

  it('creates the exact missing team assignment', async () => {
    const { client, calls } = placementClient({ assignment: null });
    await expect(ensureChildTeamAssignment({ childId: 'child-a', teamId: 'team-a' }, client)).resolves.toBe('assigned');
    expect(calls).toContainEqual({ table: 'child_team_assignments', method: 'insert', args: [{ child_id: 'child-a', team_id: 'team-a' }] });
  });

  it('rethrows an assignment failure before jersey persistence can be reported', async () => {
    const error = { code: '42501', message: 'assignment denied' };
    const { client } = placementClient({ assignment: null, assignmentInsertError: error });
    await expect(ensureChildTeamAssignment({ childId: 'child-a', teamId: 'team-a' }, client)).rejects.toBe(error);
  });

  it('updates an existing jersey position by its exact row ID', async () => {
    const { client, calls } = placementClient({ position: { id: 'position-a' } });
    await expect(persistChildJerseyPosition({ childId: 'child-a', teamId: 'team-a', jerseyNumber: ' 12 ' }, client)).resolves.toBe('updated');
    expect(calls).toEqual(
      expect.arrayContaining([
        { table: 'team_player_positions', method: 'update', args: [{ jersey_number: 12 }] },
        { table: 'team_player_positions', method: 'eq', args: ['id', 'position-a'] },
      ]),
    );
  });

  it('inserts the established MID position for a new jersey row', async () => {
    const { client, calls } = placementClient({ position: null });
    await expect(persistChildJerseyPosition({ childId: 'child-a', teamId: 'team-a', jerseyNumber: '9' }, client)).resolves.toBe('inserted');
    expect(calls).toContainEqual({
      table: 'team_player_positions',
      method: 'insert',
      args: [{ team_id: 'team-a', child_id: 'child-a', position: 'MID', jersey_number: 9 }],
    });
  });

  it('performs no position read or write for absent and invalid jersey values', async () => {
    const { client, calls } = placementClient();
    await expect(persistChildJerseyPosition({ childId: 'child-a', teamId: 'team-a', jerseyNumber: '' }, client)).resolves.toBe('not-provided');
    await expect(persistChildJerseyPosition({ childId: 'child-a', teamId: 'team-a', jerseyNumber: 'abc' }, client)).resolves.toBe('invalid');
    expect(calls).toEqual([]);
  });
});

function secondParentClient(
  options: { roleError?: unknown; guardianErrors?: unknown[]; notificationError?: unknown } = {},
) {
  const calls: Array<{ table: string; method: string; args: unknown[] }> = [];
  const guardianErrors = [...(options.guardianErrors ?? [])];
  const from = (table: string) => {
    let result = { data: null, error: null as unknown };
    const query: Record<string, unknown> = {};
    query.insert = (...args: unknown[]) => {
      calls.push({ table, method: 'insert', args });
      result = {
        data: null,
        error:
          table === 'user_roles'
            ? options.roleError ?? null
            : table === 'child_guardians'
              ? guardianErrors.shift() ?? null
              : options.notificationError ?? null,
      };
      return query;
    };
    query.select = (...args: unknown[]) => {
      calls.push({ table, method: 'select', args });
      return query;
    };
    query.maybeSingle = async () => result;
    query.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve);
    return query;
  };
  return { client: { from } as LocalMembershipClient, calls };
}

describe('existing second-parent orchestration', () => {
  const input = { userId: 'parent-b', teamId: 'team-a', clubId: 'club-a', teamName: 'Synthetic Team', childIds: ['child-a', 'child-b'] };

  it('writes the exact role, every guardian link and membership notification', async () => {
    const { client, calls } = secondParentClient();
    await expect(addExistingSecondParent(input, client)).resolves.toEqual({ roleError: null, guardianErrors: [], notificationError: null });
    expect(calls).toEqual(
      expect.arrayContaining([
        { table: 'user_roles', method: 'insert', args: [{ user_id: 'parent-b', team_id: 'team-a', club_id: 'club-a', role: 'parent' }] },
        { table: 'child_guardians', method: 'insert', args: [{ child_id: 'child-a', guardian_id: 'parent-b' }] },
        { table: 'child_guardians', method: 'insert', args: [{ child_id: 'child-b', guardian_id: 'parent-b' }] },
        {
          table: 'notifications',
          method: 'insert',
          args: [{ user_id: 'parent-b', type: 'membership', message: 'You have been added to Synthetic Team as Parent', related_id: 'team-a' }],
        },
      ]),
    );
  });

  it('treats a duplicate second-parent role as an idempotent outcome', async () => {
    const { client } = secondParentClient({ roleError: { code: '23505', message: 'duplicate' } });
    await expect(addExistingSecondParent(input, client)).resolves.toEqual({ roleError: null, guardianErrors: [], notificationError: null });
  });

  it('exposes a non-duplicate role failure while preserving the existing continuation', async () => {
    const error = { code: '42501', message: 'role denied' };
    const { client, calls } = secondParentClient({ roleError: error });
    const result = await addExistingSecondParent(input, client);
    expect(result.roleError).toBe(error);
    expect(calls.filter((call) => call.table === 'child_guardians' && call.method === 'insert')).toHaveLength(2);
    expect(calls.some((call) => call.table === 'notifications')).toBe(true);
  });

  it('collects each guardian failure without skipping later children or notification', async () => {
    const firstError = { code: '42501', message: 'guardian denied' };
    const { client, calls } = secondParentClient({ guardianErrors: [firstError, null] });
    const result = await addExistingSecondParent(input, client);
    expect(result.guardianErrors).toEqual([{ childId: 'child-a', error: firstError }]);
    expect(calls.filter((call) => call.table === 'child_guardians' && call.method === 'insert')).toHaveLength(2);
    expect(calls.some((call) => call.table === 'notifications')).toBe(true);
  });

  it('exposes notification failure after preserving membership and guardian writes', async () => {
    const error = { code: '42501', message: 'notification denied' };
    const { client } = secondParentClient({ notificationError: error });
    const result = await addExistingSecondParent(input, client);
    expect(result.notificationError).toBe(error);
    expect(result.roleError).toBeNull();
    expect(result.guardianErrors).toEqual([]);
  });
});

describe('existing member notification outcome', () => {
  it('writes the exact membership notification and reports success', async () => {
    const { client, from, insert } = insertClient();
    await expect(
      notifyExistingTeamMember({ userId: 'user-a', teamId: 'team-a', teamName: 'Synthetic Team', roleLabel: 'Coach' }, client),
    ).resolves.toEqual({ notificationFailed: false, notificationError: null });
    expect(from).toHaveBeenCalledWith('notifications');
    expect(insert).toHaveBeenCalledWith({
      user_id: 'user-a',
      type: 'membership',
      message: 'You have been added to Synthetic Team as Coach',
      related_id: 'team-a',
    });
  });

  it('maps a notification write error to truthful notification-only failure', async () => {
    const { client } = insertClient({ code: '42501', message: 'notification denied' });
    await expect(
      notifyExistingTeamMember({ userId: 'user-a', teamId: 'team-a', teamName: 'Synthetic Team', roleLabel: 'Parent' }, client),
    ).resolves.toEqual({ notificationFailed: true, notificationError: 'notification denied' });
  });

  it('preserves the existing missing-label interpolation fallback', async () => {
    const { client, insert } = insertClient();
    await notifyExistingTeamMember({ userId: 'user-a', teamId: 'team-a', teamName: 'Synthetic Team', roleLabel: undefined }, client);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ message: 'You have been added to Synthetic Team as undefined' }));
  });
});

function childWorkflowOperations(overrides: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const operations = {
    linkGuardian: vi.fn(async () => { calls.push('guardian'); return { status: 'linked' as const }; }),
    createChild: vi.fn(async () => { calls.push('create'); return 'child-new'; }),
    ensureAssignment: vi.fn(async () => { calls.push('assignment'); return 'assigned' as const; }),
    persistJersey: vi.fn(async () => { calls.push('jersey'); return 'inserted' as const; }),
    ...overrides,
  };
  return { operations, calls };
}

describe('existing parent child workflow composition', () => {
  const base = {
    parentUserId: 'parent-a',
    teamId: 'team-a',
    teamName: 'Synthetic Team',
    clubChildren: [{ id: 'child-existing', parent_id: 'parent-b', year_of_birth: 2015 }],
  };

  it('links, assigns and persists an existing child in order', async () => {
    const { operations, calls } = childWorkflowOperations();
    await expect(
      processExistingParentChildren(
        { ...base, children: [{ name: ' Existing Child ', yearOfBirth: '2016', jerseyNumber: '8', existingChildId: 'child-existing' }] },
        operations as any,
      ),
    ).resolves.toEqual({ childIds: ['child-existing'], resolvedChildren: [{ id: 'child-existing', name: 'Existing Child', yearOfBirth: 2015 }] });
    expect(calls).toEqual(['guardian', 'assignment', 'jersey']);
    expect(operations.createChild).not.toHaveBeenCalled();
  });

  it('creates, assigns and persists a new child in order', async () => {
    const { operations, calls } = childWorkflowOperations();
    await expect(
      processExistingParentChildren({ ...base, children: [{ name: ' New Child ', yearOfBirth: '2017', jerseyNumber: '10' }] }, operations as any),
    ).resolves.toEqual({ childIds: ['child-new'], resolvedChildren: [{ id: 'child-new', name: 'New Child', yearOfBirth: 2017 }] });
    expect(calls).toEqual(['create', 'assignment', 'jersey']);
  });

  it('skips blank children and children owned by pending invitations', async () => {
    const { operations, calls } = childWorkflowOperations();
    await expect(
      processExistingParentChildren(
        {
          ...base,
          children: [
            { name: ' ', yearOfBirth: '', jerseyNumber: '' },
            { name: 'Pending Child', yearOfBirth: '2018', jerseyNumber: '', pendingInviteId: 'invite-a' },
          ],
        },
        operations as any,
      ),
    ).resolves.toEqual({ childIds: [], resolvedChildren: [] });
    expect(calls).toEqual([]);
  });

  it("preserves the child-specific creation error and stops later writes", async () => {
    const operations = childWorkflowOperations({ createChild: vi.fn(async () => { throw new Error('creation denied'); }) }).operations;
    await expect(
      processExistingParentChildren({ ...base, children: [{ name: ' New Child ', yearOfBirth: '', jerseyNumber: '' }] }, operations as any),
    ).rejects.toThrow("We couldn't save New Child. creation denied");
    expect(operations.ensureAssignment).not.toHaveBeenCalled();
    expect(operations.persistJersey).not.toHaveBeenCalled();
  });

  it('preserves the truthful saved-but-unassigned error and skips jersey persistence', async () => {
    const operations = childWorkflowOperations({ ensureAssignment: vi.fn(async () => { throw new Error('assignment denied'); }) }).operations;
    await expect(
      processExistingParentChildren({ ...base, children: [{ name: 'New Child', yearOfBirth: '', jerseyNumber: '9' }] }, operations as any),
    ).rejects.toThrow("We saved New Child, but couldn't add them to Synthetic Team. Please try again.");
    expect(operations.persistJersey).not.toHaveBeenCalled();
  });

  it('processes children sequentially and retains stable resolved order', async () => {
    let created = 0;
    const { operations } = childWorkflowOperations({ createChild: vi.fn(async () => `child-${++created}`) });
    const result = await processExistingParentChildren(
      { ...base, children: [{ name: 'First', yearOfBirth: '2015', jerseyNumber: '' }, { name: 'Second', yearOfBirth: '2016', jerseyNumber: '' }] },
      operations as any,
    );
    expect(result.childIds).toEqual(['child-1', 'child-2']);
    expect(result.resolvedChildren.map(({ name }) => name)).toEqual(['First', 'Second']);
  });
});

function pendingInviteClient(result: { data: unknown; error: unknown }) {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const query: Record<string, unknown> = {};
  for (const method of ['insert', 'select']) {
    query[method] = (...args: unknown[]) => {
      calls.push({ method, args });
      return query;
    };
  }
  query.single = async () => result;
  const from = vi.fn(() => query);
  return { client: { from } as LocalMembershipClient, from, calls };
}

describe('single pending team invitation creation', () => {
  const base = {
    teamId: 'team-a',
    clubId: 'club-a',
    role: 'parent' as const,
    inviterUserId: 'admin-a',
    invitedName: ' Parent A ',
    invitedEmail: ' PARENT@EXAMPLE.TEST ',
    inviteToken: 'token-a',
    children: [{ name: ' Child A ', yearOfBirth: '2016', jerseyNumber: '', existingChildId: 'child-a' }],
    linkedSecondParentToken: 'token-b' as string | null,
    selectedSecondParentId: null as string | null,
  };

  it('inserts the exact normalized parent invitation and child metadata', async () => {
    const { client, from, calls } = pendingInviteClient({ data: { id: 'invite-a', short_code: 'ABC123' }, error: null });
    await expect(createPendingTeamInvite(base, client)).resolves.toEqual({
      invite: { id: 'invite-a', short_code: 'ABC123' },
      childrenMetadata: [{ name: 'Child A', yearOfBirth: 2016, existingChildId: 'child-a' }],
    });
    expect(from).toHaveBeenCalledWith('pending_invites');
    expect(calls).toEqual([
      {
        method: 'insert',
        args: [
          {
            team_id: 'team-a',
            club_id: 'club-a',
            role: 'parent',
            invited_user_id: null,
            invited_by_user_id: 'admin-a',
            invited_label: 'Parent A',
            invited_email: 'parent@example.test',
            invite_token: 'token-a',
            metadata: { children: [{ name: 'Child A', yearOfBirth: 2016, existingChildId: 'child-a' }], linked_invite_token: 'token-b' },
          },
        ],
      },
      { method: 'select', args: ['id, short_code'] },
    ]);
  });

  it('records a selected second parent only when child metadata exists', async () => {
    const { client, calls } = pendingInviteClient({ data: { id: 'invite-a', short_code: null }, error: null });
    await createPendingTeamInvite({ ...base, linkedSecondParentToken: null, selectedSecondParentId: 'parent-b' }, client);
    expect(calls[0].args[0]).toEqual(expect.objectContaining({ metadata: expect.objectContaining({ second_parent_user_id: 'parent-b' }) }));
  });

  it('ignores children for non-parent roles and normalizes an empty email to null', async () => {
    const { client, calls } = pendingInviteClient({ data: { id: 'invite-a', short_code: null }, error: null });
    await expect(
      createPendingTeamInvite({ ...base, role: 'coach', invitedEmail: ' ', selectedSecondParentId: 'parent-b' }, client),
    ).resolves.toEqual({ invite: { id: 'invite-a', short_code: null }, childrenMetadata: null });
    expect(calls[0].args[0]).toEqual(expect.objectContaining({ invited_email: null, metadata: null }));
  });

  it('rethrows the original insertion error', async () => {
    const error = { code: '42501', message: 'invite denied' };
    const { client } = pendingInviteClient({ data: null, error });
    await expect(createPendingTeamInvite(base, client)).rejects.toBe(error);
  });

  it('preserves the existing null result when single returns no row without an error', async () => {
    const { client } = pendingInviteClient({ data: null, error: null });
    await expect(createPendingTeamInvite(base, client)).resolves.toEqual({
      invite: null,
      childrenMetadata: [{ name: 'Child A', yearOfBirth: 2016, existingChildId: 'child-a' }],
    });
  });
});

describe('pending second-parent invitation creation', () => {
  const base = {
    teamId: 'team-a',
    clubId: 'club-a',
    inviterUserId: 'admin-a',
    invitedName: ' Parent B ',
    invitedEmail: ' PARENT.B@EXAMPLE.TEST ',
    inviteToken: 'token-b',
    primaryInviteToken: 'token-a',
    childrenMetadata: [{ name: 'Child A', yearOfBirth: 2016, existingChildId: 'child-a' }] as
      | Array<{ name: string; yearOfBirth: number | null; existingChildId: string | null }>
      | null,
  };

  it('inserts the exact normalized linked parent invitation', async () => {
    const { client, from, insert } = insertClient();
    await expect(createPendingSecondParentInvite(base, client)).resolves.toEqual({ created: true, error: null });
    expect(from).toHaveBeenCalledWith('pending_invites');
    expect(insert).toHaveBeenCalledWith({
      team_id: 'team-a',
      club_id: 'club-a',
      role: 'parent',
      invited_user_id: null,
      invited_by_user_id: 'admin-a',
      invited_label: 'Parent B',
      invited_email: 'parent.b@example.test',
      invite_token: 'token-b',
      metadata: { children: [{ name: 'Child A', yearOfBirth: 2016, existingChildId: 'child-a' }], linked_invite_token: 'token-a' },
    });
  });

  it('preserves null metadata when the primary invitation has no children', async () => {
    const { client, insert } = insertClient();
    await createPendingSecondParentInvite({ ...base, childrenMetadata: null }, client);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ metadata: null }));
  });

  it('preserves best-effort failure without throwing or reporting creation', async () => {
    const error = { code: '42501', message: 'second invite denied' };
    const { client } = insertClient(error);
    await expect(createPendingSecondParentInvite(base, client)).resolves.toEqual({ created: false, error });
  });
});

function pendingInviteUpdateClient(error: unknown = null) {
  const eq = vi.fn(async () => ({ data: null, error }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { from } as LocalMembershipClient, from, update, eq };
}

describe('primary pending-invite email delivery recording', () => {
  it('records verified provider success with the exact token and timestamp', async () => {
    const { client, from, update, eq } = pendingInviteUpdateClient();
    await expect(
      recordPendingInviteEmailDelivery(
        { inviteToken: 'token-a', providerResult: { verified: true, success: true, emailId: 'email-a' }, invocationError: null },
        client,
        () => '2026-08-10T00:00:00.000Z',
      ),
    ).resolves.toEqual({ emailSent: true, emailId: 'email-a', emailError: null, writeError: null });
    expect(from).toHaveBeenCalledWith('pending_invites');
    expect(update).toHaveBeenCalledWith({ email_sent_at: '2026-08-10T00:00:00.000Z', email_id: 'email-a', email_error: null });
    expect(eq).toHaveBeenCalledWith('invite_token', 'token-a');
  });

  it.each([
    [null, 'Email not verified'],
    [{ verified: false, success: true }, 'Email not verified'],
    [{ verified: true, success: false, error: 'provider rejected' }, 'provider rejected'],
    [{ success: true }, 'Email not verified'],
  ])('records unverified or unsuccessful provider output as failed: %j', async (providerResult, expectedError) => {
    const { client, update } = pendingInviteUpdateClient();
    const result = await recordPendingInviteEmailDelivery(
      { inviteToken: 'token-a', providerResult: providerResult as any, invocationError: null },
      client,
    );
    expect(result).toEqual(expect.objectContaining({ emailSent: false, emailError: expectedError }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ email_sent_at: null, email_error: expectedError }));
  });

  it('gives an invocation error precedence over an apparent provider success', async () => {
    const { client, update } = pendingInviteUpdateClient();
    await expect(
      recordPendingInviteEmailDelivery(
        {
          inviteToken: 'token-a',
          providerResult: { verified: true, success: true, emailId: 'email-a' },
          invocationError: { message: 'function unavailable' },
        },
        client,
      ),
    ).resolves.toEqual(expect.objectContaining({ emailSent: false, emailId: 'email-a', emailError: 'function unavailable' }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ email_sent_at: null, email_error: 'function unavailable' }));
  });

  it('preserves the secondary-parent provider fallback for invocation errors', async () => {
    const { client, update } = pendingInviteUpdateClient();
    await expect(
      recordPendingInviteEmailDelivery(
        {
          inviteToken: 'token-b',
          providerResult: null,
          invocationError: { message: 'function unavailable' },
          invocationErrorPolicy: 'provider-fallback',
        },
        client,
      ),
    ).resolves.toEqual(expect.objectContaining({ emailSent: false, emailError: 'Email not verified' }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ email_sent_at: null, email_error: 'Email not verified' }));
  });

  it('retains a provider error under the secondary-parent compatibility policy', async () => {
    const { client } = pendingInviteUpdateClient();
    await expect(
      recordPendingInviteEmailDelivery(
        {
          inviteToken: 'token-b',
          providerResult: { error: 'provider rejected' },
          invocationError: { message: 'function unavailable' },
          invocationErrorPolicy: 'provider-fallback',
        },
        client,
      ),
    ).resolves.toEqual(expect.objectContaining({ emailSent: false, emailError: 'provider rejected' }));
  });

  it('exposes but does not throw a delivery-state write failure', async () => {
    const writeError = { code: '42501', message: 'status update denied' };
    const { client } = pendingInviteUpdateClient(writeError);
    await expect(
      recordPendingInviteEmailDelivery(
        { inviteToken: 'token-a', providerResult: { verified: true, success: true }, invocationError: null },
        client,
      ),
    ).resolves.toEqual(expect.objectContaining({ writeError }));
  });
});

describe('pending team-invite email request and invocation', () => {
  const base = {
    recipientName: ' Parent A ',
    recipientEmail: 'parent@example.test',
    teamName: 'Synthetic Team',
    roleLabel: 'Parent',
    inviteLink: 'https://example.test/join/p/token-a',
    childrenNames: ['Child A'],
    customMessage: ' Welcome aboard ',
    clubName: 'Synthetic Club' as string | null | undefined,
    clubLogoUrl: 'https://example.test/logo.png' as string | null | undefined,
    clubContactEmail: 'club@example.test' as string | null | undefined,
    inviteEmailStyle: 'discover' as string | null | undefined,
  };

  it('builds the exact single-child branded request', () => {
    expect(buildPendingTeamInviteEmailRequest(base)).toEqual({
      body: {
        to: 'parent@example.test',
        subject: 'Synthetic Club: See which team Child A is in ⚽',
        template: 'team-invite',
        senderName: 'Synthetic Club',
        replyTo: 'club@example.test',
        templateData: {
          recipientName: 'Parent A',
          invitedEmail: 'parent@example.test',
          teamName: 'Synthetic Team',
          clubName: 'Synthetic Club',
          roleName: 'Parent',
          inviteLink: 'https://example.test/join/p/token-a',
          clubLogoUrl: 'https://example.test/logo.png',
          childrenNames: ['Child A'],
          customMessage: 'Welcome aboard',
        },
      },
    });
  });

  it('uses the multi-child subject without naming one child', () => {
    const request = buildPendingTeamInviteEmailRequest({ ...base, childrenNames: ['Child A', 'Child B'] });
    expect(request.body.subject).toBe('Synthetic Club: See which team your kids are in ⚽');
    expect(request.body.templateData.childrenNames).toEqual(['Child A', 'Child B']);
  });

  it('uses the standard added-to-team wording unless the club selects discover', () => {
    expect(buildPendingTeamInviteEmailRequest({ ...base, inviteEmailStyle: 'standard' }).body.subject).toBe(
      'Synthetic Club: Child A has been added to their team ⚽',
    );
    expect(
      buildPendingTeamInviteEmailRequest({ ...base, inviteEmailStyle: null, childrenNames: ['Child A', 'Child B'] }).body.subject,
    ).toBe('Synthetic Club: Your children have been added to their team ⚽');
  });

  it('uses no-child branding and optional-field fallbacks exactly', () => {
    expect(
      buildPendingTeamInviteEmailRequest({
        ...base,
        roleLabel: 'Coach',
        childrenNames: [],
        customMessage: ' ',
        clubName: null,
        clubLogoUrl: null,
        clubContactEmail: null,
      }),
    ).toEqual({
      body: expect.objectContaining({
        subject: "Your club: You've been added to the team ⚽",
        senderName: undefined,
        replyTo: undefined,
        templateData: expect.objectContaining({
          clubName: 'The Club',
          roleName: 'Coach',
          clubLogoUrl: undefined,
          childrenNames: undefined,
          customMessage: undefined,
        }),
      }),
    });
  });

  it('invokes only the send-email function and returns its verified result', async () => {
    const providerResult = { verified: true, success: true, emailId: 'email-a' };
    const invoke = vi.fn(async () => ({ data: providerResult, error: null }));
    const client = { functions: { invoke } } as LocalMembershipClient;
    await expect(sendPendingTeamInviteEmail(base, client)).resolves.toEqual({ providerResult, invocationError: null });
    expect(invoke).toHaveBeenCalledWith('send-email', buildPendingTeamInviteEmailRequest(base));
  });

  it('returns an invocation error for existing manual-link recovery handling', async () => {
    const invocationError = { message: 'function unavailable' };
    const invoke = vi.fn(async () => ({ data: null, error: invocationError }));
    const client = { functions: { invoke } } as LocalMembershipClient;
    await expect(sendPendingTeamInviteEmail(base, client)).resolves.toEqual({ providerResult: null, invocationError });
  });
});

describe('existing parent team email request and invocation', () => {
  const base = {
    recipientUserId: 'parent-a',
    recipientName: 'Parent A' as string | null,
    teamId: 'team-a',
    teamName: 'Synthetic Team',
    appOrigin: 'https://app.example.test',
    childrenNames: ['Child A'],
    customMessage: ' Welcome back ' as string | undefined,
    clubName: 'Synthetic Club' as string | null | undefined,
    clubLogoUrl: 'https://example.test/logo.png' as string | null | undefined,
    clubContactEmail: 'club@example.test' as string | null | undefined,
    inviteEmailStyle: 'discover' as string | null | undefined,
  };

  it('builds the exact single-child user-targeted request and team deep link', () => {
    expect(buildExistingParentTeamEmailRequest(base)).toEqual({
      body: {
        toUserId: 'parent-a',
        subject: 'Synthetic Club: See which team Child A is in ⚽',
        template: 'team-invite',
        senderName: 'Synthetic Club',
        replyTo: 'club@example.test',
        templateData: {
          recipientName: 'Parent A',
          childrenNames: ['Child A'],
          teamName: 'Synthetic Team',
          clubName: 'Synthetic Club',
          roleName: 'Parent',
          clubLogoUrl: 'https://example.test/logo.png',
          customMessage: 'Welcome back',
          inviteLink: 'https://app.example.test/teams/team-a',
        },
      },
    });
  });

  it('preserves the multi-child subject and all unbranded fallbacks', () => {
    expect(
      buildExistingParentTeamEmailRequest({
        ...base,
        recipientName: null,
        childrenNames: ['Child A', 'Child B'],
        customMessage: undefined,
        clubName: null,
        clubLogoUrl: null,
        clubContactEmail: null,
      }),
    ).toEqual({
      body: expect.objectContaining({
        subject: 'Your club: Your children have been added to Synthetic Team ⚽',
        senderName: undefined,
        replyTo: undefined,
        templateData: expect.objectContaining({ recipientName: 'Parent', clubName: 'The Club', clubLogoUrl: undefined, customMessage: undefined }),
      }),
    });
  });

  it('uses the standard existing-parent wording unless the club selects discover', () => {
    expect(buildExistingParentTeamEmailRequest({ ...base, inviteEmailStyle: 'standard' }).body.subject).toBe(
      'Synthetic Club: Child A has been added to their team ⚽',
    );
  });

  it('invokes the email function once and returns its result unchanged', async () => {
    const response = { data: { success: true, verified: true }, error: null };
    const invoke = vi.fn(async () => response);
    const client = { functions: { invoke } } as LocalMembershipClient;
    await expect(sendExistingParentTeamEmail(base, client)).resolves.toBe(response);
    expect(invoke).toHaveBeenCalledWith('send-email', buildExistingParentTeamEmailRequest(base));
  });

  it("preserves a rejected invocation for the component's best-effort catch path", async () => {
    const error = new Error('function crashed');
    const invoke = vi.fn(async () => { throw error; });
    const client = { functions: { invoke } } as LocalMembershipClient;
    await expect(sendExistingParentTeamEmail(base, client)).rejects.toBe(error);
  });
});

describe('bulk pending team invitation insertion', () => {
  const metadata = {
    children: [{ name: 'Child A', yearOfBirth: 2016, jerseyNumber: 8, existingChildId: 'child-a' }],
    linked_invite_token: 'token-b',
    second_guardian_name: 'Parent B',
    second_guardian_email: 'parent.b@example.test',
  };
  const base = {
    teamId: 'team-a',
    clubId: 'club-a',
    role: 'parent' as const,
    inviterUserId: 'admin-a',
    invitedName: ' Parent A ',
    invitedEmail: ' PARENT.A@EXAMPLE.TEST ',
    inviteToken: 'token-a',
    metadata: metadata as Record<string, unknown> | null,
  };

  it('inserts the exact normalized recipient scope and metadata', async () => {
    const { client, from, insert } = insertClient();
    await expect(createBulkPendingTeamInvite(base, client)).resolves.toEqual({ created: true, error: null });
    expect(from).toHaveBeenCalledWith('pending_invites');
    expect(insert).toHaveBeenCalledWith({
      team_id: 'team-a',
      club_id: 'club-a',
      role: 'parent',
      invited_user_id: null,
      invited_by_user_id: 'admin-a',
      invited_label: 'Parent A',
      invited_email: 'parent.a@example.test',
      invite_token: 'token-a',
      metadata,
    });
  });

  it('normalizes a blank email to null and preserves null metadata', async () => {
    const { client, insert } = insertClient();
    await createBulkPendingTeamInvite({ ...base, role: 'coach', invitedEmail: ' ', metadata: null }, client);
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({ role: 'coach', invited_email: null, metadata: null }));
  });

  it('returns the original insertion failure for per-recipient continue handling', async () => {
    const error = { code: '42501', message: 'bulk invite denied' };
    const { client } = insertClient(error);
    await expect(createBulkPendingTeamInvite(base, client)).resolves.toEqual({ created: false, error });
  });
});

function bulkDeliveryClient(invocation: () => Promise<unknown>, writeError: unknown = null) {
  const invoke = vi.fn(invocation);
  const eq = vi.fn(async () => ({ data: null, error: writeError }));
  const update = vi.fn(() => ({ eq }));
  const from = vi.fn(() => ({ update }));
  return { client: { functions: { invoke }, from } as LocalMembershipClient, invoke, from, update, eq };
}

describe('bulk pending-invite email delivery', () => {
  const base = {
    inviteToken: 'token-a',
    recipientName: ' Parent A ',
    recipientEmail: 'parent@example.test',
    teamName: 'Synthetic Team',
    roleLabel: 'Parent',
    inviteLink: 'https://example.test/join/p/token-a',
    childrenNames: ['Child A'],
    customMessage: ' Welcome ',
    clubName: 'Synthetic Club' as string | null | undefined,
    clubLogoUrl: 'https://example.test/logo.png' as string | null | undefined,
    clubContactEmail: 'club@example.test' as string | null | undefined,
    inviteEmailStyle: 'discover' as string | null | undefined,
  };

  it('records only verified success and preserves the exact bulk request', async () => {
    const { client, invoke, update, eq } = bulkDeliveryClient(async () => ({
      data: { verified: true, success: true, emailId: 'email-a' },
      error: null,
    }));
    await expect(deliverBulkPendingInviteEmail(base, client, () => '2026-08-10T00:00:00.000Z')).resolves.toEqual({
      sent: true,
      emailId: 'email-a',
      emailError: null,
      writeError: null,
    });
    expect(invoke).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({
        body: expect.objectContaining({
          to: 'parent@example.test',
          subject: 'Synthetic Club: See which team Child A is in ⚽',
          templateData: expect.objectContaining({ childrenNames: ['Child A'] }),
        }),
      }),
    );
    expect(update).toHaveBeenCalledWith({ email_sent_at: '2026-08-10T00:00:00.000Z', email_id: 'email-a', email_error: null });
    expect(eq).toHaveBeenCalledWith('invite_token', 'token-a');
  });

  it('preserves an empty children array in the bulk provider payload', async () => {
    const { client, invoke } = bulkDeliveryClient(async () => ({ data: { verified: false, success: false }, error: null }));
    await deliverBulkPendingInviteEmail({ ...base, childrenNames: [] }, client);
    expect(invoke).toHaveBeenCalledWith(
      'send-email',
      expect.objectContaining({ body: expect.objectContaining({ templateData: expect.objectContaining({ childrenNames: [] }) }) }),
    );
  });

  it('records invocation errors using the established function fallback', async () => {
    const { client, update } = bulkDeliveryClient(async () => ({ data: null, error: { message: '' } }));
    await expect(deliverBulkPendingInviteEmail(base, client)).resolves.toEqual(expect.objectContaining({ sent: false, emailError: 'Function error' }));
    expect(update).toHaveBeenCalledWith(expect.objectContaining({ email_sent_at: null, email_error: 'Function error' }));
  });

  it('records unverified provider rejection without retaining an email id', async () => {
    const { client } = bulkDeliveryClient(async () => ({
      data: { verified: true, success: false, emailId: 'rejected-id', error: 'provider rejected' },
      error: null,
    }));
    await expect(deliverBulkPendingInviteEmail(base, client)).resolves.toEqual(
      expect.objectContaining({ sent: false, emailId: null, emailError: 'provider rejected' }),
    );
  });

  it('converts thrown and non-Error invocation failures to tracked errors', async () => {
    const thrown = bulkDeliveryClient(async () => { throw new Error('network failed'); });
    await expect(deliverBulkPendingInviteEmail(base, thrown.client)).resolves.toEqual(expect.objectContaining({ emailError: 'network failed' }));
    const unknown = bulkDeliveryClient(async () => { throw 'offline'; });
    await expect(deliverBulkPendingInviteEmail(base, unknown.client)).resolves.toEqual(expect.objectContaining({ emailError: 'Unknown error' }));
  });

  it('performs no provider or tracking write for a blank email', async () => {
    const { client, invoke, from } = bulkDeliveryClient(async () => ({ data: null, error: null }));
    await expect(deliverBulkPendingInviteEmail({ ...base, recipientEmail: ' ' }, client)).resolves.toEqual({
      sent: false,
      emailId: null,
      emailError: null,
      writeError: null,
    });
    expect(invoke).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('exposes but does not throw a tracking-write failure', async () => {
    const writeError = { code: '42501', message: 'tracking denied' };
    const { client } = bulkDeliveryClient(async () => ({ data: { verified: true, success: true }, error: null }), writeError);
    await expect(deliverBulkPendingInviteEmail(base, client)).resolves.toEqual(expect.objectContaining({ sent: true, writeError }));
  });
});

describe('bulk existing-recipient orchestration', () => {
  const child = { name: ' Child A ', yearOfBirth: '2016', jerseyNumber: '8', existingChildId: 'child-a' };
  const base = {
    userId: 'user-a',
    displayName: 'Existing Parent' as string | null,
    enteredName: ' Entered Parent ',
    enteredEmail: 'Parent@Example.test',
    teamId: 'team-a',
    teamName: 'Synthetic Team',
    clubId: 'club-a',
    inviterUserId: 'admin-a',
    role: 'parent' as const,
    roleLabel: 'Parent' as string | undefined,
    children: [child],
    clubChildren: [{ id: 'child-a', parent_id: 'original-parent', year_of_birth: 2016 }],
    selectedSecondGuardian: null as { id: string } | null,
    secondGuardianName: '',
    secondGuardianEmail: '',
    appOrigin: 'https://example.test',
    clubName: 'Synthetic Club' as string | null | undefined,
    clubLogoUrl: 'https://example.test/logo.png' as string | null | undefined,
    clubContactEmail: 'club@example.test' as string | null | undefined,
  };

  function operations() {
    const assignRole = vi.fn(async () => ({ assigned: true, roleWasDuplicate: false, error: null }));
    const processChildren = vi.fn(async () => [{ childName: 'Child A', childId: 'child-a', status: 'processed' as const, error: null }]);
    const addSelectedSecondGuardian = vi.fn(async () => ({ roleError: null, guardianErrors: [] }));
    const invitePendingSecondGuardian = vi.fn(async () => ({ inviteToken: 'guardian-token', inviteError: null, emailError: null }));
    const completeMember = vi.fn(async () => ({
      notificationError: null,
      memberResult: {
        name: 'Existing Parent',
        email: 'Parent@Example.test',
        link: 'https://example.test/teams/team-a',
        sent: true as const,
        role: 'parent' as const,
        childrenCount: 1,
      },
    }));
    return { assignRole, processChildren, addSelectedSecondGuardian, invitePendingSecondGuardian, completeMember };
  }

  it('stops the recipient before child, guardian and completion work when role assignment fails', async () => {
    const ops = operations();
    const error = { code: '42501', message: 'role denied' };
    ops.assignRole.mockResolvedValue({ assigned: false, roleWasDuplicate: false, error });

    await expect(processBulkExistingRecipient(base, ops as any)).resolves.toEqual({
      memberResult: null,
      roleResult: { assigned: false, roleWasDuplicate: false, error },
      childOutcomes: [],
      selectedSecondGuardianResult: null,
      pendingSecondGuardianResult: null,
      notificationError: null,
    });
    expect(ops.processChildren).not.toHaveBeenCalled();
    expect(ops.completeMember).not.toHaveBeenCalled();
  });

  it('processes parent children before an exact selected second guardian and completion', async () => {
    const ops = operations();
    const order: string[] = [];
    ops.assignRole.mockImplementation(async () => { order.push('role'); return { assigned: true, roleWasDuplicate: false, error: null }; });
    ops.processChildren.mockImplementation(async () => { order.push('children'); return []; });
    ops.addSelectedSecondGuardian.mockImplementation(async () => { order.push('guardian'); return { roleError: null, guardianErrors: [] }; });
    ops.completeMember.mockImplementation(async () => {
      order.push('complete');
      return {
        notificationError: null,
        memberResult: { name: 'Existing Parent', email: 'Parent@Example.test', link: 'https://example.test/teams/team-a', sent: true as const, role: 'parent' as const, childrenCount: 1 },
      };
    });

    const outcome = await processBulkExistingRecipient({ ...base, selectedSecondGuardian: { id: 'guardian-a' } }, ops as any);
    expect(order).toEqual(['role', 'children', 'guardian', 'complete']);
    expect(ops.addSelectedSecondGuardian).toHaveBeenCalledWith({
      secondGuardianUserId: 'guardian-a',
      teamId: 'team-a',
      clubId: 'club-a',
      children: [child],
    });
    expect(ops.invitePendingSecondGuardian).not.toHaveBeenCalled();
    expect(outcome.memberResult?.childrenCount).toBe(1);
  });

  it('uses the pending second-guardian path only when both identity fields are nonblank', async () => {
    const ops = operations();
    await processBulkExistingRecipient({ ...base, secondGuardianName: ' Second Parent ', secondGuardianEmail: ' SECOND@EXAMPLE.TEST ' }, ops as any);
    expect(ops.invitePendingSecondGuardian).toHaveBeenCalledWith({
      teamId: 'team-a',
      clubId: 'club-a',
      inviterUserId: 'admin-a',
      guardianName: ' Second Parent ',
      guardianEmail: ' SECOND@EXAMPLE.TEST ',
      children: [child],
      teamName: 'Synthetic Team',
      appOrigin: 'https://example.test',
      clubName: 'Synthetic Club',
      clubLogoUrl: 'https://example.test/logo.png',
      clubContactEmail: 'club@example.test',
    });
    expect(ops.addSelectedSecondGuardian).not.toHaveBeenCalled();
  });

  it('skips every parent-only operation for a non-parent and preserves completion inputs', async () => {
    const ops = operations();
    ops.completeMember.mockResolvedValue({
      notificationError: null,
      memberResult: { name: 'Existing Coach', email: 'coach@example.test', link: 'https://example.test/teams/team-a', sent: true as const, role: 'coach' as const, childrenCount: 0 },
    });
    await processBulkExistingRecipient(
      { ...base, role: 'coach', roleLabel: 'Coach', children: [], selectedSecondGuardian: { id: 'ignored-guardian' } },
      ops as any,
    );
    expect(ops.processChildren).not.toHaveBeenCalled();
    expect(ops.addSelectedSecondGuardian).not.toHaveBeenCalled();
    expect(ops.invitePendingSecondGuardian).not.toHaveBeenCalled();
    expect(ops.completeMember).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-a', role: 'coach', roleLabel: 'Coach', childrenCount: 0 }));
  });
});
