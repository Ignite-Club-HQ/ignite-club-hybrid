import type { Identity } from "@icp-sdk/core/agent";
import type { DelegationChain as DelegationChainT, Ed25519KeyIdentity as Ed25519KeyIdentityT } from "@icp-sdk/core/identity";
import type { InternetIdentityAuthClient } from "./internetIdentityAuth";

/**
 * Internet Identity for the native (Capacitor) app, which runs a built-in
 * copy from a private origin (https://localhost / capacitor://localhost).
 * Signing in from that origin would derive a different account than the
 * website, so the app keeps its own session key and opens the sign-in bridge
 * page on the frontend canister in the system browser (SFSafariViewController /
 * Custom Tabs). The bridge asks Internet Identity to delegate to our key and
 * returns the chain via the app's URL scheme. Same account as the website.
 */
export const NATIVE_II_CALLBACK = "com.igniteclubhq.app://ii-callback";
const BRIDGE_ORIGIN =
  (import.meta.env.IGNITE_LIVE_NATIVE_II_BRIDGE_ORIGIN as string | undefined) ||
  "https://proe7-kqaaa-aaaas-qg6gq-cai.icp0.io";
const STORAGE_KEY = "ignite_native_ii_session_v1";
// The sign-in in progress, kept on the device so a reply still lands if Android
// closed the app while the browser was open (the in-memory listener is gone).
const PENDING_KEY = "ignite_native_ii_pending_v1";
const PENDING_TTL_MS = 10 * 60 * 1000;

/** Reply data travels in the query (Android intent:// links) or the hash (older bridge). */
export function readNativeIiReply(url: string): URLSearchParams {
  const out = new URLSearchParams();
  const hash = url.includes("#") ? url.slice(url.indexOf("#") + 1) : "";
  const beforeHash = url.split("#")[0];
  const query = beforeHash.includes("?") ? beforeHash.slice(beforeHash.indexOf("?") + 1) : "";
  for (const part of [query, hash]) new URLSearchParams(part).forEach((v, k) => { if (!out.has(k)) out.set(k, v); });
  return out;
}

export function isNativeIiCallback(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "com.igniteclubhq.app:" && parsed.hostname === "ii-callback" &&
      (parsed.pathname === "" || parsed.pathname === "/") && !parsed.username && !parsed.password && !parsed.port;
  } catch {
    return false;
  }
}

