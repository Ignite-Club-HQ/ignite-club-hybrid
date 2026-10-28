import { Principal } from "@icp-sdk/core/principal";
import { IbeCiphertext } from "@icp-sdk/vetkeys";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLivePiiAccessControl } from "./domains";
import { encryptPiiText, fetchPiiVetKeys, fetchClubNameVetKey, clubNamePiiId, CLUB_NAME_SCHEME_PREFIX } from "./piiVetKeys";
import { unwrapCandid } from "./features/candid";
import type { PrivateProfileAuthorityResolver } from "./privateProfileAuthority";
import type { PrivateProfileAudience } from './privateProfileAudience';
import { capturePrivateProfileSession } from './privateProfileSession';
import { privateProfileSearchRehearsalEnabled } from './privateProfileSearchMode';
import { isLoopbackRehearsalHost } from './accountReadAdapter.mjs';
import { privateClubNameDisplaysEnabled } from './privateClubNameDisplayMode';

/** Dormant reference contract: publishing a reference requires the separately
 * approved identity/search cutover. The original key authority is immutable. */
const PREFIX = "pii-display-name:v1:";
const FIELD = "display_name";
const BATCH_SIZE = 100;
const READ_TIMEOUT_MS = 6000;

async function prepareOwnField(ctx: FeatureBackendContext, value: string): Promise<string> {
  const authority = ctx.target.canisterIds.pii_access_control;
  if (!authority) throw new Error("Private profile authority is not configured.");
  const subject = canonicalPrincipal(ctx.identity.getPrincipal().toText());
  const identity = ctx.identity;
  const target = JSON.stringify(ctx.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
    if (ctx.identity !== identity || ctx.identity.getPrincipal().toText() !== subject || JSON.stringify(ctx.target) !== target) throw new Error("Private profile write identity or authority changed.");
  };
  canonicalPrincipal(authority);
  const ciphertext = await encryptPiiText(ctx, subject, FIELD, value);
  active();
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  active();
  await unwrapCandid(actor.register_pii(subject, FIELD, ciphertext, ctx.identity.getPrincipal()), "Save private profile field");
  active();
  const values = await readNames(ctx, [subject], FIELD, active, undefined, true);
  active();
  if (values.get(subject) !== value) throw new Error("Private profile readback was not confirmed.");
  return privateProfileNameReference(authority, subject);
}

function canonicalPrincipal(value: string): string {
  const principal = Principal.fromText(value);
  if (principal.isAnonymous() || principal.toText() !== value) {
    throw new Error("Invalid private profile identity.");
  }
  return value;
}

export function privateProfileNameReference(authority: string, subject: string): string {
  return `${PREFIX}${canonicalPrincipal(authority)}:${canonicalPrincipal(subject)}`;
}

function parseReference(value: string): { authority: string; subject: string } | null {
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 2) return null;
  try {
    return { authority: canonicalPrincipal(parts[0]), subject: canonicalPrincipal(parts[1]) };
  } catch {
    return null;
  }
}

/** Own-profile reopening is required data, not optional roster enrichment.
 * Preserve the original owner/authority and give key derivation time to
 * finish on a device without a saved key copy; never turn a denied read into
 * an absent profile. */
