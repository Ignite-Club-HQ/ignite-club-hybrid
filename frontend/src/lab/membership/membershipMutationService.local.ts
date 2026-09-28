/**
 * Local, synthetic-mock-client port of the exported
 * `src/features/membership/membershipMutationService.ts` service module
 * (101 bundle test cases). Unlike the RLS ports in `src/lab/rls/`, this
 * module needs no Postgres policy archaeology: every exported function
 * here is pure application logic operating over an injected, already-mocked
 * Supabase-shaped client (`insert`/`select().eq().maybeSingle()`/`update`/
 * `rpc`/`functions.invoke`) - the exact same pattern the bundle's own test
 * doubles use. The control flow, error-classification, and payload-shaping
 * logic below is a line-for-line behavioral port of that module.
 *
 * `LocalMembershipClient` intentionally types query builders loosely
 * (matching the bundle test's own ad-hoc mock shapes) rather than importing
 * `@supabase/supabase-js` types, since this lab never talks to a live or
 * disposable Supabase instance for this feature - callers always inject a
 * synthetic in-memory or `vi.fn()`-based double.
 */

export type TeamRole = 'player' | 'parent' | 'coach' | 'team_admin' | 'club_admin' | 'committee_member' | string;

export interface MembershipWriteError {
  code?: string | null;
  message?: string | null;
}

