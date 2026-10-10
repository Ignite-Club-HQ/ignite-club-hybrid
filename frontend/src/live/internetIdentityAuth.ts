import type { Identity } from "@icp-sdk/core/agent";
import { getActiveIcpTarget, type IcpTargetConfig } from "./targetRegistry";
// NOTE: icpAgent/piiVetKeys are imported lazily at the call sites below so
// this module — which sits on the boot path via featureRouter/useAuth — does
// not drag the ICP agent/candid/vetKeys SDKs into the entry chunk.


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
 *   - Backend  (trusted signer, mints delegations): rdmx6-jaaaa-aaaaa-aaadq-cai
 *   - Frontend (serves the sign-in web app):       uqzsh-gqaaa-aaaaq-qaada-cai, at https://id.ai
 * `identityProvider.canisterId` must name the BACKEND (the canister whose
 * delegation chain the SDK validates), not the frontend that serves id.ai —
 * naming the frontend makes every sign-in fail with "A session chain must be
 * restricted to uqzsh-…, but this one also names rdmx6-…". On mainnet we omit
 * `identityProvider` entirely and let the SDK use its built-in defaults
 * (https://id.ai/authorize + rdmx6-jaaaa-aaaaa-aaadq-cai).
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

const MAINNET_INTERNET_IDENTITY_AUTHORIZE_URL = "https://id.ai/authorize";

type AccountProvisioner = (identity: Identity, principal: string, target: IcpTargetConfig) => Promise<void>;

let accountProvisionerOverride: AccountProvisioner | undefined;

export function setInternetIdentityAccountProvisionerForTests(provisioner: AccountProvisioner | undefined): void {
  accountProvisionerOverride = provisioner;
}

function resolveInternetIdentityProvider(target: IcpTargetConfig): { authorizeUrl: string; canisterId: string } | undefined {
  // Approved targets may override the authorize URL for a Cloud Engine deployment
  // that fronts its own Internet Identity instance. Public mainnet returns
  // undefined so the SDK uses its built-in defaults (https://id.ai/authorize +
  // the II backend canister that mints delegations).
  if (target.networkKind === "cloud_engine" && target.canisterIds.internet_identity_frontend) {
    const authorizeUrl = target.supportedDomains?.[0]
      ? `https://${target.supportedDomains[0]}/authorize`
      : MAINNET_INTERNET_IDENTITY_AUTHORIZE_URL;
    return { authorizeUrl, canisterId: target.canisterIds.internet_identity_frontend };
  }
  return undefined;
}

/**
 * Internet Identity gives a DIFFERENT principal per site address, so the
 * preview and the published site would otherwise create two separate
 * accounts for the same person. Every alternative address signs in "as" the
 * published site; the published site lists them in
 * /.well-known/ii-alternative-origins.
 */
const CANONICAL_II_ORIGIN = "https://ignite-canister-connect.lovable.app";
const II_ALTERNATIVE_ORIGINS = new Set([
  "https://id-preview--9e0ff3f7-539e-4a59-aa6d-a6d3fe4c7c5e.lovable.app",
  "https://project--9e0ff3f7-539e-4a59-aa6d-a6d3fe4c7c5e.lovable.app",
  "https://project--9e0ff3f7-539e-4a59-aa6d-a6d3fe4c7c5e-dev.lovable.app",
]);

// The ICP frontend canister keeps accounts separate from the Lovable sites
// (user decision 2026-10-07), but ALL of the canister's own addresses
// (<id>.icp.net, <id>.raw.icp0.io, <id>.ic0.app, ...) sign in as
// https://<id>.icp0.io so one person gets one identity whichever address
// they open. The canister lists them in its /.well-known/ii-alternative-origins
// (written by scripts/prepare-canister-dist.mjs).
const CANISTER_ALIAS_HOST = /^([a-z0-9]{5}(?:-[a-z0-9]{5}){3}-cai)\.(?:raw\.icp0\.io|icp\.net|raw\.icp\.net|ic0\.app|raw\.ic0\.app)$/;

export function resolveDerivationOriginFor(origin: string): string | undefined {
  if (II_ALTERNATIVE_ORIGINS.has(origin)) return CANONICAL_II_ORIGIN;
  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return undefined;
    host = url.hostname;
  } catch {
    return undefined;
  }
  const match = CANISTER_ALIAS_HOST.exec(host);
  return match ? `https://${match[1]}.icp0.io` : undefined;
}

