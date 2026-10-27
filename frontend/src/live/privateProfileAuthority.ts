import { Principal } from "@icp-sdk/core/principal";
import type { FeatureBackendContext } from "./featureRouter";
import { accountAuthoritiesFromRegistry, type AccountRegistryBinding, type AccountRegistrySnapshot } from "./accountAuthorityRegistry";
import { readLiveAccountAuthoritySnapshot } from "./accountAuthorityRegistry";
import { capturePrivateProfileSession } from './privateProfileSession';

export type PrivateProfileAuthorityLease = {
  context: FeatureBackendContext;
  confirm: () => Promise<void>;
};
export type PrivateProfileAuthorityResolver = (authority: string) => Promise<PrivateProfileAuthorityLease>;

/** Explicit approved deployment evidence is required; never derive a pin from
 * a private reference or silently discover/rebind the current registry. */
export function createLivePrivateProfileAuthorityResolver(
  ctx: FeatureBackendContext, binding: AccountRegistryBinding,
): PrivateProfileAuthorityResolver {
  const pinned = { ...binding, requiredClubAuthorities: [...binding.requiredClubAuthorities] };
  return createPrivateProfileAuthorityResolver(ctx, pinned, () => readLiveAccountAuthoritySnapshot(ctx, pinned));
}

const fingerprint = (value: unknown) => JSON.stringify(value, (_, item) =>
  typeof item === "bigint" ? item.toString() : item);

/** Rehearsal composition only. The supplied transport MUST read a complete
 * consensus registry at the approved revision, not local membership/cache rows.
 * Location proves no reader grant: the original PII service still authorizes
 * ciphertext and fresh key delivery. Never repin, guess a group or rewrite keys. */
export function createPrivateProfileAuthorityResolver(
  ctx: FeatureBackendContext,
  binding: AccountRegistryBinding,
  readSnapshot: () => Promise<AccountRegistrySnapshot>,
): PrivateProfileAuthorityResolver {
  const identity = ctx.identity;
  const principal = identity.getPrincipal().toText();
  const target = fingerprint(ctx.target);
  const pinnedBinding = { ...binding, requiredClubAuthorities: [...binding.requiredClubAuthorities] };
  const sessionActive = capturePrivateProfileSession();
  const active = () => {
    sessionActive();
    if (ctx.identity !== identity || identity.getPrincipal().isAnonymous() || identity.getPrincipal().toText() !== principal ||
        fingerprint(ctx.target) !== target || ctx.target.alias !== pinnedBinding.targetAlias ||
        ctx.target.host !== pinnedBinding.host || ctx.target.networkKind !== pinnedBinding.networkKind || ctx.target.status === "disabled") {
      throw new Error("Private profile deployment or identity changed.");
    }
  };
  const collect = async () => {
    active();
    const snapshot = await readSnapshot();
    active();
    accountAuthoritiesFromRegistry(snapshot, pinnedBinding);
    const authorities = snapshot.groups.map(group => group.domains.find(row => row.domain === "pii_access_control")?.canister.toText());
    if (authorities.some(id => !id) || new Set(authorities).size !== authorities.length) throw new Error("Ambiguous original private profile authority.");
    return { authorities, signature: fingerprint(snapshot) };
  };
  // One bounded inventory is shared within this composition, never persisted.
  let opening: ReturnType<typeof collect> | undefined;
  return async authority => {
    const parsed = Principal.fromText(authority);
    if (parsed.isAnonymous() || parsed.toText() !== authority || authority === "aaaaa-aa") throw new Error("Invalid original private profile authority.");
    active();
    opening ??= collect();
    const inventory = await opening;
    active();
    if (!inventory.authorities.includes(authority)) throw new Error("Original private profile authority is not in the verified deployment.");
    return {
      context: { identity, target: { ...ctx.target, canisterIds: { ...ctx.target.canisterIds, pii_access_control: authority } } },
      confirm: async () => {
        const latest = await collect();
        if (latest.signature !== inventory.signature) throw new Error("Original private profile inventory changed.");
      },
    };
  };
}