export interface LocalMembershipClient {
  from?: (table: string) => any;
  rpc?: (name: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;
  functions?: { invoke: (name: string, payload: unknown) => Promise<{ data: unknown; error: unknown }> };
}

export function isDuplicateMembershipError(error: MembershipWriteError | null | undefined): boolean {
  const message = error?.message?.toLowerCase() ?? '';
  return error?.code === '23505' || message.includes('duplicate') || message.includes('unique constraint');
}

function isDuplicateChildError(error: any): boolean {
  return (
    error?.code === '23505' ||
    (typeof error?.message === 'string' && error.message.includes('duplicate_child_for_parent'))
  );
}

export interface ExistingTeamRoleAssignment {
  userId: string;
  teamId: string;
  clubId: string;
  role: TeamRole;
}

export interface ExistingTeamRoleAssignmentResult {
  roleWasDuplicate: boolean;
}

export async function assignExistingTeamRole(
  assignment: ExistingTeamRoleAssignment,
  client: LocalMembershipClient,
): Promise<ExistingTeamRoleAssignmentResult> {
  const { error } = await client.from!('user_roles').insert({
    user_id: assignment.userId,
    team_id: assignment.teamId,
    club_id: assignment.clubId,
    role: assignment.role,
  });
  const roleWasDuplicate = isDuplicateMembershipError(error);
  if (error && !roleWasDuplicate) throw error;
  return { roleWasDuplicate };
}

export interface BulkExistingTeamRoleResult {
  assigned: boolean;
  roleWasDuplicate: boolean;
  error: MembershipWriteError | null;
}

export async function assignBulkExistingTeamRole(
  assignment: ExistingTeamRoleAssignment,
  client: LocalMembershipClient = {},
): Promise<BulkExistingTeamRoleResult> {
  const { error } = await client.from!('user_roles').insert({
    user_id: assignment.userId,
    team_id: assignment.teamId,
    club_id: assignment.clubId,
    role: assignment.role,
  });
  const roleWasDuplicate = isDuplicateMembershipError(error);
  return {
    assigned: !error || roleWasDuplicate,
    roleWasDuplicate,
    error: error && !roleWasDuplicate ? (error as MembershipWriteError) : null,
  };
}

export interface GuardianLinkInput {
  childId: string;
  guardianId: string;
  primaryParentId: string | null;
}

export interface GuardianLinkResult {
  status: 'primary-parent' | 'linked' | 'already-linked';
}

export async function linkGuardianToExistingChild(
  input: GuardianLinkInput,
  client: LocalMembershipClient = {},
): Promise<GuardianLinkResult> {
  if (input.primaryParentId === input.guardianId) {
    return { status: 'primary-parent' };
  }
  const { error } = await client.from!('child_guardians').insert({
    child_id: input.childId,
    guardian_id: input.guardianId,
  });
  if (error && !isDuplicateChildError(error)) throw error;
  return { status: error ? 'already-linked' : 'linked' };
}

export interface ChildCreationInput {
  parentUserId: string;
  teamId: string;
  name: string;
  yearOfBirth: string;
}

export async function createChildForParentOnTeam(
  input: ChildCreationInput,
  client: LocalMembershipClient = {},
): Promise<string | null> {
  const { data, error } = await client.rpc!('create_child_for_parent_on_team', {
    p_parent_user_id: input.parentUserId,
    p_team_id: input.teamId,
    p_name: input.name.trim(),
    p_year_of_birth: input.yearOfBirth ? parseInt(input.yearOfBirth, 10) : undefined,
  });
  if (error) throw error;
  return data as string | null;
}

export interface ChildTeamAssignmentInput {
  childId: string;
  teamId: string;
}

export type ChildTeamAssignmentResult = 'already-assigned' | 'assigned';

export async function ensureChildTeamAssignment(
  input: ChildTeamAssignmentInput,
  client: LocalMembershipClient = {},
): Promise<ChildTeamAssignmentResult> {
  const { data: existing } = await client
    .from!('child_team_assignments')
    .select('id')
    .eq('child_id', input.childId)
    .eq('team_id', input.teamId)
    .maybeSingle();
  if (existing) return 'already-assigned';

  const { error } = await client.from!('child_team_assignments').insert({
    child_id: input.childId,
    team_id: input.teamId,
  });
  if (error) throw error;
  return 'assigned';
}

export async function ensureBulkChildTeamAssignmentBestEffort(
  input: ChildTeamAssignmentInput,
  client: LocalMembershipClient = {},
): Promise<'already-assigned' | 'insert-attempted'> {
  const { data: existing } = await client
    .from!('child_team_assignments')
    .select('id')
    .eq('child_id', input.childId)
    .eq('team_id', input.teamId)
    .maybeSingle();
  if (existing) return 'already-assigned';
  await client.from!('child_team_assignments').insert({ child_id: input.childId, team_id: input.teamId });
  return 'insert-attempted';
}

export interface ChildJerseyInput extends ChildTeamAssignmentInput {
  jerseyNumber: string;
}

export type ChildJerseyResult = 'not-provided' | 'invalid' | 'inserted' | 'updated';

export async function persistChildJerseyPosition(
  input: ChildJerseyInput,
  client: LocalMembershipClient = {},
): Promise<ChildJerseyResult> {
  if (!input.jerseyNumber) return 'not-provided';
  const jerseyNumber = parseInt(input.jerseyNumber, 10);
  if (Number.isNaN(jerseyNumber)) return 'invalid';

  const { data: existing } = await client
    .from!('team_player_positions')
    .select('id')
    .eq('team_id', input.teamId)
    .eq('child_id', input.childId)
    .maybeSingle();

  if (existing) {
    await client.from!('team_player_positions').update({ jersey_number: jerseyNumber }).eq('id', (existing as any).id);
    return 'updated';
  }

  await client.from!('team_player_positions').insert({
    team_id: input.teamId,
    child_id: input.childId,
    position: 'MID',
    jersey_number: jerseyNumber,
  });
  return 'inserted';
}

export interface ExistingSecondParentInput {
  userId: string;
  teamId: string;
  clubId: string;
  teamName: string;
  childIds: string[];
}

export interface ExistingSecondParentResult {
  roleError: MembershipWriteError | null;
  guardianErrors: Array<{ childId: string; error: MembershipWriteError }>;
  notificationError: MembershipWriteError | null;
}

export async function addExistingSecondParent(
  input: ExistingSecondParentInput,
  client: LocalMembershipClient,
): Promise<ExistingSecondParentResult> {
  const { error: rawRoleError } = await client.from!('user_roles').insert({
    user_id: input.userId,
    team_id: input.teamId,
    club_id: input.clubId,
    role: 'parent',
  });
  const roleError = rawRoleError && !isDuplicateMembershipError(rawRoleError) ? rawRoleError : null;

  const guardianErrors: ExistingSecondParentResult['guardianErrors'] = [];
  for (const childId of input.childIds) {
    const { error } = await client
      .from!('child_guardians')
      .insert({ child_id: childId, guardian_id: input.userId })
      .select()
      .maybeSingle();
    if (error) guardianErrors.push({ childId, error });
  }

  const { error: notificationError } = await client.from!('notifications').insert({
    user_id: input.userId,
    type: 'membership',
    message: `You have been added to ${input.teamName} as Parent`,
    related_id: input.teamId,
  });

  return { roleError: (roleError as MembershipWriteError) ?? null, guardianErrors, notificationError: (notificationError as MembershipWriteError) ?? null };
}

export interface ExistingMemberNotificationInput {
  userId: string;
  teamId: string;
  teamName: string;
  roleLabel: string | undefined;
}

export interface ExistingMemberNotificationResult {
  notificationFailed: boolean;
  notificationError: string | null;
}

export async function notifyExistingTeamMember(
  input: ExistingMemberNotificationInput,
  client: LocalMembershipClient,
): Promise<ExistingMemberNotificationResult> {
  const { error } = await client.from!('notifications').insert({
    user_id: input.userId,
    type: 'membership',
    message: `You have been added to ${input.teamName} as ${input.roleLabel}`,
    related_id: input.teamId,
  });
  return { notificationFailed: Boolean(error), notificationError: (error as MembershipWriteError | null)?.message ?? null };
}

export interface ExistingClubChildInput {
  id: string;
  parent_id: string | null;
  year_of_birth: number | null;
}

export interface ExistingParentChildInput {
  name: string;
  yearOfBirth: string;
  jerseyNumber: string;
  existingChildId?: string;
  pendingInviteId?: string;
}

export interface ResolvedMembershipChild {
  id: string;
  name: string;
  yearOfBirth: number | null;
}

export interface ExistingParentChildrenResult {
  childIds: string[];
  resolvedChildren: ResolvedMembershipChild[];
}

export interface ExistingParentChildOperations {
  linkGuardian: typeof linkGuardianToExistingChild;
  createChild: typeof createChildForParentOnTeam;
  ensureAssignment: typeof ensureChildTeamAssignment;
  persistJersey: typeof persistChildJerseyPosition;
}

export async function processExistingParentChildren(
  input: {
    parentUserId: string;
    teamId: string;
    teamName: string;
    children: ExistingParentChildInput[];
    clubChildren: ExistingClubChildInput[];
  },
  operations: ExistingParentChildOperations,
): Promise<ExistingParentChildrenResult> {
  const childIds: string[] = [];
  const resolvedChildren: ResolvedMembershipChild[] = [];

  for (const child of input.children.filter((candidate) => candidate.name.trim())) {
    if (child.pendingInviteId) continue;
    let childId = child.existingChildId;

    if (childId) {
      const existingChild = input.clubChildren.find((candidate) => candidate.id === childId);
      if (existingChild) {
        await operations.linkGuardian({
          childId,
          guardianId: input.parentUserId,
          primaryParentId: existingChild.parent_id,
        });
      }
    } else {
      try {
        childId =
          (await operations.createChild({
            parentUserId: input.parentUserId,
            teamId: input.teamId,
            name: child.name,
            yearOfBirth: child.yearOfBirth,
          })) ?? undefined;
      } catch (error) {
        throw new Error(`We couldn't save ${child.name.trim()}. ${(error as { message?: string }).message}`);
      }
    }

    if (!childId) continue;
    childIds.push(childId);
    const existingChild = input.clubChildren.find((candidate) => candidate.id === childId);
    resolvedChildren.push({
      id: childId,
      name: child.name.trim(),
      yearOfBirth: existingChild?.year_of_birth ?? (child.yearOfBirth ? parseInt(child.yearOfBirth, 10) : null),
    });

    try {
      await operations.ensureAssignment({ childId, teamId: input.teamId });
    } catch {
      throw new Error(`We saved ${child.name.trim()}, but couldn't add them to ${input.teamName}. Please try again.`);
    }
    await operations.persistJersey({ childId, teamId: input.teamId, jerseyNumber: child.jerseyNumber });
  }

  return { childIds, resolvedChildren };
}

export interface BulkExistingParentChildOutcome {
  childName: string;
  childId: string | null;
  status: 'pending-skipped' | 'processed' | 'creation-failed';
  error: unknown | null;
}

export interface BulkExistingParentChildOperations {
  linkGuardian: typeof linkGuardianToExistingChild;
  createChild: typeof createChildForParentOnTeam;
  ensureAssignment: typeof ensureBulkChildTeamAssignmentBestEffort;
}

export async function processBulkExistingParentChildren(
  input: {
    parentUserId: string;
    teamId: string;
    children: ExistingParentChildInput[];
    clubChildren: ExistingClubChildInput[];
  },
  operations: BulkExistingParentChildOperations,
): Promise<BulkExistingParentChildOutcome[]> {
  const outcomes: BulkExistingParentChildOutcome[] = [];
  for (const child of input.children.filter((candidate) => candidate.name.trim())) {
    const childName = child.name.trim();
    if (child.pendingInviteId) {
      outcomes.push({ childName, childId: null, status: 'pending-skipped', error: null });
      continue;
    }

    let childId = child.existingChildId ?? null;
    if (childId) {
      const existingChild = input.clubChildren.find((candidate) => candidate.id === childId);
      if (existingChild) {
        await operations.linkGuardian({
          childId,
          guardianId: input.parentUserId,
          primaryParentId: existingChild.parent_id,
        });
      }
    } else {
      try {
        childId = await operations.createChild({
          parentUserId: input.parentUserId,
          teamId: input.teamId,
          name: child.name,
          yearOfBirth: child.yearOfBirth,
        });
      } catch (error) {
        outcomes.push({ childName, childId: null, status: 'creation-failed', error });
        continue;
      }
    }

    if (childId) {
      await operations.ensureAssignment({ childId, teamId: input.teamId });
    }
    outcomes.push({ childName, childId, status: 'processed', error: null });
  }
  return outcomes;
}

export interface BulkSelectedSecondGuardianResult {
  roleError: MembershipWriteError | null;
  guardianErrors: Array<{ childId: string; error: MembershipWriteError }>;
}

export async function addBulkSelectedSecondGuardian(
  input: { secondGuardianUserId: string; teamId: string; clubId: string; children: ExistingParentChildInput[] },
  client: LocalMembershipClient = {},
): Promise<BulkSelectedSecondGuardianResult> {
  const { error: roleError } = await client
    .from!('user_roles')
    .insert({ user_id: input.secondGuardianUserId, team_id: input.teamId, club_id: input.clubId, role: 'parent' })
    .select()
    .maybeSingle();

  const guardianErrors: BulkSelectedSecondGuardianResult['guardianErrors'] = [];
  for (const child of input.children) {
    if (!child.existingChildId) continue;
    const { error } = await client
      .from!('child_guardians')
      .insert({ child_id: child.existingChildId, guardian_id: input.secondGuardianUserId })
      .select()
      .maybeSingle();
    if (error) guardianErrors.push({ childId: child.existingChildId, error: error as MembershipWriteError });
  }

  return { roleError: (roleError as MembershipWriteError) ?? null, guardianErrors };
}

export interface BulkPendingSecondGuardianResult {
  inviteToken: string;
  inviteError: MembershipWriteError | null;
  emailError: unknown | null;
}

export async function inviteBulkPendingSecondGuardian(
  input: {
    teamId: string;
    clubId: string;
    inviterUserId: string;
    guardianName: string;
    guardianEmail: string;
    children: ExistingParentChildInput[];
    teamName: string;
    appOrigin: string;
    clubName: string | null | undefined;
    clubLogoUrl: string | null | undefined;
    clubContactEmail: string | null | undefined;
    inviteEmailStyle?: string | null;
  },
  client: LocalMembershipClient = {},
  createToken: () => string = () => crypto.randomUUID(),
): Promise<BulkPendingSecondGuardianResult> {
  const inviteToken = createToken();
  const existingChildIds = input.children.map((child) => child.existingChildId).filter((id): id is string => Boolean(id));
  const normalizedName = input.guardianName.trim();
  const normalizedEmail = input.guardianEmail.trim().toLowerCase();
  const { error: inviteError } = await client.from!('pending_invites').insert({
    team_id: input.teamId,
    club_id: input.clubId,
    role: 'parent',
    invited_user_id: null,
    invited_by_user_id: input.inviterUserId,
    invited_label: normalizedName,
    invited_email: normalizedEmail,
    invite_token: inviteToken,
    metadata: {
      guardian_child_id: existingChildIds[0] || null,
      guardian_all_team_ids: [input.teamId],
      invited_by_parent: true,
      children: input.children.map((child) => ({ name: child.name.trim(), existingChildId: child.existingChildId || null })),
    },
  });

  let emailError: unknown | null = null;
  try {
    const { error } = await client.functions!.invoke('send-email', {
      body: {
        to: normalizedEmail,
        subject: `${input.clubName || 'Your club'}: You've been invited as a guardian ⚽`,
        template: 'team-invite',
        senderName: input.clubName || undefined,
        replyTo: input.clubContactEmail || undefined,
        templateData: {
          recipientName: normalizedName,
          invitedEmail: normalizedEmail,
          teamName: input.teamName,
          clubName: input.clubName || 'The Club',
          roleName: 'Parent',
          inviteLink: `${input.appOrigin}/join/p/${inviteToken}`,
          clubLogoUrl: input.clubLogoUrl || undefined,
          childrenNames: input.children.map((child) => child.name.trim()),
        },
      },
    });
    emailError = error;
  } catch (error) {
    emailError = error;
  }

  return { inviteToken, inviteError: (inviteError as MembershipWriteError) ?? null, emailError };
}

export interface BulkExistingMemberCompletionResult {
  notificationError: MembershipWriteError | null;
  memberResult: { name: string; email: string; link: string; sent: true; role: TeamRole; childrenCount: number };
}

export async function completeBulkExistingMember(
  input: {
    userId: string;
    displayName: string | null;
    enteredName: string;
    enteredEmail: string;
    teamId: string;
    teamName: string;
    appOrigin: string;
    role: TeamRole;
    roleLabel: string | undefined;
    childrenCount: number;
  },
  client: LocalMembershipClient = {},
): Promise<BulkExistingMemberCompletionResult> {
  const { error: notificationError } = await client.from!('notifications').insert({
    user_id: input.userId,
    type: 'membership',
    message: `You have been added to ${input.teamName} as ${input.roleLabel}`,
    related_id: input.teamId,
  });

  return {
    notificationError: (notificationError as MembershipWriteError) ?? null,
    memberResult: {
      name: input.displayName || input.enteredName.trim(),
      email: input.enteredEmail.trim(),
      link: `${input.appOrigin}/teams/${input.teamId}`,
      sent: true,
      role: input.role,
      childrenCount: input.childrenCount,
    },
  };
}

export interface BulkPendingRecipientResult {
  name: string;
  email: string;
  link: string;
  sent: boolean;
  role: TeamRole;
  childrenCount: number;
}

export interface BulkPendingTeamInviteResult {
  created: boolean;
  error: MembershipWriteError | null;
}

export async function createBulkPendingTeamInvite(
  input: {
    teamId: string;
    clubId: string;
    role: TeamRole;
    inviterUserId: string;
    invitedName: string;
    invitedEmail: string;
    inviteToken: string;
    metadata: Record<string, unknown> | null;
  },
  client: LocalMembershipClient = {},
): Promise<BulkPendingTeamInviteResult> {
  const { error } = await client.from!('pending_invites').insert({
    team_id: input.teamId,
    club_id: input.clubId,
    role: input.role,
    invited_user_id: null,
    invited_by_user_id: input.inviterUserId,
    invited_label: input.invitedName.trim(),
    invited_email: input.invitedEmail.trim().toLowerCase() || null,
    invite_token: input.inviteToken,
    metadata: input.metadata,
  });
  return { created: !error, error: (error as MembershipWriteError) ?? null };
}

export interface PendingTeamInviteEmailInput {
  recipientName: string;
  recipientEmail: string;
  teamName: string;
  roleLabel: string;
  inviteLink: string;
  childrenNames: string[];
  customMessage: string;
  clubName: string | null | undefined;
  clubLogoUrl: string | null | undefined;
  clubContactEmail: string | null | undefined;
  inviteEmailStyle?: string | null;
}

export interface PendingTeamInviteEmailRequest {
  body: {
    to: string;
    subject: string;
    template: 'team-invite';
    senderName: string | undefined;
    replyTo: string | undefined;
    templateData: {
      recipientName: string;
      invitedEmail: string;
      teamName: string;
      clubName: string;
      roleName: string;
      inviteLink: string;
      clubLogoUrl: string | undefined;
      childrenNames: string[] | undefined;
      customMessage: string | undefined;
    };
  };
}

export function buildPendingTeamInviteEmailRequest(input: PendingTeamInviteEmailInput): PendingTeamInviteEmailRequest {
  const clubSubjectName = input.clubName || 'Your club';
  const discoverStyle = input.inviteEmailStyle === 'discover';
  const subject =
    input.childrenNames.length === 1
      ? discoverStyle
        ? `${clubSubjectName}: See which team ${input.childrenNames[0]} is in ⚽`
        : `${clubSubjectName}: ${input.childrenNames[0]} has been added to their team ⚽`
      : input.childrenNames.length > 1
        ? discoverStyle
          ? `${clubSubjectName}: See which team your kids are in ⚽`
          : `${clubSubjectName}: Your children have been added to their team ⚽`
        : `${clubSubjectName}: You've been added to the team ⚽`;

  return {
    body: {
      to: input.recipientEmail,
      subject,
      template: 'team-invite',
      senderName: input.clubName || undefined,
      replyTo: input.clubContactEmail || undefined,
      templateData: {
        recipientName: input.recipientName.trim(),
        invitedEmail: input.recipientEmail,
        teamName: input.teamName,
        clubName: input.clubName || 'The Club',
        roleName: input.roleLabel,
        inviteLink: input.inviteLink,
        clubLogoUrl: input.clubLogoUrl || undefined,
        childrenNames: input.childrenNames.length > 0 ? input.childrenNames : undefined,
        customMessage: input.customMessage.trim() || undefined,
      },
    },
  };
}

export async function sendPendingTeamInviteEmail(
  input: PendingTeamInviteEmailInput,
  client: LocalMembershipClient,
): Promise<{ providerResult: unknown; invocationError: unknown }> {
  const { data, error } = await client.functions!.invoke('send-email', buildPendingTeamInviteEmailRequest(input));
  return { providerResult: data, invocationError: error };
}

export interface ExistingParentTeamEmailInput {
  recipientUserId: string;
  recipientName: string | null;
  teamId: string;
  teamName: string;
  appOrigin: string;
  childrenNames: string[];
  customMessage?: string;
  clubName: string | null | undefined;
  clubLogoUrl: string | null | undefined;
  clubContactEmail: string | null | undefined;
  inviteEmailStyle?: string | null;
}

export function buildExistingParentTeamEmailRequest(input: ExistingParentTeamEmailInput) {
  const subject =
    input.childrenNames.length === 1
      ? input.inviteEmailStyle === 'discover'
        ? `${input.clubName || 'Your club'}: See which team ${input.childrenNames[0]} is in ⚽`
        : `${input.clubName || 'Your club'}: ${input.childrenNames[0]} has been added to their team ⚽`
      : `${input.clubName || 'Your club'}: Your children have been added to ${input.teamName} ⚽`;

  return {
    body: {
      toUserId: input.recipientUserId,
      subject,
      template: 'team-invite' as const,
      senderName: input.clubName || undefined,
      replyTo: input.clubContactEmail || undefined,
      templateData: {
        recipientName: input.recipientName || 'Parent',
        childrenNames: input.childrenNames,
        teamName: input.teamName,
        clubName: input.clubName || 'The Club',
        roleName: 'Parent',
        clubLogoUrl: input.clubLogoUrl || undefined,
        customMessage: input.customMessage?.trim() || undefined,
        inviteLink: `${input.appOrigin}/teams/${input.teamId}`,
      },
    },
  };
}

export async function sendExistingParentTeamEmail(input: ExistingParentTeamEmailInput, client: LocalMembershipClient) {
  return client.functions!.invoke('send-email', buildExistingParentTeamEmailRequest(input));
}

export interface PendingInviteChildMetadata {
  name: string;
  yearOfBirth: number | null;
  existingChildId: string | null;
}

export interface PendingTeamInviteInput {
  teamId: string;
  clubId: string;
  role: TeamRole;
  inviterUserId: string;
  invitedName: string;
  invitedEmail: string;
  inviteToken: string;
  children: ExistingParentChildInput[];
  linkedSecondParentToken: string | null;
  selectedSecondParentId: string | null;
}

export interface PendingTeamInviteResult {
  invite: { id: string; short_code: string | null } | null;
  childrenMetadata: PendingInviteChildMetadata[] | null;
}

export async function createPendingTeamInvite(
  input: PendingTeamInviteInput,
  client: LocalMembershipClient,
): Promise<PendingTeamInviteResult> {
  const validChildren = input.role === 'parent' ? input.children.filter((child) => child.name.trim()) : [];
  const childrenMetadata = validChildren.length
    ? validChildren.map((child) => ({
        name: child.name.trim(),
        yearOfBirth: child.yearOfBirth ? parseInt(child.yearOfBirth, 10) : null,
        existingChildId: child.existingChildId || null,
      }))
    : null;

  const metadata = childrenMetadata
    ? {
        children: childrenMetadata,
        ...(input.linkedSecondParentToken ? { linked_invite_token: input.linkedSecondParentToken } : {}),
        ...(input.selectedSecondParentId ? { second_parent_user_id: input.selectedSecondParentId } : {}),
      }
    : null;

  const { data, error } = await client
    .from!('pending_invites')
    .insert({
      team_id: input.teamId,
      club_id: input.clubId,
      role: input.role,
      invited_user_id: null,
      invited_by_user_id: input.inviterUserId,
      invited_label: input.invitedName.trim(),
      invited_email: input.invitedEmail.trim().toLowerCase() || null,
      invite_token: input.inviteToken,
      metadata,
    })
    .select('id, short_code')
    .single();
  if (error) throw error;
  return { invite: data as PendingTeamInviteResult['invite'], childrenMetadata };
}

export interface PendingSecondParentInviteInput {
  teamId: string;
  clubId: string;
  inviterUserId: string;
  invitedName: string;
  invitedEmail: string;
  inviteToken: string;
  primaryInviteToken: string;
  childrenMetadata: PendingInviteChildMetadata[] | null;
}

export interface PendingSecondParentInviteResult {
  created: boolean;
  error: MembershipWriteError | null;
}

export async function createPendingSecondParentInvite(
  input: PendingSecondParentInviteInput,
  client: LocalMembershipClient,
): Promise<PendingSecondParentInviteResult> {
  const { error } = await client.from!('pending_invites').insert({
    team_id: input.teamId,
    club_id: input.clubId,
    role: 'parent',
    invited_user_id: null,
    invited_by_user_id: input.inviterUserId,
    invited_label: input.invitedName.trim(),
    invited_email: input.invitedEmail.trim().toLowerCase(),
    invite_token: input.inviteToken,
    metadata: input.childrenMetadata
      ? { children: input.childrenMetadata, linked_invite_token: input.primaryInviteToken }
      : null,
  });
  return { created: !error, error: (error as MembershipWriteError) ?? null };
}

export interface PendingInviteEmailProviderResult {
  verified?: boolean | null;
  success?: boolean | null;
  emailId?: string | null;
  error?: string | null;
}

export interface PendingInviteEmailDeliveryInput {
  inviteToken: string;
  providerResult: PendingInviteEmailProviderResult | null;
  invocationError: MembershipWriteError | null;
  invocationErrorPolicy?: 'preserve-message' | 'provider-fallback';
}

export interface PendingInviteEmailDeliveryResult {
  emailSent: boolean;
  emailId: string | null;
  emailError: string | null;
  writeError: MembershipWriteError | null;
}

export async function recordPendingInviteEmailDelivery(
  input: PendingInviteEmailDeliveryInput,
  client: LocalMembershipClient,
  now: () => string = () => new Date().toISOString(),
): Promise<PendingInviteEmailDeliveryResult> {
  const emailSent = Boolean(!input.invocationError && input.providerResult?.verified && input.providerResult?.success);
  const emailId = input.providerResult?.emailId || null;
  const providerFallback = !emailSent ? input.providerResult?.error || 'Email not verified' : null;
  const emailError =
    input.invocationError && input.invocationErrorPolicy !== 'provider-fallback'
      ? input.invocationError.message || providerFallback
      : providerFallback;

  const { error: writeError } = await client
    .from!('pending_invites')
    .update({ email_sent_at: emailSent ? now() : null, email_id: emailId, email_error: emailError })
    .eq('invite_token', input.inviteToken);

  return { emailSent, emailId, emailError: emailError ?? null, writeError: (writeError as MembershipWriteError) ?? null };
}

export interface BulkPendingInviteEmailInput extends PendingTeamInviteEmailInput {
  inviteToken: string;
}

export interface BulkPendingInviteEmailResult {
  sent: boolean;
  emailId: string | null;
  emailError: string | null;
  writeError: MembershipWriteError | null;
}

export async function deliverBulkPendingInviteEmail(
  input: BulkPendingInviteEmailInput,
  client: LocalMembershipClient = {},
  now: () => string = () => new Date().toISOString(),
): Promise<BulkPendingInviteEmailResult> {
  if (!input.recipientEmail.trim()) {
    return { sent: false, emailId: null, emailError: null, writeError: null };
  }

  let sent = false;
  let emailId: string | null = null;
  let emailError: string | null = null;
  try {
    const request = buildPendingTeamInviteEmailRequest(input);
    request.body.templateData.childrenNames = input.childrenNames;
    const { data, error } = await client.functions!.invoke('send-email', request);
    const providerResult = data as PendingInviteEmailProviderResult | null;
    if (error) {
      emailError = (error as MembershipWriteError).message || 'Function error';
    } else if (providerResult?.verified && providerResult?.success) {
      sent = true;
      emailId = providerResult.emailId || null;
    } else {
      emailError = providerResult?.error || 'Email not verified';
    }
  } catch (error) {
    emailError = error instanceof Error ? error.message : 'Unknown error';
  }

  const { error: writeError } = await client
    .from!('pending_invites')
    .update({ email_sent_at: sent ? now() : null, email_id: emailId, email_error: emailError })
    .eq('invite_token', input.inviteToken);

  return { sent, emailId, emailError, writeError: (writeError as MembershipWriteError) ?? null };
}

export interface BulkPendingRecipientOutcome {
  memberResult: BulkPendingRecipientResult | null;
  inviteError: MembershipWriteError | null;
  deliveryResult: BulkPendingInviteEmailResult | null;
}

export interface BulkPendingRecipientOperations {
  createInvite: typeof createBulkPendingTeamInvite;
  deliverEmail: typeof deliverBulkPendingInviteEmail;
}

export async function processBulkPendingRecipient(
  input: {
    teamId: string;
    teamName: string;
    clubId: string;
    inviterUserId: string;
    role: TeamRole;
    roleLabel: string;
    invitedName: string;
    invitedEmail: string;
    inviteToken: string;
    metadata: Record<string, unknown> | null;
    childrenNames: string[];
    customMessage: string;
    appOrigin: string;
    clubName: string | null | undefined;
    clubLogoUrl: string | null | undefined;
    clubContactEmail: string | null | undefined;
    inviteEmailStyle?: string | null;
  },
  operations: BulkPendingRecipientOperations,
): Promise<BulkPendingRecipientOutcome> {
  const { error: inviteError } = await operations.createInvite({
    teamId: input.teamId,
    clubId: input.clubId,
    role: input.role,
    inviterUserId: input.inviterUserId,
    invitedName: input.invitedName,
    invitedEmail: input.invitedEmail,
    inviteToken: input.inviteToken,
    metadata: input.metadata,
  });
  if (inviteError) {
    return { memberResult: null, inviteError, deliveryResult: null };
  }

  const link = `${input.appOrigin}/join/p/${input.inviteToken}`;
  const deliveryResult = await operations.deliverEmail({
    inviteToken: input.inviteToken,
    recipientName: input.invitedName,
    recipientEmail: input.invitedEmail.trim(),
    teamName: input.teamName,
    roleLabel: input.roleLabel,
    inviteLink: link,
    childrenNames: input.childrenNames,
    customMessage: input.customMessage,
    clubName: input.clubName,
    clubLogoUrl: input.clubLogoUrl,
    clubContactEmail: input.clubContactEmail,
    inviteEmailStyle: input.inviteEmailStyle,
  });

  return {
    inviteError: null,
    deliveryResult,
    memberResult: {
      name: input.invitedName.trim(),
      email: input.invitedEmail.trim(),
      link,
      sent: deliveryResult.sent,
      role: input.role,
      childrenCount: input.childrenNames.length,
    },
  };
}

export interface BulkExistingRecipientOutcome {
  memberResult: BulkExistingMemberCompletionResult['memberResult'] | null;
  roleResult: BulkExistingTeamRoleResult;
  childOutcomes: BulkExistingParentChildOutcome[];
  selectedSecondGuardianResult: BulkSelectedSecondGuardianResult | null;
  pendingSecondGuardianResult: BulkPendingSecondGuardianResult | null;
  notificationError: MembershipWriteError | null;
}

export interface BulkExistingRecipientOperations {
  assignRole: typeof assignBulkExistingTeamRole;
  processChildren: typeof processBulkExistingParentChildren;
  addSelectedSecondGuardian: typeof addBulkSelectedSecondGuardian;
  invitePendingSecondGuardian: typeof inviteBulkPendingSecondGuardian;
  completeMember: typeof completeBulkExistingMember;
}

export async function processBulkExistingRecipient(
  input: {
    userId: string;
    displayName: string | null;
    enteredName: string;
    enteredEmail: string;
    teamId: string;
    teamName: string;
    clubId: string;
    inviterUserId: string;
    role: TeamRole;
    roleLabel: string | undefined;
    children: ExistingParentChildInput[];
    clubChildren: ExistingClubChildInput[];
    selectedSecondGuardian: { id: string } | null;
    secondGuardianName: string;
    secondGuardianEmail: string;
    appOrigin: string;
    clubName: string | null | undefined;
    clubLogoUrl: string | null | undefined;
    clubContactEmail: string | null | undefined;
    inviteEmailStyle?: string | null;
  },
  operations: BulkExistingRecipientOperations,
): Promise<BulkExistingRecipientOutcome> {
  const roleResult = await operations.assignRole({ userId: input.userId, teamId: input.teamId, clubId: input.clubId, role: input.role });
  if (roleResult.error) {
    return {
      memberResult: null,
      roleResult,
      childOutcomes: [],
      selectedSecondGuardianResult: null,
      pendingSecondGuardianResult: null,
      notificationError: null,
    };
  }

  let childOutcomes: BulkExistingParentChildOutcome[] = [];
  let selectedSecondGuardianResult: BulkSelectedSecondGuardianResult | null = null;
  let pendingSecondGuardianResult: BulkPendingSecondGuardianResult | null = null;
  if (input.role === 'parent') {
    childOutcomes = await operations.processChildren({
      parentUserId: input.userId,
      teamId: input.teamId,
      children: input.children,
      clubChildren: input.clubChildren,
    });

    if (input.children.length > 0 && input.selectedSecondGuardian) {
      selectedSecondGuardianResult = await operations.addSelectedSecondGuardian({
        secondGuardianUserId: input.selectedSecondGuardian.id,
        teamId: input.teamId,
        clubId: input.clubId,
        children: input.children,
      });
    } else if (input.children.length > 0 && input.secondGuardianName.trim() && input.secondGuardianEmail.trim()) {
      pendingSecondGuardianResult = await operations.invitePendingSecondGuardian({
        teamId: input.teamId,
        clubId: input.clubId,
        inviterUserId: input.inviterUserId,
        guardianName: input.secondGuardianName,
        guardianEmail: input.secondGuardianEmail,
        children: input.children,
        teamName: input.teamName,
        appOrigin: input.appOrigin,
        clubName: input.clubName,
        clubLogoUrl: input.clubLogoUrl,
        clubContactEmail: input.clubContactEmail,
        inviteEmailStyle: input.inviteEmailStyle,
      });
    }
  }

  const completion = await operations.completeMember({
    userId: input.userId,
    displayName: input.displayName,
    enteredName: input.enteredName,
    enteredEmail: input.enteredEmail,
    teamId: input.teamId,
    teamName: input.teamName,
    appOrigin: input.appOrigin,
    role: input.role,
    roleLabel: input.roleLabel,
    childrenCount: input.children.length,
  });

  return {
    memberResult: completion.memberResult,
    roleResult,
    childOutcomes,
    selectedSecondGuardianResult,
    pendingSecondGuardianResult,
    notificationError: completion.notificationError,
  };
}
