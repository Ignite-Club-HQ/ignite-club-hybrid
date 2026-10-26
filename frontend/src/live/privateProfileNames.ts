import { Principal } from "@icp-sdk/core/principal";
import { IbeCiphertext } from "@icp-sdk/vetkeys";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLivePiiAccessControl } from "./domains";
import { encryptPiiText, fetchPiiVetKeys } from "./piiVetKeys";
import { unwrapCandid } from "./features/candid";
import { z } from "zod";

/** Dormant reference contract: publishing a reference requires the separately
 * approved identity/search cutover. The original key authority is immutable. */
const PREFIX = "pii-display-name:v1:";
const FIELD = "display_name";
const BATCH_SIZE = 100;
const READ_TIMEOUT_MS = 6000;

const emailSchema = z.string().trim().email().max(254);

/** Preparation only: never publishes an email or broadens its reader grants. */
export async function preparePrivateOwnProfileEmail(ctx: FeatureBackendContext, email: string): Promise<string> {
  const value = emailSchema.parse(email);
  return prepareOwnField(ctx, "email", value);
}

async function prepareOwnField(ctx: FeatureBackendContext, field: "email" | "display_name", value: string): Promise<string> {
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

async function readNames(ctx: FeatureBackendContext, subjects: string[], field = FIELD): Promise<Map<string, string>> {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  const rows = await unwrapCandid(
    actor.get_encrypted_pii_batch(subjects, field, "profile_display", "Read authorized personal details"),
    "Read private display names",
  );
  const wanted = new Set(subjects);
  if (rows.some(row => row.field_id !== field || !wanted.has(row.pii_id)) || new Set(rows.map(row => row.pii_id)).size !== rows.length) throw new Error("Invalid private profile response.");
  const validRows = rows;
  if (!validRows.length) return new Map();
  const keys = await fetchPiiVetKeys(ctx, [...new Set(validRows.map(row => row.pii_id))], field);
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

async function boundedRead(ctx: FeatureBackendContext, subjects: string[]): Promise<Map<string, string>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      readNames(ctx, subjects),
      new Promise<Map<string, string>>(resolve => {
        timer = setTimeout(() => resolve(new Map()), READ_TIMEOUT_MS);
      }),
    ]);
  } catch {
    return new Map();
  } finally {
    clearTimeout(timer);
  }
}

/** Purely display enrichment. No new persistent names/cache, no grants and no
 * guessed group searches. Legacy names take the zero-network path unchanged.
 * An authority mismatch stays unresolved until verified owner routing exists. */
export async function hydratePrivateProfileNames<T extends { display_name: string | null; principal?: Principal }>(
  ctx: FeatureBackendContext,
  profiles: readonly T[],
): Promise<Array<Omit<T, "display_name"> & { display_name: string | null }>> {
  const references = profiles.map(profile => {
    if (!profile.display_name?.startsWith("pii-display-name:")) return undefined;
    if (!profile.display_name.startsWith(PREFIX)) return null;
    const ref = parseReference(profile.display_name);
    // A server profile may not display somebody else's private reference.
    if (ref && profile.principal && profile.principal.toText() !== ref.subject) return null;
    return ref;
  });
  const subjects = [...new Set(references.flatMap(ref =>
    ref?.authority === ctx.target.canisterIds.pii_access_control ? [ref.subject] : [],
  ))];
  const names = new Map<string, string>();
  // Two bounded chunks at a time; each ciphertext request obeys the canister's
  // 100-row ceiling, while key derivations use the existing 25-row SDK relay.
  for (let start = 0; start < subjects.length; start += BATCH_SIZE * 2) {
    const parts = await Promise.all([
      subjects.slice(start, start + BATCH_SIZE),
      subjects.slice(start + BATCH_SIZE, start + BATCH_SIZE * 2),
    ].filter(chunk => chunk.length).map(chunk => boundedRead(ctx, chunk)));
    for (const part of parts) for (const [id, name] of part) names.set(id, name);
  }
  return profiles.map((profile, index) => {
    const ref = references[index];
    if (ref === undefined) return profile;
    const name = ref?.authority === ctx.target.canisterIds.pii_access_control ? names.get(ref.subject) : undefined;
    return { ...profile, display_name: name ?? null };
  });
}