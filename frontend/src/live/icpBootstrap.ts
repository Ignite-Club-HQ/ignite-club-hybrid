import { hasInternetIdentitySessionStored, isSignedInWithEmail, readAuthChoice } from "./authBackendMode";
/** Select a config source only; this never grants roles or resource access. */
export function shouldBootstrapFromIcp(): boolean {
  if (isSignedInWithEmail() || readAuthChoice() === "supabase") return false;
  if (hasInternetIdentitySessionStored() || readAuthChoice() === "icp") return true;
  try {
    const host = window.location.hostname.toLowerCase();
    if (/\.(icp0\.io|icp\.net|ic0\.app)$/.test(host)) return true;
    return false;
  } catch { return false; }
}