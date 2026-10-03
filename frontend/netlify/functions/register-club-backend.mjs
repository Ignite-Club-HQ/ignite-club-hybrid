// Tells the club website's backend where a club's data lives (Supabase vs an
// ICP canister). Called by the app when an app admin changes a club's backend
// pin in Placement Settings. Served by Netlify Functions in production and by
// the Vite dev-server middleware (vite.live.config.ts) in the preview.
//
// The website's shared secret stays server-side: APP_BACKEND_SYNC_SECRET is
// read from the function/dev-server environment and never reaches the browser.
// Callers must be signed-in app admins — the function verifies the Supabase
// access token and the app_admin role before forwarding anything.

const WEBSITE_REGISTER_URL =
  process.env.IGNITE_WEBSITE_REGISTER_URL ??
  "https://frkzyniekamxudaumeaf.supabase.co/functions/v1/register-club-backend";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function supabaseConfig() {
  const url =
    process.env.IGNITE_LIVE_SUPABASE_URL ??
    process.env.SUPABASE_URL ??
    process.env.VITE_SUPABASE_URL ??
    "";
  const anonKey =
    process.env.IGNITE_LIVE_SUPABASE_ANON_KEY ??
    process.env.SUPABASE_PUBLISHABLE_KEY ??
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    "";
  return { url: url.replace(/\/$/, ""), anonKey };
}

async function requireAppAdmin(req) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return { error: json({ error: "Sign-in required" }, 401) };

  const { url, anonKey } = supabaseConfig();
  if (!url || !anonKey) return { error: json({ error: "Auth is not configured on this deployment" }, 503) };

  let userId;
  try {
    const res = await fetch(`${url}/auth/v1/user`, {
      headers: { apikey: anonKey, authorization: `Bearer ${token}` },
    });
    if (!res.ok) return { error: json({ error: "Sign-in required" }, 401) };
    const user = await res.json();
    userId = user?.id;
  } catch {
    return { error: json({ error: "Could not verify sign-in" }, 502) };
  }
  if (!userId) return { error: json({ error: "Sign-in required" }, 401) };

  try {
    const res = await fetch(`${url}/rest/v1/rpc/has_role`, {
      method: "POST",
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ _user_id: userId, _role: "app_admin" }),
    });
    if (!res.ok) return { error: json({ error: "Could not verify permissions" }, 502) };
    const isAdmin = await res.json();
    if (isAdmin !== true) return { error: json({ error: "App admin required" }, 403) };
  } catch {
    return { error: json({ error: "Could not verify permissions" }, 502) };
  }
  return { userId };
}

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const admin = await requireAppAdmin(req);
  if (admin.error) return admin.error;

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const clubId = typeof body.club_id === "string" ? body.club_id.trim() : "";
  if (!/^[0-9a-fA-F-]{36}$/.test(clubId)) {
    return json({ error: "club_id must be the club's UUID" }, 400);
  }
  const backend = body.backend;
  if (backend !== "canister" && backend !== "supabase") {
    return json({ error: 'backend must be "canister" or "supabase"' }, 400);
  }
  const canisterId = typeof body.canister_id === "string" ? body.canister_id.trim() : "";
  if (backend === "canister" && !/^[a-z0-9-]{5,64}$/.test(canisterId)) {
    return json({ error: "canister_id is required when backend is canister" }, 400);
  }
  const dataScope = typeof body.data_scope === "string" && body.data_scope.trim() ? body.data_scope.trim() : "all";

  const secret = process.env.APP_BACKEND_SYNC_SECRET;
  if (!secret) {
    return json({ error: "Website sync is not configured on this deployment" }, 503);
  }

  const payload = { club_id: clubId, backend, data_scope: dataScope };
  if (backend === "canister") payload.canister_id = canisterId;

  let res;
  try {
    res = await fetch(WEBSITE_REGISTER_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-sync-secret": secret,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    return json({ error: "Could not reach the website backend" }, 502);
  }
  if (!res.ok) {
    return json({ error: `Website backend rejected the sync (${res.status})` }, 502);
  }
  return json({ ok: true });
};
