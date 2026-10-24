import type { FeatureBackendContext } from "./featureRouter";

/** Only the external delivery worker holds the matching private key. */
export async function encryptEmailPayload(ctx: FeatureBackendContext, payload: { to: string; subject: string; text: string; resource: string; code?: string }) {
  const { connectLiveClubDomain } = await import("./domains");
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  const config = await actor.get_app_config("email_worker_public_key");
  const raw = config[0];
  if (!raw) throw new Error("Email delivery has not been configured yet.");
  const jwk = JSON.parse(raw) as JsonWebKey;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
  const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, aes, bytes);
  const wrapped = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, await crypto.subtle.exportKey("raw", aes));
  const b64 = (v: ArrayBuffer | Uint8Array) => {
    let binary = "";
    for (const byte of new Uint8Array(v)) binary += String.fromCharCode(byte);
    return btoa(binary);
  };
  return JSON.stringify({ v: 1, key: b64(wrapped), iv: b64(iv), ciphertext: b64(ciphertext) });
}