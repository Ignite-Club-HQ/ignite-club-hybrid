import type { Identity } from "@icp-sdk/core/agent";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";

/**
 * Live (mainnet / Cloud Engine) counterpart of `frontend/src/lab/internetIdentityAuth.ts`.
 *
 * This module is never imported directly by application code — it is wired in
 * via the `@/lab/internetIdentityAuth` alias declared in `vite.live.config.ts`,
 * exactly mirroring how `frontend/src/integrations/supabase/liveClient.ts`
 * replaces the fail-closed Supabase stub for the live build only. `IcpAuthProvider`
 * in `src/hooks/useAuth.tsx` is unmodified: it dynamically imports
 * `@/lab/internetIdentityAuth`, and the live build's bundler resolves that
 * specifier to this file instead.
 *
 * Mainnet Internet Identity canister IDs are well-known and identical across
 * networks (see the `internet-identity` skill, skills.internetcomputer.org):
 *   - Backend  (trusted signer): rdmx6-jaaaa-aaaaa-aaadq-cai
 *   - Frontend (identityProvider.canisterId): uqzsh-gqaaa-aaaaq-qaada-cai, served at https://id.ai
 * No local root key or origin-restricted fetch is used here: mainnet's root key
 * is baked into the SDK, and `shouldFetchRootKey`/`fetchRootKey()` must never be
 * called against a real network.
 */

export interface InternetIdentityAuthClient {
  isAuthenticated(): boolean;
  getIdentity(): Promise<Identity>;
  signIn(options?: { returnTo?: string }): Promise<Identity>;
  signOut(options?: { returnTo?: string }): Promise<void>;
  dispose?(): void;
}

export interface InternetIdentitySession {
  principal: string;
  provider: "internet-identity";
}

const MAINNET_INTERNET_IDENTITY_FRONTEND_CANISTER_ID = "uqzsh-gqaaa-aaaaq-qaada-cai";
const MAINNET_INTERNET_IDENTITY_AUTHORIZE_URL = "https://id.ai/authorize";

type AccountProvisioner = (identity: Identity, principal: string, target: IcpTargetConfig) => Promise<void>;

let accountProvisionerOverride: AccountProvisioner | undefined;

export function setInternetIdentityAccountProvisionerForTests(provisioner: AccountProvisioner | undefined): void {
  accountProvisionerOverride = provisioner;
}

function resolveInternetIdentityProvider(target: IcpTargetConfig): { authorizeUrl: string; canisterId: string } {
  // Approved targets may override the authorize URL for a Cloud Engine deployment
  // that fronts its own Internet Identity instance; public mainnet always uses
  // the well-known https://id.ai provider.
  if (target.networkKind === "cloud_engine" && target.canisterIds.internet_identity_frontend) {
    const authorizeUrl = target.supportedDomains?.[0]
      ? `https://${target.supportedDomains[0]}/authorize`
      : MAINNET_INTERNET_IDENTITY_AUTHORIZE_URL;
    return { authorizeUrl, canisterId: target.canisterIds.internet_identity_frontend };
  }
  return {
    authorizeUrl: MAINNET_INTERNET_IDENTITY_AUTHORIZE_URL,
    canisterId: MAINNET_INTERNET_IDENTITY_FRONTEND_CANISTER_ID,
  };
}

async function createDefaultAuthClient(target: IcpTargetConfig): Promise<InternetIdentityAuthClient> {
  const provider = resolveInternetIdentityProvider(target);
  const { AuthClient } = await import("@icp-sdk/auth/client");
  return new AuthClient({
    identityProvider: provider,
    agentOptions: {
      host: target.host,
    },
    transport: "window",
  }) as unknown as InternetIdentityAuthClient;
}

async function provisionInternetIdentityAccount(identity: Identity, principal: string, target: IcpTargetConfig): Promise<void> {
  if (accountProvisionerOverride) {
    await accountProvisionerOverride(identity, principal, target);
    return;
  }

  const { connectLiveIdentityAccessClientWithIdentity, isLiveIdentityAccessConfigured } = await import("./identityAccess");
  if (!isLiveIdentityAccessConfigured(target)) {
    // The user has not deployed/registered an identity_access canister ID for
    // this target yet. Sign-in still succeeds (the principal is real); account
    // provisioning is skipped until that canister exists.
    console.warn(
      `Identity access canister is not configured for ICP target ${target.alias}; skipping account provisioning.`,
    );
    return;
  }
  const { client } = await connectLiveIdentityAccessClientWithIdentity(target, identity);
  await client.registerAccount();
}

let activeClient: InternetIdentityAuthClient | undefined;
let activeTarget: IcpTargetConfig | undefined;

async function getAuthClient(): Promise<{ client: InternetIdentityAuthClient; target: IcpTargetConfig }> {
  const target = getActiveIcpTarget();
  if (!activeClient || activeTarget?.alias !== target.alias) {
    activeClient?.dispose?.();
    activeClient = await createDefaultAuthClient(target);
    activeTarget = target;
  }
  return { client: activeClient, target };
}

let warmupPromise: Promise<void> | undefined;

/**
 * Pre-constructs the Internet Identity auth client ahead of time (resolving
 * the active ICP target, loading the `@icp-sdk/auth` chunk, constructing the
 * `AuthClient`) so the eventual `signInWithInternetIdentity()` call made from
 * a click handler doesn't need to `await` anything before reaching
 * `client.signIn()`. The underlying signer transport only allows opening its
 * popup window synchronously within the same click event's dispatch; any
 * `await` beforehand — even one that resolves immediately — yields back to
 * the browser, which finishes the click event (and its "was this a click?"
 * bookkeeping) before our code resumes. Call this once, e.g. on mount, well
 * before the user can click the sign-in button.
 */
export function warmInternetIdentityAuthClient(): Promise<void> {
  warmupPromise ??= getAuthClient().then(() => undefined, () => undefined);
  return warmupPromise;
}

/** Synchronous fast-path used by `signInWithInternetIdentity` when already warmed. */
function getWarmedAuthClient(): { client: InternetIdentityAuthClient; target: IcpTargetConfig } | undefined {
  const target = getActiveIcpTarget();
  return activeClient && activeTarget?.alias === target.alias ? { client: activeClient, target } : undefined;
}

export async function signInWithInternetIdentity(returnTo?: string): Promise<InternetIdentitySession> {
  const { client, target } = getWarmedAuthClient() ?? (await getAuthClient());
  const identity = client.isAuthenticated() ? await client.getIdentity() : await client.signIn(returnTo ? { returnTo } : undefined);
  const principal = identity.getPrincipal();
  if (principal.isAnonymous() || principal.toText() === "2vxsx-fae") {
    throw new Error("Internet Identity returned an anonymous principal.");
  }
  const principalText = principal.toText();
  await provisionInternetIdentityAccount(identity, principalText, target);
  return { principal: principalText, provider: "internet-identity" };
}

export async function signOutInternetIdentity(): Promise<void> {
  const client = activeClient;
  activeClient = undefined;
  activeTarget = undefined;
  await client?.signOut();
  client?.dispose?.();
}

export function resetInternetIdentityAuthForTests(): void {
  activeClient?.dispose?.();
  activeClient = undefined;
  activeTarget = undefined;
  warmupPromise = undefined;
  accountProvisionerOverride = undefined;
}

