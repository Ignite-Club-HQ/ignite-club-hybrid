import { hasInternetIdentitySessionStored, isSignedInWithEmail, readAuthChoice, resolveAuthBackend } from "./authBackendMode";
import { getActiveSupabaseTarget } from "./targetRegistry";

export const ICP_FALLBACK_BLOCKED_EVENT = "ignite:icp-fallback-blocked";

/** No SDK imports: this guard also runs before the app's first render. */
export function strictIcpActive(): boolean {
  if (isSignedInWithEmail()) return false;
  return hasInternetIdentitySessionStored() || readAuthChoice() === "icp" || resolveAuthBackend() === "icp";
}

export function reportBlockedFallback(label: string): Error {
  const message = `ICP testing blocked a Supabase fallback: ${label}.`;
  // Labels contain only service/table names, never URLs, filters or payloads.
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(ICP_FALLBACK_BLOCKED_EVENT, { detail: message }));
  return new Error(message);
}

function requestUrl(input: RequestInfo | URL): URL | null {
  try {
    return new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
      typeof window === "undefined" ? "http://localhost" : window.location.origin);
  } catch { return null; }
}

function supabaseDestination(url: URL): boolean {
  if (url.hostname.endsWith(".supabase.co") || url.hostname.endsWith(".supabase.in")) return true;
  try { return url.origin === new URL(getActiveSupabaseTarget().url).origin; } catch { return false; }
}

async function externalException(url: URL, method: string, input: RequestInfo | URL, init?: RequestInit): Promise<boolean> {
  // Stored file bytes (including existing upload/delete transports) are an
  // approved boundary. Database metadata and Storage inventory are not.
  if (["GET", "HEAD", "POST", "PUT", "DELETE"].includes(method)
      && /^\/storage\/v1\/object\//.test(url.pathname)
      && !/^\/storage\/v1\/object\/(list|info)\//.test(url.pathname)) return true;
  if ((method === "GET" || method === "HEAD") && /^\/storage\/v1\/render\/image\//.test(url.pathname)) return true;
  if (method !== "POST") return false;
  const endpoint = url.pathname;
   if (endpoint !== "/functions/v1/verify-iap-receipt-icp" && endpoint !== "/functions/v1/send-welcome-email-icp" && endpoint !== "/functions/v1/send-feedback-email") return false;
  let body: Record<string, unknown>;
  try {
    const raw = init?.body ?? (input instanceof Request ? await input.clone().text() : undefined);
    if (typeof raw !== "string") return false;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;
    body = parsed as Record<string, unknown>;
  } catch { return false; }
  if (endpoint === "/functions/v1/send-feedback-email") {
    const keys = ["type", "title", "description", "userEmail", "userName"];
    return url.search === "" && Object.keys(body).length === keys.length
      && keys.every(key => Object.prototype.hasOwnProperty.call(body, key))
      && ["bug", "feature_request", "other"].includes(String(body.type))
      && typeof body.title === "string" && body.title.trim().length > 0 && body.title.length <= 256
      && (body.description === null || (typeof body.description === "string" && body.description.length <= 16000))
      && (body.userEmail === null || (typeof body.userEmail === "string" && body.userEmail.length <= 320))
      && typeof body.userName === "string" && body.userName.length <= 256;
  }
  if (endpoint === "/functions/v1/send-welcome-email-icp") {
    // Token-only verified delivery boundary; this does not enable the deferred worker.
    return url.search === "" && Object.keys(body).length === 1 && typeof body.token === "string" && body.token.length > 0;
  }
  if (url.search === "?job=push-kick") return Object.keys(body).length === 0;
  if (url.search !== "") return false;
  const keys = ["principal", "product_id", "transaction_id", "receipt_data"];
  return Object.keys(body).length === keys.length && keys.every(key => typeof body[key] === "string" && (body[key] as string).length > 0);
}

export async function assertStrictIcpRequest(input: RequestInfo | URL, init?: RequestInit): Promise<void> {
  if (!strictIcpActive()) return;
  const url = requestUrl(input);
  if (!url || !supabaseDestination(url)) return;
  const method = (init?.method ?? (input instanceof Request ? input.method : "GET")).toUpperCase();
  if (await externalException(url, method, input, init)) return;
  const parts = url.pathname.split("/");
  const name = /^[a-zA-Z0-9_-]+$/.test(parts[3] ?? "") ? parts[3] : "request";
  const label = url.pathname.startsWith("/rest/v1/") ? `data ${name}`
    : url.pathname.startsWith("/functions/v1/") ? `action ${name}`
    : url.pathname.startsWith("/auth/v1/") ? "email authentication"
    : url.pathname.startsWith("/storage/v1/") ? "file storage mutation" : "unapproved request";
  throw reportBlockedFallback(label);
}

let installed = false;
export function installStrictIcpTransport(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    await assertStrictIcpRequest(input, init);
    return original(input, init);
  };
}