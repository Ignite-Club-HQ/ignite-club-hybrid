import type { Identity } from "@icp-sdk/core/agent";
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

  type Held = { identity: Identity; chain: InstanceType<typeof DelegationChain> };
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

  const valid = () => !!held && isDelegationValid(held.chain);

  return {
    isAuthenticated: valid,
    async getIdentity() {
      return held && valid() ? held.identity : new AnonymousIdentity();
    },
    async signIn() {
      const key = Ed25519KeyIdentity.generate();
      const nonce = crypto.randomUUID();
      const url =
        `${BRIDGE_ORIGIN}/native-sign-in.html#pk=${toHex(key.getPublicKey().toDer())}` +
        `&n=${nonce}&cb=${encodeURIComponent(NATIVE_II_CALLBACK)}`;

      const identity = await new Promise<Identity>((resolve, reject) => {
        let done = false;
        const handles: Array<{ remove: () => Promise<void> }> = [];
        const finish = (fn: () => void) => {
          if (done) return;
          done = true;
          handles.forEach((h) => void h.remove());
          fn();
        };
        const register = async () => {
        handles.push(await App.addListener("appUrlOpen", ({ url: back }) => {
          if (!isNativeIiCallback(back)) return;
          const params = new URLSearchParams(back.split("#")[1] ?? "");
          // Ignore unrelated/stale returns without cancelling this sign-in.
          if (params.get("n") !== nonce) return;
          void Browser.close().catch(() => undefined);
          finish(() => {
            try {
              if (params.get("cancel") === "1") throw new Error("Sign-in was cancelled.");
              const chain = DelegationChain.fromJSON(fromB64url(params.get("d") ?? ""));
              if (!isDelegationValid(chain)) throw new Error("Sign-in reply has expired.");
              const id = DelegationIdentity.fromDelegation(key, chain);
              localStorage.setItem(STORAGE_KEY, JSON.stringify({ key: key.toJSON(), chain: chain.toJSON() }));
              held = { identity: id, chain };
              resolve(id);
            } catch (e) {
              reject(e);
            }
          });
        }));
        // Closing the browser without finishing = cancelled. Small delay so a
        // reply arriving as the browser closes still wins.
        handles.push(await Browser.addListener("browserFinished", () => {
          setTimeout(() => finish(() => reject(new Error("Sign-in was cancelled."))), 1500);
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
      try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    },
  };
}