function resolveDerivationOrigin(): string | undefined {
  if (typeof window === "undefined") return undefined;
  return resolveDerivationOriginFor(window.location.origin);
}

/**
 * Phones sign in by sending the whole page to Internet Identity and back
 * (redirect), not through a second tab. Why: on Android/iOS the second tab
 * pushes the app's tab into the background, the phone pauses it, and Internet
 * Identity then shows "Connection closed" — on almost every sign-in on a busy
 * phone. Only on the frontend canister's own addresses, because the return
 * address must be listed in that site's /.well-known/ii-auth-callbacks
 * (written by scripts/prepare-canister-dist.mjs).
 */
export const II_REDIRECT_CALLBACK_PATH = "/auth";
const II_REDIRECT_PENDING_KEY = "ignite_ii_redirect_pending";
const II_REDIRECT_MAX_AGE_MS = 10 * 60 * 1000;
const CANISTER_HOST = /^[a-z0-9]{5}(?:-[a-z0-9]{5}){3}-cai\.(?:icp0\.io|raw\.icp0\.io|icp\.net|raw\.icp\.net|ic0\.app|raw\.ic0\.app)$/;

export function shouldUseRedirectSignIn(origin: string, userAgent: string, maxTouchPoints = 0): boolean {
  let host: string;
  try {
    const url = new URL(origin);
    if (url.protocol !== "https:") return false;
    host = url.hostname;
  } catch {
    return false;
  }
  if (!CANISTER_HOST.test(host)) return false;
  // iPadOS reports a desktop Mac user agent; touch points give it away.
  const iPadOs = /Macintosh/.test(userAgent) && maxTouchPoints > 1;
  return iPadOs || /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}

function useRedirectSignIn(): boolean {
  if (typeof window === "undefined" || typeof navigator === "undefined") return false;
  return shouldUseRedirectSignIn(window.location.origin, navigator.userAgent, navigator.maxTouchPoints ?? 0);
}

async function createDefaultAuthClient(target: IcpTargetConfig): Promise<InternetIdentityAuthClient> {
  // Phone app: built-in copy runs from a private origin, so sign in through
  // the canister-hosted bridge in the system browser (same account as web).
  const { Capacitor } = await import("@capacitor/core");
  if (Capacitor.isNativePlatform()) {
    const { createNativeAuthClient } = await import("./nativeInternetIdentity");
    return createNativeAuthClient();
  }
  const provider = resolveInternetIdentityProvider(target);
  const derivationOrigin = resolveDerivationOrigin();
  const { AuthClient } = await import("@icp-sdk/auth/client");
  return new AuthClient({
    ...(provider ? { identityProvider: provider } : {}),
    ...(derivationOrigin ? { derivationOrigin } : {}),
    agentOptions: {
      host: target.host,
    },
    transport: useRedirectSignIn() ? "redirect" : "window",
  }) as unknown as InternetIdentityAuthClient;
}

function readRedirectPending(): boolean {
  try {
    const raw = sessionStorage.getItem(II_REDIRECT_PENDING_KEY);
    if (!raw) return false;
    return Date.now() - Number(raw) < II_REDIRECT_MAX_AGE_MS;
  } catch {
    return false;
  }
}

function clearRedirectPending(): void {
  try { sessionStorage.removeItem(II_REDIRECT_PENDING_KEY); } catch { /* ignore */ }
}

