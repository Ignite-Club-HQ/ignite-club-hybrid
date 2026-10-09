// Session-free Apple IAP receipt verification for Internet Identity (ICP)
// users. verify_jwt is disabled for this function in supabase/config.toml —
// Internet Identity users have no Supabase session/JWT to verify.
//
// Request:  { principal, product_id, transaction_id, receipt_data }
//   - principal: the caller's Internet Identity principal (text)
//   - receipt_data: base64 App Store receipt, or a signed JWS transaction
//     (StoreKit 2), depending on client platform
// Response: { expires_at_ms, source, signature_hex }
//   - signature_hex = HMAC-SHA256 over
//     `${principal}|${product_id}|${transaction_id}|${expires_at_ms}|${source}`
//     keyed by IAP_ATTESTATION_HMAC_SECRET.
//
// The client submits this response to the identity_access canister's
// `redeem_entitlement(product_id, transaction_id, expires_at_ms, source,
// signature_hex)`. The canister verifies the same HMAC independently, so
// IAP_ATTESTATION_HMAC_SECRET here MUST be the exact byte-for-byte secret
// set on the canister via the governor-only `set_attestation_secret` call
// (as raw bytes - e.g. `new TextEncoder().encode(secret)` on both sides).
//
// Required secrets (set via `supabase secrets set ...`, never hardcoded):
//   - IAP_ATTESTATION_HMAC_SECRET   shared with identity_access canister
//   - APPLE_SHARED_SECRET           App Store Connect shared secret, for
//                                   legacy verifyReceipt auto-renewable subs
//   - APPLE_ISSUER_ID, APPLE_KEY_ID, APPLE_PRIVATE_KEY (optional)
//                                   App Store Server API credentials, used
//                                   instead of verifyReceipt when present
import { corsHeaders } from "../_shared/cors.ts";

const APPLE_VERIFY_RECEIPT_PROD = "https://buy.itunes.apple.com/verifyReceipt";
const APPLE_VERIFY_RECEIPT_SANDBOX = "https://sandbox.itunes.apple.com/verifyReceipt";

// Apple status 21007: receipt is from the sandbox but was sent to prod.
const APPLE_SANDBOX_REDIRECT_STATUS = 21007;

interface VerifyRequestBody {
  principal?: string;
  product_id?: string;
  transaction_id?: string;
  receipt_data?: string;
}

interface AppleLatestReceiptInfo {
  product_id: string;
  transaction_id: string;
  expires_date_ms?: string;
  purchase_date_ms?: string;
}

interface AppleVerifyReceiptResponse {
  status: number;
  latest_receipt_info?: AppleLatestReceiptInfo[];
  receipt?: { in_app?: AppleLatestReceiptInfo[] };
}

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

async function callAppleVerifyReceipt(
  receiptData: string,
  sharedSecret: string | undefined,
  url: string,
): Promise<AppleVerifyReceiptResponse> {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      "receipt-data": receiptData,
      password: sharedSecret,
      "exclude-old-transactions": true,
    }),
  });
  if (!response.ok) {
    throw new Error(`Apple verifyReceipt HTTP ${response.status}`);
  }
  return (await response.json()) as AppleVerifyReceiptResponse;
}

/**
 * Verifies a base64 App Store receipt against Apple's legacy verifyReceipt
 * endpoint (production first, falling back to sandbox on status 21007), and
 * locates the matching transaction's expiry.
 */
