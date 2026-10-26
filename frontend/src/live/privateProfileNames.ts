import { Principal } from "@icp-sdk/core/principal";
import { IbeCiphertext } from "@icp-sdk/vetkeys";
import type { FeatureBackendContext } from "./featureRouter";
import { connectLivePiiAccessControl } from "./domains";
import { encryptPiiText, fetchPiiVetKeys } from "./piiVetKeys";
import { unwrapCandid } from "./features/candid";

/** Dormant reference contract: publishing a reference requires the separately
 * approved identity/search cutover. The original key authority is immutable. */
const PREFIX = "pii-display-name:v1:";
const FIELD = "display_name";
const BATCH_SIZE = 100;
const READ_TIMEOUT_MS = 6000;

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
  const authority = ctx.target.canisterIds.pii_access_control;
  if (!authority) throw new Error("Private profile authority is not configured.");
  const subject = canonicalPrincipal(ctx.identity.getPrincipal().toText());
  const reference = privateProfileNameReference(authority, subject);
  const value = name.trim();
  if (!value || new TextEncoder().encode(value).length > 512) {
    throw new Error("A display name of at most 512 bytes is required.");
  }
  const ciphertext = await encryptPiiText(ctx, subject, FIELD, value);
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  await unwrapCandid(actor.register_pii(subject, FIELD, ciphertext, ctx.identity.getPrincipal()), "Save private display name");
  // Readback/decryption is required before this helper can claim preparation.
  const names = await readNames(ctx, [subject]);
  if (names.get(subject) !== value) throw new Error("Private display name readback was not confirmed.");
  return reference;
}

async function readNames(ctx: FeatureBackendContext, subjects: string[]): Promise<Map<string, string>> {
  const { actor } = await connectLivePiiAccessControl(ctx.target, ctx.identity);
  const rows = await unwrapCandid(
    actor.get_encrypted_pii_batch(subjects, FIELD, "profile_display", "Display authorized personal names"),
    "Read private display names",
  );
  const wanted = new Set(subjects);
  const validRows = rows.filter(row => row.field_id === FIELD && wanted.has(row.pii_id));
  if (!validRows.length) return new Map();
  const keys = await fetchPiiVetKeys(ctx, [...new Set(validRows.map(row => row.pii_id))], FIELD);
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
export async function hydratePrivateProfileNames<T extends { display_name: string | null }>(
  ctx: FeatureBackendContext,
  profiles: readonly T[],
): Promise<T[]> {
  const references = profiles.map(profile => {
    if (!profile.display_name?.startsWith("pii-display-name:")) return undefined;
    if (!profile.display_name.startsWith(PREFIX)) return null;
    return parseReference(profile.display_name);
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