/**
 * True on the page load where Internet Identity has just sent the member
 * back after a phone (redirect) sign-in.
 */
export function isInternetIdentityRedirectReturn(): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.pathname !== II_REDIRECT_CALLBACK_PATH) return false;
  const params = new URLSearchParams(window.location.hash.slice(1));
  return params.has("message") && params.has("state") && readRedirectPending();
}

/**
 * Finishes a phone (redirect) sign-in on the return load, before the app
 * renders (the sign-in reply is in the address and must be read before the
 * router touches it). On success the sign-in library stores the session and
 * reloads the page the member started from, where the normal resume picks
 * it up. Never starts a new sign-in.
 */
export async function completeInternetIdentityRedirect(): Promise<void> {
  if (!isInternetIdentityRedirectReturn()) return;
  // Cleared first so a failure can never loop the member back to II.
  clearRedirectPending();
  try {
    const target = getActiveIcpTarget();
    activeClient?.dispose?.();
    activeClient = await createDefaultAuthClient(target);
    activeTarget = target;
    // Same call shape as the first leg, so the library replays its journal
    // (the real return address was saved on that leg).
    await activeClient.signIn({ returnTo: II_REDIRECT_CALLBACK_PATH });
  } catch (error) {
    console.warn("[InternetIdentity] Could not finish the phone sign-in:", error);
  }
}

async function startRedirectSignIn(target: IcpTargetConfig, returnTo?: string): Promise<never> {
  // The return address must exactly match the allow-list entry, and the
  // library takes it from the page address when the client is built.
  if (window.location.pathname !== II_REDIRECT_CALLBACK_PATH) {
    window.history.replaceState(window.history.state, "", `${II_REDIRECT_CALLBACK_PATH}${window.location.search}`);
  }
  activeClient?.dispose?.();
  activeClient = await createDefaultAuthClient(target);
  activeTarget = target;
  try { sessionStorage.setItem(II_REDIRECT_PENDING_KEY, String(Date.now())); } catch { /* ignore */ }
  try {
    await activeClient.signIn({ returnTo: returnTo || II_REDIRECT_CALLBACK_PATH });
  } catch (error) {
    clearRedirectPending();
    throw error;
  }
  // signIn() navigated the page to Internet Identity; nothing more happens here.
  return new Promise<never>(() => undefined);
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
  if (getWarmedAuthClient()) return Promise.resolve();
  // A failed warm-up (flaky phone connection loading the sign-in code) must
  // not be cached — otherwise the first tap pays the load and loses the
  // click, which members experienced as "I have to tap sign-in twice".
  warmupPromise ??= getAuthClient().then(
    () => undefined,
    () => {
      warmupPromise = undefined;
    },
  );
  return warmupPromise;
}

/**
 * True once the auth client is constructed for the current target, i.e. a
 * tap on the sign-in button can reach `client.signIn()` with no awaits in
 * front of it. The sign-in button stays disabled until this is true.
 */
export function isInternetIdentitySignInReady(): boolean {
  try {
    return Boolean(getWarmedAuthClient());
  } catch {
    return false;
  }
}

/** Synchronous fast-path used by `signInWithInternetIdentity` when already warmed. */
function getWarmedAuthClient(): { client: InternetIdentityAuthClient; target: IcpTargetConfig } | undefined {
  const target = getActiveIcpTarget();
  return activeClient && activeTarget?.alias === target.alias ? { client: activeClient, target } : undefined;
}

/**
 * Calls `client.signIn()` and recovers when the window channel to id.ai dies
 * on the way back. On Android Chrome the II ceremony runs in a separate tab;
 * while it's open our tab is hidden and the signer's postMessage channel is
 * throttled or dropped, so the `signIn()` promise rejects with "Channel was
 * closed…" (or never settles) even though Internet Identity already stored a
 * valid session. Members experienced this as "I had to tap sign in twice":
 * the second tap took the `isAuthenticated()` fast path. When our tab becomes
 * visible again, poll briefly for that stored session and use it — and if the
 * promise still rejects afterwards, check one last time before giving up.
 */
