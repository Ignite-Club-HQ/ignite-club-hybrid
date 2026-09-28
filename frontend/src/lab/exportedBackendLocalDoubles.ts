export type ExpiringRecord = {
  id: string;
  createdAt: number;
  read: boolean;
};

export type BatchDeleteResult = {
  deleted: number;
  hasMore: boolean;
  error: string | null;
};

export function deleteExpiredRecords(
  records: ExpiringRecord[],
  options: {
    cutoff: number;
    readOnly?: boolean;
    batchSize?: number;
    deleteChunkSize?: number;
    maxBatches?: number;
    deleteChunk?: (ids: readonly string[]) => boolean;
  },
): BatchDeleteResult {
  const batchSize = options.batchSize ?? 500;
  const deleteChunkSize = options.deleteChunkSize ?? 100;
  const maxBatches = options.maxBatches ?? Number.POSITIVE_INFINITY;
  if (batchSize <= 0 || deleteChunkSize <= 0 || maxBatches <= 0) {
    throw new Error('Batch limits must be positive');
  }

  let deleted = 0;
  let batches = 0;
  while (batches < maxBatches) {
    const eligible = records
      .filter((record) => record.createdAt < options.cutoff && (!options.readOnly || record.read))
      .slice(0, batchSize);
    if (eligible.length === 0) return { deleted, hasMore: false, error: null };
    batches += 1;

    for (let offset = 0; offset < eligible.length; offset += deleteChunkSize) {
      const ids = eligible.slice(offset, offset + deleteChunkSize).map((record) => record.id);
      if (options.deleteChunk && !options.deleteChunk(ids)) {
        return { deleted, hasMore: true, error: 'delete failed' };
      }
      const idSet = new Set(ids);
      const before = records.length;
      for (let index = records.length - 1; index >= 0; index -= 1) {
        if (idSet.has(records[index].id)) records.splice(index, 1);
      }
      const removed = before - records.length;
      deleted += removed;
      if (removed === 0) return { deleted, hasMore: true, error: 'delete made no progress' };
    }
  }

  return {
    deleted,
    hasMore: records.some(
      (record) => record.createdAt < options.cutoff && (!options.readOnly || record.read),
    ),
    error: null,
  };
}

export type EventAudienceMember = {
  accountId: string;
  clubId: string;
  teamId?: string;
  role: 'player' | 'parent' | 'coach' | 'club_admin';
  guardianOf?: readonly string[];
};

export function selectEventNotificationRecipients(input: {
  creatorId: string;
  clubId: string;
  teamIds?: readonly string[];
  restrictedRoles?: readonly EventAudienceMember['role'][];
  members: readonly EventAudienceMember[];
}) {
  const teams = new Set(input.teamIds ?? []);
  const restrictedRoles = new Set(input.restrictedRoles ?? []);
  const recipients = new Set<string>();

  for (const member of input.members) {
    if (member.accountId === input.creatorId || member.clubId !== input.clubId) continue;
    const isAdmin = member.role === 'club_admin';
    const roleAllowed = restrictedRoles.size === 0 || restrictedRoles.has(member.role) || isAdmin;
    const directlyTargeted = teams.size === 0 || isAdmin || (member.teamId && teams.has(member.teamId));
    const guardianTargeted = member.guardianOf?.some((teamId) => teams.has(teamId)) ?? false;
    if (roleAllowed && (directlyTargeted || guardianTargeted)) recipients.add(member.accountId);
  }

  return [...recipients].sort();
}

export function authorizeInternalWorker(
  authorization: string | null,
  expectedSecret: string | null,
): { status: 200 | 401 | 403 | 500; body: string } {
  if (!expectedSecret) return { status: 500, body: 'Worker authentication is not configured' };
  const match = authorization?.trim().match(/^Bearer\s+(.+)$/i);
  if (!match || !match[1].trim()) return { status: 401, body: 'Missing bearer token' };
  const presented = match[1].trim();
  if (presented !== expectedSecret) return { status: 403, body: 'Forbidden' };
  return { status: 200, body: 'Authorized' };
}

export function buildProtectedNameTokens(words: readonly string[]) {
  return new Set(
    words
      .flatMap((word) => word.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [])
      .filter((token) => token.length > 1),
  );
}

export function pseudonymizeNames(
  text: string,
  names: readonly { name: string; kind: 'child' | 'adult' }[],
  protectedWords: readonly string[],
) {
  const protectedTokens = buildProtectedNameTokens(protectedWords);
  const aliases = new Map<string, string>();
  let childIndex = 0;
  let adultIndex = 0;
  let output = text;

  for (const entry of names) {
    const firstName = entry.name.trim().split(/\s+/)[0];
    const normalized = firstName.toLocaleLowerCase();
    if (firstName.length < 4 || protectedTokens.has(normalized)) continue;
    const alias = entry.kind === 'child' ? `Child ${++childIndex}` : `Person ${++adultIndex}`;
    aliases.set(alias, entry.kind === 'child' ? `<${firstName}'s parent>'s child` : entry.name);
    output = output.replace(
      new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(firstName)}(?![\\p{L}\\p{N}])`, 'giu'),
      alias,
    );
  }

  return {
    text: output,
    rehydrate(summary: string) {
      return summary.replace(/\b(Child|Person) \d+\b/g, (alias) =>
        aliases.get(alias) ?? (alias.startsWith('Child') ? 'a child' : 'a person'));
    },
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
