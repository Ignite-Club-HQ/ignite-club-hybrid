import { withFeatureBackend, type FeatureBackendContext } from './featureRouter';
import { onPrivateProfileSessionRetired } from './privateProfileSession';

const PRIVATE_PREFIX = 'pii-display-name:';
const BATCH = 25;
const TTL_MS = 10 * 60 * 1000;
const MAX_ENTRIES = 1000;

/** Memory-only, club-scoped unlocked names. Never enters the shared,
 * audience-agnostic profile cache; dropped when the private session retires. */
const remembered = new Map<string, { name: string; at: number }>();
onPrivateProfileSessionRetired(() => remembered.clear());

const key = (caller: string, clubId: string, id: string) => `${caller}|${clubId}|${id}`;

function recall(caller: string, clubId: string, id: string): string | undefined {
  const hit = remembered.get(key(caller, clubId, id));
  if (!hit) return undefined;
  if (Date.now() - hit.at > TTL_MS) { remembered.delete(key(caller, clubId, id)); return undefined; }
  return hit.name;
}

function remember(caller: string, clubId: string, id: string, name: string) {
  if (remembered.size >= MAX_ENTRIES) {
    const oldest = remembered.keys().next().value;
    if (oldest) remembered.delete(oldest);
  }
  remembered.set(key(caller, clubId, id), { name, at: Date.now() });
}

export function isPrivateNameReference(value: string | null | undefined): boolean {
  return !!value?.startsWith(PRIVATE_PREFIX);
}

/**
 * Unlock other people's protected names through the exact club they share
 * with the caller. The club's owning service and the PII verifier still
 * authorize every person; a refused person simply stays unnamed (split
 * batches isolate them) instead of blanking everyone else.
 */
export async function unlockClubScopedNames(
  ctx: FeatureBackendContext, clubId: string, ids: readonly string[], signal?: AbortSignal,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const caller = ctx.identity.getPrincipal().toText();
  const wanted: string[] = [];
  for (const id of new Set(ids)) {
    const hit = recall(caller, clubId, id);
    if (hit) out.set(id, hit); else wanted.push(id);
  }
  if (!wanted.length || !clubId) return out;
  const { privateClubNameDisplaysEnabled } = await import('./privateClubNameDisplayMode');
  if (!privateClubNameDisplaysEnabled()) return out;
  const { readRelationshipProfiles } = await import('./relationshipProfileRead');
  const identity = ctx.identity;

  const readChunk = async (chunk: string[], depth: number): Promise<void> => {
    if (!chunk.length || signal?.aborted) return;
    try {
      const rows = await withFeatureBackend('membership', {
        supabase: async () => [],
        icp: async owner => {
          if (owner.identity !== identity) throw new Error('Club name reader identity changed.');
          return readRelationshipProfiles(owner, chunk, { kind: 'club', resource: clubId }, signal);
        },
      }, { clubId });
      for (const row of rows) {
        const name = row.display_name;
        if (name && !isPrivateNameReference(name) && chunk.includes(row.account_id)) {
          out.set(row.account_id, name);
          remember(caller, clubId, row.account_id, name);
        }
      }
    } catch {
      // One person outside this club refuses the whole batch; isolate them.
      if (chunk.length === 1 || depth > 6) return;
      const mid = Math.ceil(chunk.length / 2);
      await readChunk(chunk.slice(0, mid), depth + 1);
      await readChunk(chunk.slice(mid), depth + 1);
    }
  };

  for (let i = 0; i < wanted.length; i += BATCH) await readChunk(wanted.slice(i, i + BATCH), 0);
  return out;
}

/** Test-only reset. */
export function __resetClubScopedNames() { remembered.clear(); }