export async function readPrivateOwnProfileName(ctx: FeatureBackendContext, reference: string): Promise<string> {
  const ref = reference.startsWith(PREFIX) ? parseReference(reference) : null;
  if (!ref || ref.authority !== ctx.target.canisterIds.pii_access_control) throw new Error('Saved private-name authority does not match the configured original authority.');
  const activeSession = capturePrivateProfileSession();
  const identity = ctx.identity;
  const caller = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const active = () => {
    activeSession();
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== caller || JSON.stringify(ctx.target) !== target) throw new Error('Private profile read cancelled or changed.');
  };
  // Account aliases are authorized by the existing original PII service;
  // do not invent a new key subject or rewrite a saved reference here.
  let retired = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guard = () => { if (retired) throw new Error('Private profile read retired.'); active(); };
  try {
    // Overlap the (public) verification-key load with the ciphertext read;
    // a first unlock on this device otherwise pays both one after another.
    try { (await import('./piiVetKeys')).prewarmPiiVerificationKey(ctx); } catch { /* optional warm-up */ }
    const names = await Promise.race([
      readNames(ctx, [ref.subject], FIELD, guard, undefined, ref.subject === caller),
      new Promise<never>((_, reject) => { timer = setTimeout(() => { retired = true; reject(new Error('Private display name unlock timed out.')); }, 30000); }),
    ]);
    guard();
    const name = names.get(ref.subject);
    if (!name) throw new Error('Private display name could not be unlocked yet.');
    if (ref.subject === caller) (await import('./ownPrivateName')).rememberOwnPrivateName(caller, name);
    return name;
  } finally { retired = true; clearTimeout(timer); }
}

/** Strict preparation only; does not publish the reference or erase plaintext.
 * No automatic retry after an unknown write. Always encrypt under the supplied
 * original authority and write only the authenticated caller's own name. */
export async function preparePrivateOwnProfileName(
  ctx: FeatureBackendContext,
  name: string,
): Promise<string> {
  const value = name.trim();
  if (!value || new TextEncoder().encode(value).length > 512) {
    throw new Error("A display name of at most 512 bytes is required.");
  }
  return prepareOwnField(ctx, value);
}

/** Explicit rehearsal preparation only; does not publish a profile reference.
 * The original person-key record is retained for non-club audiences. */
export async function preparePrivateOwnClubName(ctx: FeatureBackendContext, club: string, name: string): Promise<void> {
  const value = name.trim();
  if (!value || new TextEncoder().encode(value).length > 512) throw new Error('A display name of at most 512 bytes is required.');
  const piiId = clubNamePiiId(club);
  const identity = ctx.identity;
  const principal = canonicalPrincipal(identity.getPrincipal().toText());
  const target = JSON.stringify(ctx.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target) throw new Error('Club name preparation changed.');
  };
  const ciphertext = await encryptPiiText(ctx, piiId, FIELD, value);
  active();
  const { actor } = await connectLivePiiAccessControl(ctx.target, identity);
  active();
  const api = actor as unknown as {
    register_private_club_name: (subject: Principal, club: string, bytes: Uint8Array) => Promise<{ Ok: unknown } | { Err: string }>;
    read_private_club_name_preparation: (subject: Principal, club: string) => Promise<{ Ok: { ciphertext: number[] | Uint8Array; master_key_id: string } } | { Err: string }>;
  };
  await unwrapCandid(api.register_private_club_name(identity.getPrincipal(), club, ciphertext), 'Prepare private club name');
  active();
  const row = await unwrapCandid(api.read_private_club_name_preparation(identity.getPrincipal(), club), 'Verify private club name');
  active();
  if (row.master_key_id !== `${CLUB_NAME_SCHEME_PREFIX}${club}` || row.ciphertext.length !== ciphertext.length || ciphertext.some((b, i) => row.ciphertext[i] !== b)) throw new Error('Club name preparation readback mismatch.');
}

/** Normal-save connection under the dedicated club-display release. Original replacement
 * already invalidates old copies. Each refresh compares its saved original
 * atomically, so concurrent edits cannot attach stale copies to a new name.
 * Club discovery supplies current destinations, never reader grants. */