async function verifyAppleReceipt(
  receiptData: string,
  transactionId: string,
  sharedSecret: string | undefined,
): Promise<{ expiresAtMs: number }> {
  let result = await callAppleVerifyReceipt(receiptData, sharedSecret, APPLE_VERIFY_RECEIPT_PROD);
  if (result.status === APPLE_SANDBOX_REDIRECT_STATUS) {
    result = await callAppleVerifyReceipt(receiptData, sharedSecret, APPLE_VERIFY_RECEIPT_SANDBOX);
  }
  if (result.status !== 0) {
    throw new Error(`Apple receipt verification failed (status ${result.status})`);
  }
  const candidates = [...(result.latest_receipt_info ?? []), ...(result.receipt?.in_app ?? [])];
  const match = candidates.find((entry) => entry.transaction_id === transactionId);
  if (!match) {
    throw new Error("Transaction id not found in verified Apple receipt.");
  }
  const expiresAtMs = match.expires_date_ms
    ? Number(match.expires_date_ms)
    : match.purchase_date_ms
      ? Number(match.purchase_date_ms)
      : NaN;
  if (!Number.isFinite(expiresAtMs)) {
    throw new Error("Verified Apple receipt did not include an expiry/purchase date.");
  }
  return { expiresAtMs };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  // Second, unrelated job hosted here: instant ICP chat push (?job=push-kick).
  if (new URL(req.url).searchParams.get("job") === "push-kick") {
    return handlePushKick();
  }


  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as VerifyRequestBody;
    const { principal, product_id, transaction_id, receipt_data } = body;

    if (!principal || !product_id || !transaction_id || !receipt_data) {
      return new Response(
        JSON.stringify({ error: "principal, product_id, transaction_id and receipt_data are required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const attestationSecret = Deno.env.get("IAP_ATTESTATION_HMAC_SECRET");
    if (!attestationSecret) {
      console.error("[verify-iap-receipt-icp] IAP_ATTESTATION_HMAC_SECRET is not configured");
      return new Response(JSON.stringify({ error: "Server not configured for IAP attestation" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const appleSharedSecret = Deno.env.get("APPLE_SHARED_SECRET");
    const { expiresAtMs } = await verifyAppleReceipt(receipt_data, transaction_id, appleSharedSecret);
    const source = "app_store";

    const message = `${principal}|${product_id}|${transaction_id}|${expiresAtMs}|${source}`;
    const signatureHex = await hmacSha256Hex(attestationSecret, message);

    return new Response(
      JSON.stringify({ expires_at_ms: expiresAtMs, source, signature_hex: signatureHex }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (error) {
    console.error("[verify-iap-receipt-icp] error:", error);
    const message = error instanceof Error ? error.message : "Receipt verification failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});

// ============================================================================
// Instant ICP push delivery (?job=push-kick)
// The app pings this right after a blockchain-mode chat message is stored so
// pushes go out in seconds; the 5-minute GitHub worker stays as the
// retry/recovery backstop. Callers supply no data — it only drains the
// notification_queue outbox — so it is safe without a session. Never calls
// recover() (only the serialized GitHub worker may). Delivery logic mirrors
// scripts/icp-push-deliver.mjs — keep them in sync.
// Secrets: ICP_PUSH_WORKER_SEED, FCM_SERVICE_ACCOUNT_JSON (same as GitHub repo secrets).
// ============================================================================

// deno-lint-ignore-file no-explicit-any
const PUSH_CANISTER_ID = () => Deno.env.get("NOTIFICATION_QUEUE_CANISTER_ID") || "jfcdq-yiaa-aaaal-qxloa-cai";
const PUSH_HOST = () => Deno.env.get("ICP_HOST") || "https://icp-api.io";
const PUSH_BATCH = 50;
const PUSH_CONCURRENCY = 8;
const PUSH_RETRY_MS = 2 * 60 * 1000;
let pushRunning = false;
let pushOauth = { token: "", exp: 0 };

function pushJson(b: unknown, s = 200) {
  return new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

async function handlePushKick(): Promise<Response> {
  // A warm instance already draining will pick this message up too.
  if (pushRunning) return pushJson({ joined: true });
  pushRunning = true;
  try {
    return pushJson(await pushDrain());
  } catch (e: any) {
    console.error("push-kick", e);
    return pushJson({ error: e?.message ?? String(e) }, 500);
  } finally {
    pushRunning = false;
  }
}

async function pushQueue(seedHex: string): Promise<any> {
  const { HttpAgent, Actor } = await import("npm:@icp-sdk/core@5.4.0/agent");
  const { Ed25519KeyIdentity } = await import("npm:@icp-sdk/core@5.4.0/identity");
  const { IDL } = await import("npm:@icp-sdk/core@5.4.0/candid");
  const Result = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
  const ResultNat16 = IDL.Variant({ Ok: IDL.Nat16, Err: IDL.Text });
  const Status = IDL.Variant({ Pending: IDL.Null, Processing: IDL.Null, Delivered: IDL.Null, Failed: IDL.Null });
  const Notification = IDL.Record({
    id: IDL.Text, user: IDL.Text, kind: IDL.Text, body: IDL.Text,
    related_id: IDL.Opt(IDL.Text), actor: IDL.Opt(IDL.Text), read: IDL.Bool, status: Status,
    attempts: IDL.Nat16, next_attempt_ms: IDL.Nat64, created_at_ms: IDL.Nat64, updated_at_ms: IDL.Nat64,
    idempotency_key: IDL.Opt(IDL.Text),
  });
  const DeviceToken = IDL.Record({
    user: IDL.Text, platform: IDL.Text, token: IDL.Text,
    p256dh: IDL.Opt(IDL.Text), auth: IDL.Opt(IDL.Text), updated_at_ms: IDL.Nat64,
  });
  const idlFactory = () =>
    IDL.Service({
      claim: IDL.Func([IDL.Nat64, IDL.Nat16], [IDL.Variant({ Ok: IDL.Vec(Notification), Err: IDL.Text })], []),
      acknowledge: IDL.Func([IDL.Text, IDL.Text], [Result], []),
      fail: IDL.Func([IDL.Text, IDL.Text, IDL.Opt(IDL.Nat64)], [Result], []),
      list_device_tokens: IDL.Func([IDL.Vec(IDL.Text)], [IDL.Vec(DeviceToken)], ["query"]),
      remove_device_tokens: IDL.Func([IDL.Text, IDL.Vec(IDL.Text)], [ResultNat16], []),
    });
  const seed = new Uint8Array(seedHex.match(/../g)!.map((h) => parseInt(h, 16)));
  const identity = Ed25519KeyIdentity.fromSecretKey(seed);
  const agent = HttpAgent.createSync({ identity, host: PUSH_HOST() });
  return Actor.createActor(idlFactory as any, { agent, canisterId: PUSH_CANISTER_ID() });
}

async function pushDrain() {
  const seedHex = Deno.env.get("ICP_PUSH_WORKER_SEED") ?? "";
  const saJson = Deno.env.get("FCM_SERVICE_ACCOUNT_JSON") ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex) || !saJson) return { skipped: "not configured" };
  const sa = JSON.parse(saJson);
  const queue = await pushQueue(seedHex);
  // The chat fan-out is an inter-canister call that can land a moment after
  // send_message returns — poll briefly (bounded) until something shows up.
  let total = 0;
  for (let attempt = 0; attempt < 6; attempt++) {
    const claimed = await queue.claim(BigInt(Date.now()), PUSH_BATCH);
    if (claimed.Err) throw new Error(`claim failed: ${claimed.Err}`);
    const items: any[] = claimed.Ok ?? [];
    if (items.length === 0) {
      if (total > 0) break;
      await new Promise((r) => setTimeout(r, 1000));
      continue;
    }
    total += items.length;
    await pushDeliver(queue, sa, items);
    if (items.length < PUSH_BATCH) break;
  }
  return { processed: total };
}

function pushTitle(n: any) {
  const related = n.related_id?.length ? n.related_id[0] : undefined;
  const actor = n.actor?.length ? n.actor[0] : undefined;
  switch (n.kind) {
    case "event_reminder": return "Event reminder";
    case "event_cancelled": return "Event cancelled";
    case "duty_assigned": return "New duty assigned";
    case "chat": case "team_message": case "club_message": case "group_message":
      return actor ? `New message from ${actor}` : "New message";
    case "direct_message": return actor ? `Message from ${actor}` : "New direct message";
    case "club_news": return "Club news";
    case "broadcast": return "Club announcement";
    case "photo_added": return "New photo";
    case "photo_comment": case "comment_reply": return "New comment";
    case "photo_reaction": return "New reaction";
    case "event_invite": case "team_invite": case "club_invite": return "You're invited";
    case "rsvp": case "rsvp_response": return "RSVP update";
    case "role_request": return "Role request";
    case "role_approved": return "Role approved";
    case "role_removed": return "Role removed";
    case "member_joined": return "New member";
    case "membership_removed": return "Membership update";
    case "fee_reminder": return "Fee reminder";
    case "scheduled_message": return "Scheduled message";
    default: return related ? "Ignite update" : "Ignite notification";
  }
}

function pushUrl(n: any) {
  const related = n.related_id?.length ? n.related_id[0] : undefined;
  const k: string = n.kind;
  if (k.startsWith("event") || k === "duty_assigned" || k === "rsvp" || k === "rsvp_response") return related ? `/events/${related}` : "/events";
  if (k.startsWith("photo") || k === "comment_reply") return "/media";
  if (k === "club_news") return related ? `/news/${related}` : "/news";
  if (k === "team_message" || k === "team_invite" || k.startsWith("team_role")) return related ? `/teams/${related}` : "/teams";
  if (k === "club_message" || k === "club_invite" || k.startsWith("club_role")) return related ? `/clubs/${related}` : "/clubs";
  if (k === "group_message" || k === "chat") return "/messages";
  if (k === "direct_message") return "/messages/direct";
  if (k === "broadcast") return "/messages/broadcast";
  if (k === "member_joined" || k === "membership_removed" || k === "role_removed") return "/clubs";
  if (k === "fee_reminder") return "/payments";
  return "/notifications";
}

function pushB64u(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function pushFcmToken(sa: any) {
  const now = Math.floor(Date.now() / 1000);
  if (pushOauth.token && pushOauth.exp > now + 120) return pushOauth.token;
  const enc = (o: unknown) => pushB64u(new TextEncoder().encode(JSON.stringify(o)));
  const header = enc({ alg: "RS256", typ: "JWT" });
  const claim = enc({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  });
  const bin = atob(String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""));
  const der = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${header}.${claim}.${pushB64u(new Uint8Array(sig))}`,
  });
  if (!res.ok) throw new Error(`oauth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  pushOauth = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return pushOauth.token;
}

async function pushPool<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>) {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; out[i] = await fn(items[i]); }
  }));
  return out;
}

async function pushDeliver(queue: any, sa: any, items: any[]) {
  const users = [...new Set(items.map((n) => n.user))];
  const tokenRows: any[] = await queue.list_device_tokens(users);
  const byUser = new Map<string, any[]>();
  for (const t of tokenRows) {
    if (t.platform !== "android" && t.platform !== "ios") continue;
    if (!byUser.has(t.user)) byUser.set(t.user, []);
    byUser.get(t.user)!.push(t);
  }
  const oauth = await pushFcmToken(sa);
  const dead = new Map<string, string[]>();
  const outcomes = await pushPool(items, PUSH_CONCURRENCY, async (n) => {
    const tokens = byUser.get(n.user) ?? [];
    if (tokens.length === 0) return { n, ok: true };
    let delivered = 0;
    let lastErr = "unknown";
    for (const t of tokens) {
      try {
        const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
          method: "POST",
          headers: { Authorization: `Bearer ${oauth}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            message: {
              token: t.token,
              notification: { title: pushTitle(n), body: n.body },
              data: { kind: n.kind, url: pushUrl(n), notification_id: n.id },
              android: { priority: "HIGH" },
              apns: { headers: { "apns-priority": "10" } },
            },
          }),
        });
        if (res.ok) { delivered++; continue; }
        const text = await res.text();
        if (res.status === 404 || text.includes("UNREGISTERED") || text.includes("INVALID_ARGUMENT")) {
          if (!dead.has(t.user)) dead.set(t.user, []);
          dead.get(t.user)!.push(t.token);
        } else lastErr = `fcm ${res.status}: ${text.slice(0, 200)}`;
      } catch (e: any) {
        lastErr = e?.message ?? String(e);
      }
    }
    return delivered > 0 ? { n, ok: true } : { n, ok: false, error: lastErr };
  });
  await pushPool(outcomes, PUSH_CONCURRENCY, async (o: any) => {
    const key = o.n.idempotency_key?.length ? o.n.idempotency_key[0] : "";
    try {
      if (o.ok) await queue.acknowledge(o.n.id, key);
      else await queue.fail(o.n.id, o.error ?? "delivery failed", [BigInt(Date.now() + PUSH_RETRY_MS)]);
    } catch (e: any) {
      console.error(`settle ${o.n.id}: ${e?.message ?? e}`);
    }
  });
  for (const [user, tokens] of dead) {
    try { await queue.remove_device_tokens(user, tokens); } catch (e: any) { console.error(`prune ${user}: ${e?.message ?? e}`); }
  }
}
