import type { Identity } from "@icp-sdk/core/agent";
import { Principal } from "@icp-sdk/core/principal";
import { fetchLocalLabConfig, type LocalLabConfig } from "./localActor";

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

type AuthClientFactory = (options: {
  identityProvider: {
    authorizeUrl: string | URL;
    canisterId: string;
  };
  agentOptions: {
    host: string;
    rootKey: Uint8Array;
    shouldFetchRootKey: false;
    shouldSyncTime: false;
    fetch: typeof fetch;
  };
  transport: "window";
}) => InternetIdentityAuthClient;

type AccountProvisioner = (identity: Identity, principal: string) => Promise<void>;

let authClientFactoryOverride: AuthClientFactory | undefined;
let accountProvisionerOverride: AccountProvisioner | undefined;

export function setInternetIdentityAuthClientFactoryForTests(factory: AuthClientFactory | undefined): void {
  authClientFactoryOverride = factory;
}

export function setInternetIdentityAccountProvisionerForTests(provisioner: AccountProvisioner | undefined): void {
  accountProvisionerOverride = provisioner;
}

function localReplicaFetch(origin: string): typeof fetch {
  return (input, init) => {
    const target = new URL(typeof input === "string" || input instanceof URL ? input : input.url, origin);
    const base = new URL(origin);
    if (
      target.origin !== base.origin ||
      !/^\/api\/(v2|v3|v4)\//.test(target.pathname) ||
      target.username ||
      target.password ||
      target.hash ||
      !["http:", "https:"].includes(target.protocol)
    ) {
      throw new Error("Non-local Internet Identity request blocked");
    }
    target.pathname = `/icp${target.pathname}`;
    return fetch(target, { ...init, credentials: "omit", redirect: "error", cache: "no-store" });
  };
}

function resolveLocalInternetIdentityProvider(config: LocalLabConfig): { authorizeUrl: URL; canisterId: string } {
  const rawConfig = config as LocalLabConfig & {
    internetIdentityCanisterId?: string;
    internetIdentityAuthorizeUrl?: string;
  };
  const canisterId = rawConfig.internetIdentityCanisterId ?? config.canisterIds?.internet_identity;
  if (!canisterId) {
    throw new Error("Local Internet Identity is not configured for this ICP lab network.");
  }

  const principal = Principal.fromText(canisterId);
  if (principal.isAnonymous() || principal.toText() === "aaaaa-aa") {
    throw new Error("Local Internet Identity canister ID is invalid.");
  }

  if (!rawConfig.internetIdentityAuthorizeUrl) {
    throw new Error("Local Internet Identity authorize URL is not configured for this ICP lab network.");
  }
  const authorizeUrl = new URL(rawConfig.internetIdentityAuthorizeUrl);
  const localHostnames = new Set(["id.ai.localhost", "localhost", "127.0.0.1", "[::1]"]);
  if (authorizeUrl.protocol !== "http:" || !localHostnames.has(authorizeUrl.hostname) || authorizeUrl.pathname !== "/authorize" || authorizeUrl.username || authorizeUrl.password) {
    throw new Error("Only local Internet Identity authorize URLs are allowed in the ICP lab.");
  }

  return { authorizeUrl, canisterId: principal.toText() };
}

async function createDefaultAuthClient(): Promise<InternetIdentityAuthClient> {
  const config = await fetchLocalLabConfig();
  const provider = resolveLocalInternetIdentityProvider(config);
  const { AuthClient } = await import("@icp-sdk/auth/client");
  return new AuthClient({
    identityProvider: provider,
    agentOptions: {
      host: location.origin,
      rootKey: Uint8Array.from(config.rootKey.match(/../g)!, b => parseInt(b, 16)),
      shouldFetchRootKey: false,
      shouldSyncTime: false,
      fetch: localReplicaFetch(location.origin),
    },
    transport: "window",
  });
}

async function createAuthClient(): Promise<InternetIdentityAuthClient> {
  if (authClientFactoryOverride) {
    const config = await fetchLocalLabConfig();
    const provider = resolveLocalInternetIdentityProvider(config);
    return authClientFactoryOverride({
      identityProvider: provider,
      agentOptions: {
        host: location.origin,
        rootKey: Uint8Array.from(config.rootKey.match(/../g)!, b => parseInt(b, 16)),
        shouldFetchRootKey: false,
        shouldSyncTime: false,
        fetch: localReplicaFetch(location.origin),
      },
      transport: "window",
    });
  }
  return createDefaultAuthClient();
}

async function provisionInternetIdentityAccount(identity: Identity, principal: string): Promise<void> {
  if (accountProvisionerOverride) {
    await accountProvisionerOverride(identity, principal);
    return;
  }

  const { connectLocalIdentityAccessClientWithIdentity } = await import("./localIdentityAccess");
  const { client } = await connectLocalIdentityAccessClientWithIdentity(identity);
  await client.registerAccount();
}

let activeClient: InternetIdentityAuthClient | undefined;
let warmupPromise: Promise<void> | undefined;

async function getAuthClient(): Promise<InternetIdentityAuthClient> {
  activeClient ??= await createAuthClient();
  return activeClient;
}

/**
 * Pre-constructs the Internet Identity auth client ahead of time (fetching
 * local lab config, resolving the provider, loading the `@icp-sdk/auth`
 * chunk) so the eventual `signInWithInternetIdentity()` call made from a
 * click handler doesn't need to `await` anything before reaching
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
function getWarmedAuthClient(): InternetIdentityAuthClient | undefined {
  return activeClient;
}

export async function signInWithInternetIdentity(returnTo?: string): Promise<InternetIdentitySession> {
  const client = getWarmedAuthClient() ?? (await getAuthClient());
  const identity = client.isAuthenticated() ? await client.getIdentity() : await client.signIn(returnTo ? { returnTo } : undefined);
  const principal = identity.getPrincipal();
  if (principal.isAnonymous() || principal.toText() === "2vxsx-fae") {
    throw new Error("Internet Identity returned an anonymous principal.");
  }
  const principalText = principal.toText();
  await provisionInternetIdentityAccount(identity, principalText);
  return { principal: principalText, provider: "internet-identity" };
}

export async function signOutInternetIdentity(): Promise<void> {
  const client = activeClient;
  activeClient = undefined;
  await client?.signOut();
  client?.dispose?.();
}

export function resetInternetIdentityAuthForTests(): void {
  activeClient?.dispose?.();
  activeClient = undefined;
  warmupPromise = undefined;
  authClientFactoryOverride = undefined;
  accountProvisionerOverride = undefined;
}