export async function refreshPrivateOwnClubNames(
  ctx: FeatureBackendContext,
  name: string,
  discoverClubs: () => Promise<readonly string[]>,
  assertSaveActive: () => void = () => {},
): Promise<void> {
  if (!privateClubNameDisplaysEnabled()) return;
  if (privateProfileSearchRehearsalEnabled() && !isLoopbackRehearsalHost(ctx.target.host)) throw new Error('Private name maintenance requires a loopback rehearsal target.');
  const value = name.trim();
  if (!value || new TextEncoder().encode(value).length > 512) throw new Error('A display name of at most 512 bytes is required.');
  const identity = ctx.identity;
  const subject = canonicalPrincipal(identity.getPrincipal().toText());
  const target = JSON.stringify(ctx.target);
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    assertSaveActive();
    sessionActive();
    if (ctx.identity !== identity || identity.getPrincipal().toText() !== subject || JSON.stringify(ctx.target) !== target) throw new Error('Private name maintenance changed.');
  };
  active();
  const supplied = [...await discoverClubs()];
  active();
  if (supplied.length > 100 || supplied.some(club => typeof club !== 'string' || !club || club.length > 64 || /[\u001f/]/.test(club))) throw new Error('Bounded exact club names required.');
  const clubs = [...new Set(supplied)];
  if (!clubs.length) return;
  const { actor } = await connectLivePiiAccessControl(ctx.target, identity);
  active();
  const originals = await unwrapCandid(actor.get_encrypted_pii_batch([subject], FIELD, 'profile_display', 'Verify own name maintenance'), 'Read original private name');
  active();
  const original = originals[0];
  if (originals.length !== 1 || !original || original.pii_id !== subject || original.field_id !== FIELD || original.master_key_id !== 'vetkey-ibe-v1') throw new Error('Exact original private name required.');
  const originalBytes = Uint8Array.from(original.ciphertext);
  if (!originalBytes.length || originalBytes.length > 4096) throw new Error('Bounded original private name required.');
  const keys = await fetchPiiVetKeys(ctx, [subject], FIELD, { fresh: true, assertActive: active });
  active();
  const key = keys.get(subject);
  if (!key || new TextDecoder('utf-8', { fatal: true }).decode(IbeCiphertext.deserialize(Uint8Array.from(originalBytes)).decrypt(key)) !== value) throw new Error('Original private name changed.');
  const saved: Array<{ club: string; ciphertext: Uint8Array }> = [];
  for (const club of clubs) {
    active();
    const ciphertext = await encryptPiiText(ctx, clubNamePiiId(club), FIELD, value);
    active();
    // One attempt only. The existing receiver is create-only and compares
    // the original bytes in the same no-await segment as the commit.
    await unwrapCandid(actor.refresh_private_club_name_lifecycle(identity.getPrincipal(), club, originalBytes, ciphertext), 'Refresh private club name');
    active();
    saved.push({ club, ciphertext });
  }
  for (const { club, ciphertext } of saved) {
    active();
    const result = await unwrapCandid(actor.read_private_club_name_lifecycle(identity.getPrincipal(), club, [originalBytes]), 'Verify refreshed private name');
    active();
    const row = result[0];
    if (result.length !== 1 || !row || row.pii_id !== subject || row.field_id !== FIELD || row.master_key_id !== `${CLUB_NAME_SCHEME_PREFIX}${club}` || row.ciphertext.length !== ciphertext.length || ciphertext.some((b, i) => row.ciphertext[i] !== b)) throw new Error('Private name maintenance readback mismatch.');
  }
}