function toHex(bytes: ArrayBuffer | Uint8Array): string {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function fromB64url(s: string): string {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  return decodeURIComponent(escape(atob(b64)));
}

export async function createNativeAuthClient(): Promise<InternetIdentityAuthClient> {
  const [{ Ed25519KeyIdentity, DelegationChain, DelegationIdentity, isDelegationValid }, { AnonymousIdentity }, { App }, { Browser }] =
    await Promise.all([
      import("@icp-sdk/core/identity"),
      import("@icp-sdk/core/agent"),
      import("@capacitor/app"),
      import("@capacitor/browser"),
    ]);

  type Held = { identity: Identity; chain: DelegationChainT };
  let held: Held | null = null;

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const { key, chain } = JSON.parse(raw);
      const k = Ed25519KeyIdentity.fromJSON(JSON.stringify(key));
      const c = DelegationChain.fromJSON(chain);
      if (isDelegationValid(c)) held = { identity: DelegationIdentity.fromDelegation(k, c), chain: c };
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  const accept = (key: Ed25519KeyIdentityT, params: URLSearchParams): Identity => {
    if (params.get("cancel") === "1") throw new Error("Sign-in was cancelled in the browser.");
    let chain: DelegationChainT;
    try {
      chain = DelegationChain.fromJSON(fromB64url(params.get("d") ?? ""));
    } catch (e) {
      throw new Error(`Sign-in reply couldn't be read (${e instanceof Error ? e.message : "unknown"}). Please try again.`);
    }
    if (!isDelegationValid(chain)) throw new Error("Sign-in reply has expired.");
    const id = DelegationIdentity.fromDelegation(key, chain);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: key.toJSON(), chain: chain.toJSON() }));
    try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    held = { identity: id, chain };
    return id;
  };

  // Cold start: Android may have closed the app while the browser was open.
  // The reply then arrives as the launch link instead of to a live listener.
  if (!held) {
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      const pending = raw ? JSON.parse(raw) as { key: unknown; nonce: string; at: number } : null;
      if (pending && Date.now() - pending.at < PENDING_TTL_MS) {
        const launch = await App.getLaunchUrl().catch(() => undefined);
        if (launch?.url && isNativeIiCallback(launch.url)) {
          const params = readNativeIiReply(launch.url);
          if (params.get("n") === pending.nonce && params.get("d")) {
            accept(Ed25519KeyIdentity.fromJSON(JSON.stringify(pending.key)), params);
          }
        }
      } else if (raw) {
        localStorage.removeItem(PENDING_KEY);
      }
    } catch {
      try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    }
  }

  const valid = () => !!held && isDelegationValid(held.chain);

  // Late replies: the sign-in screen may already have given up (the browser
  // closed before Android delivered the reply, or the person tapped "Open
  // Ignite" later). Any reply matching the saved pending sign-in still counts:
  // store it and reload so the app starts signed in.
  let waiting = false;
  void App.addListener("appUrlOpen", ({ url: back }) => {
    if (waiting || !isNativeIiCallback(back)) return;
    try {
      const raw = localStorage.getItem(PENDING_KEY);
      const pending = raw ? JSON.parse(raw) as { key: unknown; nonce: string; at: number } : null;
      if (!pending || Date.now() - pending.at > PENDING_TTL_MS) return;
      const params = readNativeIiReply(back);
      if (params.get("n") !== pending.nonce || !params.get("d")) return;
      void Browser.close().catch(() => undefined);
      accept(Ed25519KeyIdentity.fromJSON(JSON.stringify(pending.key)), params);
      window.location.reload();
    } catch { /* ignore malformed replies */ }
  }).catch(() => undefined);

  return {
    isAuthenticated: valid,
    async getIdentity() {
      return held && valid() ? held.identity : new AnonymousIdentity();
    },
    async signIn() {
      const key = Ed25519KeyIdentity.generate();
      const nonce = crypto.randomUUID();
      try {
        localStorage.setItem(PENDING_KEY, JSON.stringify({ key: key.toJSON(), nonce, at: Date.now() }));
      } catch { /* storage full or blocked: live listener still works */ }
      const url =
        `${BRIDGE_ORIGIN}/native-sign-in.html#pk=${toHex(key.getPublicKey().toDer())}` +
        `&n=${nonce}&cb=${encodeURIComponent(NATIVE_II_CALLBACK)}`;

      waiting = true;
      const identity = await new Promise<Identity>((resolve, reject) => {
        let done = false;
        const handles: Array<{ remove: () => Promise<void> }> = [];
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          waiting = false;
          handles.forEach((h) => void h.remove());
          fn();
        };
        let seen = "";
        const register = async () => {
        handles.push(await App.addListener("appUrlOpen", ({ url: back }) => {
          if (!isNativeIiCallback(back)) return;
          const params = readNativeIiReply(back);
          // Ignore unrelated/stale returns without cancelling this sign-in.
          if (params.get("n") !== nonce) { seen = "a reply for an older sign-in attempt"; return; }
          void Browser.close().catch(() => undefined);
          finish(() => {
            try {
              resolve(accept(key, params));
            } catch (e) {
              if (params.get("cancel") === "1") { try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ } }
              reject(e);
            }
          });
        }));
        // Closing the browser without finishing = cancelled. Grace period so a
        // reply arriving as the browser closes still wins.
        handles.push(await Browser.addListener("browserFinished", () => {
          // Android closes the browser as it hands the reply to the app; the
          // reply can land a few seconds later on a busy phone.
          setTimeout(() => finish(() => reject(new Error(
            seen
              ? `Sign-in didn't finish: the app got ${seen}. Please try again.`
              : "Sign-in didn't come back to the app. If the browser showed \"You're signed in\", tap Open Ignite there next time.",
          ))), 20000);
        }));
        // Both return/cancellation listeners must exist before opening the browser.
        await Browser.open({ url, presentationStyle: "popover" });
        };
        void register().catch((e) => finish(() => reject(e)));
      });
      return identity;
    },
    async signOut() {
      held = null;
      try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
    },
  };
}