async function signInWithStoredSessionRecovery(
  client: InternetIdentityAuthClient,
  returnTo?: string,
): Promise<Identity> {
  const signInPromise = client.signIn(returnTo ? { returnTo } : undefined);

  const recoveredFromStoredSession = (async (): Promise<Identity | null> => {
    if (typeof document === "undefined") return null;
    await new Promise<void>((resolve) => {
      if (document.visibilityState === "visible") {
        resolve();
        return;
      }
      const onVisible = () => {
        if (document.visibilityState === "visible") {
          document.removeEventListener("visibilitychange", onVisible);
          resolve();
        }
      };
      document.addEventListener("visibilitychange", onVisible);
    });
    // Our tab is back in front. II stores its session near the end of the
    // ceremony, so give it a few seconds to appear.
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      if (client.isAuthenticated()) return client.getIdentity();
      await new Promise((r) => setTimeout(r, 300));
    }
    return null;
  })();

  const settled = await Promise.race([
    signInPromise.then(
      (identity) => ({ kind: "signed-in" as const, identity }),
      (error) => ({ kind: "failed" as const, error }),
    ),
    recoveredFromStoredSession.then((identity) =>
      identity ? ({ kind: "recovered" as const, identity }) : ({ kind: "no-stored-session" as const }),
    ),
  ]);

  if (settled.kind === "signed-in") return settled.identity;
  if (settled.kind === "recovered") {
    console.warn("[InternetIdentity] Sign-in channel did not answer; using the stored Internet Identity session.");
    // The original promise may reject later (channel closed) — swallow it so
    // it never surfaces as an unhandled rejection.
    void signInPromise.catch(() => undefined);
    return settled.identity;
  }
  if (settled.kind === "failed") {
    if (client.isAuthenticated()) {
      console.warn("[InternetIdentity] Sign-in failed after II stored a session; recovering.", settled.error);
      return client.getIdentity();
    }
    throw settled.error;
  }
  // No stored session appeared within the window — keep waiting for the
  // real answer (desktop popup still open, or a slow connection).
  try {
    return await signInPromise;
  } catch (error) {
    if (client.isAuthenticated()) {
      console.warn("[InternetIdentity] Sign-in failed after II stored a session; recovering.", error);
      return client.getIdentity();
    }
    throw error;
  }
}

/**
 * Set when the member explicitly signs out. While set, the silent resume
 * path must NOT adopt the stored delegation again — otherwise sign-out
 * immediately re-signs the member in (the delegation outlives the click)
 * and the auth screen hangs on "Finishing sign in…". Cleared only by an
 * explicit tap on "Continue with Internet Identity".
 */
let signOutRequested = false;

export async function signInWithInternetIdentity(returnTo?: string): Promise<InternetIdentitySession> {
  // An explicit tap always re-arms the silent resume path.
  signOutRequested = false;
  const { client, target } = getWarmedAuthClient() ?? (await getAuthClient());
  const identity = client.isAuthenticated()
    ? await client.getIdentity()
    : await signInWithStoredSessionRecovery(client, returnTo);
  const principal = identity.getPrincipal();
  if (principal.isAnonymous() || principal.toText() === "2vxsx-fae") {
    throw new Error("Internet Identity returned an anonymous principal.");
  }
  const principalText = principal.toText();
  await provisionInternetIdentityAccount(identity, principalText, target);
  return { principal: principalText, provider: "internet-identity" };
}

/**
 * Adopts an Internet Identity session the auth client already holds, without
 * ever opening a window. Returns null when there is none.
 *
 * Why: on phones the II ceremony runs in a separate tab, and the app's tab
 * can be reloaded (Chrome discards background tabs) or lose the reply on the
 * way back — yet the auth client has already stored the delegation. The app
 * only marked itself signed in after `signIn()` resolved, so members landed
 * back on the sign-in screen and had to tap again (which then took the
 * `isAuthenticated()` fast path). Call this on load and when the tab returns.
 */