async function readNames(ctx: FeatureBackendContext, subjects: string[], field = FIELD, active: () => void = () => {}, audience?: PrivateProfileAudience, retainOwnKey = false): Promise<Map<string, string>> {
  active();
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  active();
  const rows = await unwrapCandid(
    audience ? actor.get_private_profile_names_batch(subjects, audience) : actor.get_encrypted_pii_batch(subjects, field, "profile_display", "Read authorized personal details"),
    "Read private display names",
  );
  active();
  const wanted = new Set(subjects);
  if (rows.some(row => row.field_id !== field || !wanted.has(row.pii_id)) || new Set(rows.map(row => row.pii_id)).size !== rows.length) throw new Error("Invalid private profile response.");
  const validRows = rows;
  if (!validRows.length) return new Map();
  if (audience && validRows.length !== subjects.length) throw new Error('Private-name audience did not authorize every candidate.');
  const clubRows = validRows.filter(row => row.master_key_id?.startsWith('vetkey-club-names-'));
  if (clubRows.length && (!audience || audience.kind !== 'club' || field !== FIELD || clubRows.some(row => row.master_key_id !== `${CLUB_NAME_SCHEME_PREFIX}${audience.resource}`))) throw new Error('Invalid club name key scope.');
  const individualRows = validRows.filter(row => !clubRows.includes(row));
  const keys = individualRows.length ? await fetchPiiVetKeys(ctx, individualRows.map(row => row.pii_id), field, { fresh: true, assertActive: active, ...(audience ? { audience } : {}), ...(retainOwnKey && !audience ? { retainOwnKey: true } : {}) }) : new Map();
  const clubKey = clubRows.length && audience ? await fetchClubNameVetKey(ctx, clubRows.map(row => row.pii_id), audience, active) : undefined;
  if (audience && keys.size + (clubKey ? clubRows.length : 0) !== validRows.length) throw new Error('Private-name keys were not authorized.');
  active();
  const out = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const row of validRows) {
    const key = clubRows.includes(row) ? clubKey : keys.get(row.pii_id);
    if (!key) continue;
    try {
      const name = decoder.decode(IbeCiphertext.deserialize(Uint8Array.from(row.ciphertext)).decrypt(key));
      out.set(row.pii_id, name);
    } catch {
      // A malformed/wrong-key record is never displayed as ciphertext or a ref.
    }
  }
  // Even a cached shared key is used only under a fresh exact-subject read.
  // Repeat after decryption so revoked membership never publishes labels.
  if (clubRows.length && audience) {
    const closing = await unwrapCandid(actor.get_private_profile_names_batch(subjects, audience), 'Confirm club name audience');
    active();
    if (closing.length !== rows.length || closing.some((row, i) => row.pii_id !== rows[i].pii_id || row.field_id !== field || row.master_key_id !== rows[i].master_key_id || row.ciphertext.length !== rows[i].ciphertext.length || row.ciphertext.some((b, j) => b !== rows[i].ciphertext[j]))) throw new Error('Club name audience or ciphertext changed.');
  }
  return out;
}

async function boundedRead(ctx: FeatureBackendContext, subjects: string[], active: () => void, audience?: PrivateProfileAudience): Promise<Map<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retired = false;
  const guard = () => {
    if (retired) throw new Error("Private profile read retired.");
    active();
  };
  try {
    return await Promise.race([
      readNames(ctx, subjects, FIELD, guard, audience),
      new Promise<Map<string, string>>(resolve => {
        timer = setTimeout(() => { retired = true; resolve(new Map()); }, READ_TIMEOUT_MS);
      }),
    ]);
  } catch (error) {
    if (audience) throw error;
    return new Map();
  } finally {
    retired = true;
    clearTimeout(timer);
  }
}

