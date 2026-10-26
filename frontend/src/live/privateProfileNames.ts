import { Principal } from "@icp-sdk/core/principal";
import { IbeCiphertext } from "@icp-sdk/vetkeys";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLivePiiAccessControl } from "./domains";
import { encryptPiiText, fetchPiiVetKeys } from "./piiVetKeys";
import { unwrapCandid } from "./features/candid";
import { z } from "zod";
import type { PrivateProfileAuthorityResolver } from "./privateProfileAuthority";

/** Dormant reference contract: publishing a reference requires the separately
 * approved identity/search cutover. The original key authority is immutable. */
const PREFIX = "pii-display-name:v1:";
const FIELD = "display_name";
const BATCH_SIZE = 100;
const READ_TIMEOUT_MS = 6000;

const emailSchema = z.string().trim().email().max(254);

/** Preparation only: never publishes an email or broadens its reader grants. */
export async function preparePrivateOwnProfileEmail(ctx: FeatureBackendContext, email: string): Promise<string> {
  // Empty ciphertext deliberately clears the existing contact_email value;
  // the existing welcome reader interprets an empty decrypted value as unset.
  const value = email.trim() ? emailSchema.parse(email) : "";
  return prepareOwnField(ctx, "contact_email", value);
}

async function prepareOwnField(ctx: FeatureBackendContext, field: "contact_email" | "display_name", value: string): Promise<string> {
  const authority = ctx.target.canisterIds.pii_access_control;
  if (!authority) throw new Error("Private profile authority is not configured.");
  const subject = canonicalPrincipal(ctx.identity.getPrincipal().toText());
  canonicalPrincipal(authority);
  const ciphertext = await encryptPiiText(ctx, subject, field, value);
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  await unwrapCandid(actor.register_pii(subject, field, ciphertext, ctx.identity.getPrincipal()), "Save private profile field");
  const values = await readNames(ctx, [subject], field);
  if (values.get(subject) !== value) throw new Error("Private profile readback was not confirmed.");
  return field === FIELD ? privateProfileNameReference(authority, subject) : `pii-email:v1:${authority}:${subject}`;
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
  return prepareOwnField(ctx, FIELD, value);
}

async function readNames(ctx: FeatureBackendContext, subjects: string[], field = FIELD, active: () => void = () => {}): Promise<Map<string, string>> {
  active();
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  active();
  const rows = await unwrapCandid(
    actor.get_encrypted_pii_batch(subjects, field, "profile_display", "Read authorized personal details"),
    "Read private display names",
  );
  active();
  const wanted = new Set(subjects);
  if (rows.some(row => row.field_id !== field || !wanted.has(row.pii_id)) || new Set(rows.map(row => row.pii_id)).size !== rows.length) throw new Error("Invalid private profile response.");
  const validRows = rows;
  if (!validRows.length) return new Map();
  const keys = await fetchPiiVetKeys(ctx, [...new Set(validRows.map(row => row.pii_id))], field, { fresh: true, assertActive: active });
  active();
  const out = new Map<string, string>();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for (const row of validRows) {
    const key = keys.get(row.pii_id);
    if (!key) continue;
    try {
      const name = decoder.decode(IbeCiphertext.deserialize(Uint8Array.from(row.ciphertext)).decrypt(key));
      out.set(row.pii_id, name);
    } catch {
      // A malformed/wrong-key record is never displayed as ciphertext or a ref.
    }
  }
  return out;
}

async function boundedRead(ctx: FeatureBackendContext, subjects: string[], active: () => void): Promise<Map<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let retired = false;
  const guard = () => {
    if (retired) throw new Error("Private profile read retired.");
    active();
  };
  try {
    return await Promise.race([
      readNames(ctx, subjects, FIELD, guard),
      new Promise<Map<string, string>>(resolve => {
        timer = setTimeout(() => { retired = true; resolve(new Map()); }, READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return new Map();
  } finally {
    retired = true;
    clearTimeout(timer);
  }
}

/** Purely display enrichment. No new persistent names/cache, no grants and no
 * guessed group searches. Legacy names take the zero-network path unchanged.
 * Foreign authorities require the explicit rehearsal resolver; existing readers
 * never scan groups or use the reference itself as location authorization. */
export async function hydratePrivateProfileNames<T extends { display_name: string | null; principal?: Principal }>(
  ctx: FeatureBackendContext,
  profiles: readonly T[],
  options: { signal?: AbortSignal; resolveAuthority?: PrivateProfileAuthorityResolver } = {},
): Promise<Array<Omit<T, "display_name"> & { display_name: string | null }>> {
  const identity = ctx.identity;
  const principal = identity.getPrincipal().toText();
  const target = JSON.stringify(ctx.target);
  const active = () => {
    if (options.signal?.aborted || ctx.identity !== identity || identity.getPrincipal().toText() !== principal || JSON.stringify(ctx.target) !== target) {
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
  const jobs = [...byAuthority].flatMap(([authority, ids]) => {
    const subjects = [...ids];
    return Array.from({ length: Math.ceil(subjects.length / BATCH_SIZE) }, (_, index) => ({ authority, subjects: subjects.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE) }));
  });
  // A global two-request ceiling, not two requests per group. Original-key
  // routes are checked again after all encryption/service awaits.
  const leases = new Map<string, Awaited<ReturnType<PrivateProfileAuthorityResolver>>>();
  const readJob = async ({ authority, subjects }: typeof jobs[number]) => {
    try {
      active();
      let lease = leases.get(authority);
      if (!lease) {
        lease = options.resolveAuthority ? await options.resolveAuthority(authority) : { context: ctx, confirm: async () => {} };
        active();
        if (lease.context.identity !== identity || lease.context.target.host !== ctx.target.host || lease.context.target.networkKind !== ctx.target.networkKind || lease.context.target.canisterIds.pii_access_control !== authority) throw new Error("Invalid original private profile route.");
        leases.set(authority, lease);
      }
      const part = await boundedRead(lease.context, subjects, active);
      active();
      const group = names.get(authority) ?? new Map<string, string>();
      for (const [id, name] of part) group.set(id, name);
      names.set(authority, group);
    } catch { /* Unverified/unavailable original authorities remain neutral. */ }
  };
  for (let start = 0; start < jobs.length; start += 2) await Promise.all(jobs.slice(start, start + 2).map(readJob));
  for (const [authority, lease] of leases) {
    try { active(); await lease.confirm(); active(); } catch { names.delete(authority); }
  }
  active();
  return profiles.map((profile, index) => {
    const ref = references[index];
    if (ref === undefined) return profile;
    const name = ref ? names.get(ref.authority)?.get(ref.subject) : undefined;
    return { ...profile, display_name: name ?? null };
  });
}