export async function resumeInternetIdentitySession(): Promise<InternetIdentitySession | null> {
  // The member tapped sign out and hasn't explicitly signed back in —
  // never undo that by adopting the still-stored delegation.
  if (signOutRequested) return null;
  const { client, target } = getWarmedAuthClient() ?? (await getAuthClient());
  // getIdentity() waits for the client's async restore from storage.
  const identity = await client.getIdentity();
  if (!client.isAuthenticated()) return null;
  const principal = identity.getPrincipal();
  if (principal.isAnonymous() || principal.toText() === "2vxsx-fae") return null;
  const principalText = principal.toText();
  await provisionInternetIdentityAccount(identity, principalText, target);
  return { principal: principalText, provider: "internet-identity" };
}

/**
 * The identity of the currently signed-in Internet Identity session, or null
 * when signed out (or when the auth client has not been constructed yet).
 * Feature repositories routed to ICP use this to authenticate canister calls.
 */
export async function getCurrentInternetIdentity(): Promise<Identity | null> {
  if (!activeClient) return null;
  try {
    // getIdentity() waits for the client's async restore from storage;
    // checking isAuthenticated() first can answer "no" during that window and
    // make a perfectly valid session look expired.
    const identity = await activeClient.getIdentity();
    if (!activeClient.isAuthenticated()) return null;
    const principal = identity.getPrincipal();
    if (principal.isAnonymous() || principal.toText() === "2vxsx-fae") return null;
    return identity;
  } catch {
    return null;
  }
}

/**
 * Like getCurrentInternetIdentity, but only answers null after the session is
 * still missing across several checks. The auth client briefly reports
 * "not signed in" while it re-mints its short-lived session or re-reads
 * storage after another tab wrote it; treating that blip as sign-out dropped
 * active members back through sign-in.
 */
export async function getCurrentInternetIdentityConfirmed(attempts = 4, delayMs = 1500): Promise<Identity | null> {
  for (let i = 0; i < attempts; i++) {
    const identity = await getCurrentInternetIdentity();
    if (identity) return identity;
    if (signOutRequested) return null;
    if (i < attempts - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return null;
}

export async function signOutInternetIdentity(): Promise<void> {
  // Block the silent resume path FIRST, before any await: the auth hook
  // clears its session state right after calling us, and a resume racing
  // in between must find this flag already set.
  signOutRequested = true;
  const client = activeClient;
  activeClient = undefined;
  activeTarget = undefined;
  // The cached warm-up promise is already resolved; without clearing it the
  // next warm-up call returns instantly with no client, the button looks
  // ready, and the first tap after sign-out loses its click ("The sign-in
  // window couldn't open in time").
  warmupPromise = undefined;
  const [{ clearLiveAgentCache }, { clearPiiVetKeyCache }] = await Promise.all([
    import("./icpAgent"),
    import("./piiVetKeys"),
  ]);
  clearLiveAgentCache();
  clearPiiVetKeyCache();
  try { localStorage.removeItem("ignite_query_cache_v1"); } catch { /* ignore */ }
  await client?.signOut();
  client?.dispose?.();
}

export function resetInternetIdentityAuthForTests(): void {
  signOutRequested = false;
  activeClient?.dispose?.();
  activeClient = undefined;
  activeTarget = undefined;
  warmupPromise = undefined;
  accountProvisionerOverride = undefined;
  void Promise.all([import("./icpAgent"), import("./piiVetKeys")]).then(
    ([{ clearLiveAgentCache }, { clearPiiVetKeyCache }]) => {
      clearLiveAgentCache();
      clearPiiVetKeyCache();
    },
  );
}