async function boundedAuthorityCheck<T>(read: () => Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      read(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Private profile authority check timed out.")), READ_TIMEOUT_MS); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Purely display enrichment. No new persistent names/cache, no grants and no
 * guessed group searches. Legacy names take the zero-network path unchanged.
 * Foreign authorities require the explicit rehearsal resolver; existing readers
 * never scan groups or use the reference itself as location authorization. */
export async function hydratePrivateProfileNames<T extends { display_name: string | null; principal?: Principal }>(
  ctx: FeatureBackendContext,
  profiles: readonly T[],
  options: { signal?: AbortSignal; resolveAuthority?: PrivateProfileAuthorityResolver; audience?: PrivateProfileAudience } = {},
): Promise<Array<Omit<T, "display_name"> & { display_name: string | null }>> {
  // Retain the exact rows whose references were authorized. A caller changing
  // its array during an await must not attach a retained name to another row.
  profiles = profiles.map(profile => ({ ...profile }));
  options = { ...options, ...(options.audience ? { audience: { ...options.audience } } : {}) };
  let retired = false;
  const sessionActive = capturePrivateProfileSession();
  const identity = ctx.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const active = () => {
    sessionActive();
    if (retired || options.signal?.aborted || ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target) {
      throw new Error("Private profile read cancelled or changed.");
    }
  };
  active();
  const references = profiles.map(profile => {
    if (!profile.display_name?.startsWith("pii-display-name:")) return undefined;
    if (!profile.display_name.startsWith(PREFIX)) return null;
    const ref = parseReference(profile.display_name);
    // A server profile may not display somebody else's private reference.
    if (ref && profile.principal && profile.principal.toText() !== ref.subject) return null;
    return ref;
  });
  const byAuthority = new Map<string, Set<string>>();
  for (const ref of references) {
    if (!ref || (!options.resolveAuthority && ref.authority !== ctx.target.canisterIds.pii_access_control)) continue;
    const subjects = byAuthority.get(ref.authority) ?? new Set<string>();
    subjects.add(ref.subject);
    byAuthority.set(ref.authority, subjects);
  }
  const names = new Map<string, Map<string, string>>();
  const batchSize = options.audience ? 25 : BATCH_SIZE;
  const jobs = [...byAuthority].flatMap(([authority, ids]) => {
    const subjects = [...ids];
    return Array.from({ length: Math.ceil(subjects.length / batchSize) }, (_, index) => ({ authority, subjects: subjects.slice(index * batchSize, (index + 1) * batchSize) }));
  });
  // A global two-request ceiling, not two requests per group. Original-key
  // routes are checked again after all encryption/service awaits.
  const leases = new Map<string, Promise<Awaited<ReturnType<PrivateProfileAuthorityResolver>>>>();
  const routeGuards = new Map<string, () => void>();
  const readJob = async ({ authority, subjects }: typeof jobs[number]) => {
    try {
      active();
      let pendingLease = leases.get(authority);
      if (!pendingLease) {
        const resolve = options.resolveAuthority;
        pendingLease = (async () => {
          const lease = resolve ? await boundedAuthorityCheck(() => resolve(authority)) : { context: ctx, confirm: async () => {} };
          active();
          if (lease.context.identity !== identity || lease.context.target.host !== ctx.target.host || lease.context.target.networkKind !== ctx.target.networkKind || lease.context.target.canisterIds.pii_access_control !== authority) throw new Error("Invalid original private profile route.");
          const routeTarget = JSON.stringify(lease.context.target);
          routeGuards.set(authority, () => {
            active();
            if (lease.context.identity !== identity || JSON.stringify(lease.context.target) !== routeTarget) throw new Error("Original private profile route changed.");
          });
          return lease;
        })();
        leases.set(authority, pendingLease);
      }
      const lease = await pendingLease;
      const route = lease.context;
      const routeActive = () => {
        active();
        routeGuards.get(authority)?.();
      };
      const part = await boundedRead(route, subjects, routeActive, options.audience);
      if (options.audience && part.size !== subjects.length) throw new Error('Private-name audience is incomplete or unavailable.');
      active();
      const group = names.get(authority) ?? new Map<string, string>();
      for (const [id, name] of part) group.set(id, name);
      names.set(authority, group);
    } catch (error) { if (options.audience) throw error; /* Display-only reads remain neutral. */ }
  };
  try {
    for (let start = 0; start < jobs.length; start += 2) await Promise.all(jobs.slice(start, start + 2).map(readJob));
    for (const [authority, pendingLease] of leases) {
      try {
        const lease = await pendingLease;
        active(); routeGuards.get(authority)?.();
        await boundedAuthorityCheck(lease.confirm);
        active(); routeGuards.get(authority)?.();
      } catch (error) { if (options.audience) throw error; names.delete(authority); }
    }
  } catch (error) {
    // A refused parallel batch retires sibling work before its late reply can
    // start fresh key derivations or contribute to a replacement request.
    retired = true;
    names.clear();
    throw error;
  }
  active();
  if (options.audience && references.some(ref => ref === null || (ref && !names.get(ref.authority)?.has(ref.subject)))) throw new Error('Private-name authority is unverified or unavailable.');
  return profiles.map((profile, index) => {
    const ref = references[index];
    if (ref === undefined) return profile;
    const name = ref ? names.get(ref.authority)?.get(ref.subject) : undefined;
    return { ...profile, display_name: name ?? null };
  });
}