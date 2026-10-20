#!/usr/bin/env node
// ICP push delivery worker — bridges the notification_queue outbox to FCM.
//
// Claims a batch of pending notifications from the notification_queue canister,
// resolves recipient device tokens (stored on the same canister, keyed by
// Internet Identity principal text), delivers via FCM HTTP v1, then
// acknowledges (or fails with a retry delay) each item on the canister.
//
// Runs on a schedule via .github/workflows/icp-push-deliver.yml. Runs are
// serialized by the workflow's concurrency group, so recover() at startup is
// safe and self-heals items stranded in Processing by an interrupted run.
//
// Env (all provided by the workflow, from repo secrets):
//   ICP_PUSH_WORKER_SEED       — 64 hex chars (32-byte Ed25519 seed). The
//                                derived principal must be granted via
//                                notification_queue.grant_worker (the
//                                deploy-mainnet workflow does this when the
//                                secret is present).
//   FCM_SERVICE_ACCOUNT_JSON   — Firebase service account JSON.
//   NOTIFICATION_QUEUE_CANISTER_ID — optional, defaults to mainnet id.
//   ICP_HOST                   — optional, defaults to https://icp-api.io.
//   PUSH_WORKER_NODE_PATH      — optional extra node_modules dir to resolve
//                                @icp-sdk/core from (CI installs it there).

import { createRequire } from "node:module";
import { unwrapQueueResult } from "./icp-push-results.mjs";
import { createPushQueueIdl, notificationKey } from './icp-push-contract.mjs';
import { pushQueueIds, runPushQueues, deliverPushItem } from './icp-push-batch.mjs';

function requireIc() {
  const candidates = [];
  if (process.env.PUSH_WORKER_NODE_PATH) {
    candidates.push(createRequire(`${process.env.PUSH_WORKER_NODE_PATH}/resolve.js`));
  }
  candidates.push(createRequire(new URL("../frontend/package.json", import.meta.url)));
  candidates.push(createRequire(import.meta.url));
  for (const req of candidates) {
    try {
      return {
        agent: req("@icp-sdk/core/agent"),
        identity: req("@icp-sdk/core/identity"),
        candid: req("@icp-sdk/core/candid"),
        principal: req("@icp-sdk/core/principal"),
      };
    } catch {}
  }
  throw new Error("@icp-sdk/core not resolvable — set PUSH_WORKER_NODE_PATH to a node_modules dir containing it");
}

const { agent: agentPkg, identity: identityPkg, candid: candidPkg, principal: principalPkg } = requireIc();
const { HttpAgent, Actor } = agentPkg;
const { Ed25519KeyIdentity } = identityPkg;
const { IDL } = candidPkg;

const CANISTER_ID = process.env.NOTIFICATION_QUEUE_CANISTER_ID || "jfcdq-yiaa-aaaal-qxloa-cai";
const HOST = process.env.ICP_HOST || "https://icp-api.io";
const BATCH_SIZE = 50;
const SEND_CONCURRENCY = 8;
const ACK_CONCURRENCY = 8;
const RETRY_DELAY_MS = 2 * 60 * 1000;

const idlFactory = createPushQueueIdl;

function nowMs() {
  return BigInt(Date.now());
}

// ---- Notification presentation (mirrors frontend/src/pages/NotificationsPage.tsx) ----

function titleFor(n) {
  const related = n.related_id?.length ? n.related_id[0] : undefined;
  switch (n.kind) {
    case "event_reminder": return "Event reminder";
    case "event_cancelled": return "Event cancelled";
    case "duty_assigned": return "New duty assigned";
    case "chat": case "team_message": case "club_message": case "group_message":
      return n.actor?.length ? `New message from ${n.actor[0]}` : "New message";
    case "direct_message": return n.actor?.length ? `Message from ${n.actor[0]}` : "New direct message";
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

function urlFor(n) {
  const related = n.related_id?.length ? n.related_id[0] : undefined;
  const k = n.kind;
  if (k.startsWith("event") || k === "duty_assigned" || k === "rsvp" || k === "rsvp_response") {
    return related ? `/events/${related}` : "/events";
  }
  // related_id is the game event for upload reminders, otherwise the photo.
  // MediaPage opens `?photo=` in the viewer and `&comments=1` opens comments.
  if (k === "photo_prompt_reminder") return related ? `/media?event=${encodeURIComponent(related)}&upload=1` : "/media?upload=1";
  if (k === "media_chat_photo_reminder") return related ? `/media?team=${encodeURIComponent(related)}&upload=1` : "/media?upload=1";
  if (k.startsWith("photo") || k === "comment_reply") {
    if (!related) return "/media";
    const comments = k === "photo_comment" || k === "comment_reply";
    return `/media?photo=${encodeURIComponent(related)}${comments ? "&comments=1" : ""}`;
  }
  if (k === "club_news") return related ? `/news/${related}` : "/news";
  if (k === "team_message" || k === "team_invite" || k.startsWith("team_role")) return related ? `/teams/${related}` : "/teams";
  if (k === "club_message" || k === "club_invite" || k.startsWith("club_role")) return related ? `/clubs/${related}` : "/clubs";
  if (k === "group_message" || k === "chat") return "/messages";
  // Chat fan-out rows (record_chat_notify_batch): related_id/club carry the
  // conversation id, idempotency_key the message id. The conversation id
  // alone can't tell team/club/DM/group apart, so route through the Messages
  // inbox with `?conversation=` — MessagesPage resolves the canonical chat
  // route (and scrolls to `?message=`) via the on-chain conversation
  // metadata, mirroring icpNotificationRoute.ts.
  if (k === "message_chat") {
    const conversationId = related || n.club;
    if (!conversationId) return "/messages";
    const messageId = notificationKey(n) || undefined;
    const params = new URLSearchParams({ conversation: conversationId });
    if (messageId) params.set("message", messageId);
    return `/messages?${params.toString()}`;
  }
  if (k === "direct_message") return "/messages/direct";
  if (k === "broadcast") return "/messages/broadcast";
  if (k === "member_joined" || k === "membership_removed" || k === "role_removed") return "/clubs";
  if (k === "fee_reminder") return "/payments";
  return "/notifications";
}

// ---- FCM HTTP v1 ----

function b64u(bytes) {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function pemToDer(pem) {
  const b64 = pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

let cachedOauth = { token: "", exp: 0 };

async function getFcmAccessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  if (cachedOauth.token && cachedOauth.exp > now + 120) return cachedOauth.token;
  const header = b64u(new TextEncoder().encode(JSON.stringify({ alg: "RS256", typ: "JWT" })));
  const claim = b64u(
    new TextEncoder().encode(
      JSON.stringify({
        iss: sa.client_email,
        scope: "https://www.googleapis.com/auth/firebase.messaging",
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
      }),
    ),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8",
    pemToDer(sa.private_key),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(`${header}.${claim}`));
  const jwt = `${header}.${claim}.${b64u(new Uint8Array(sig))}`;
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  if (!res.ok) throw new Error(`oauth ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const data = await res.json();
  cachedOauth = { token: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return cachedOauth.token;
}

// returns null on success; { prune: true } when the token is dead; { retryable: true, error } otherwise
async function sendFcm(projectId, oauth, token, n) {
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`, {
    method: "POST",
    headers: { Authorization: `Bearer ${oauth}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: {
        token,
        notification: { title: titleFor(n), body: n.body },
        data: {
          kind: n.kind,
          url: urlFor(n),
          notification_id: n.id,
          // Chat taps: lets the app's pendingChatJump fallback scroll to the
          // exact message even if the URL search params get stripped.
          ...(n.kind === "message_chat"
            ? {
                conversation_id: n.related_id?.[0] ?? n.club ?? "",
                message_id: notificationKey(n),
              }
            : {}),
        },
        android: { priority: "HIGH" },
        apns: { headers: { "apns-priority": "10" } },
      },
    }),
  });
  if (res.ok) return null;
  const text = await res.text();
  if (res.status === 404 || text.includes("UNREGISTERED") || text.includes("INVALID_ARGUMENT")) {
    return { prune: true };
  }
  return { retryable: true, error: `fcm ${res.status}: ${text.slice(0, 200)}` };
}

async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        results[i] = await fn(items[i]);
      }
    }),
  );
  return results;
}

// ---- Main ----

async function main() {
  const seedHex = process.env.ICP_PUSH_WORKER_SEED ?? "";
  const saJson = process.env.FCM_SERVICE_ACCOUNT_JSON ?? "";
  if (!/^[0-9a-fA-F]{64}$/.test(seedHex) || !saJson) {
    console.log("::notice::ICP push delivery not configured (ICP_PUSH_WORKER_SEED and/or FCM_SERVICE_ACCOUNT_JSON missing) — skipping.");
    return;
  }
  const seed = new Uint8Array(seedHex.match(/../g).map((h) => parseInt(h, 16)));
  const identity = Ed25519KeyIdentity.fromSecretKey(seed);
  const sa = JSON.parse(saJson);
  if (!sa.project_id || !sa.client_email || !sa.private_key) throw new Error("FCM service account JSON missing project_id/client_email/private_key");

  const agent = new HttpAgent({ identity, host: HOST });
  // Devices remain caller-owned in the shared queue: no per-group token copies.
  const directory = Actor.createActor(idlFactory, { agent, canisterId: CANISTER_ID });
  const queues = pushQueueIds(process.env.ICP_PUSH_QUEUE_IDS_JSON, CANISTER_ID, id => principalPkg.Principal.fromText(id));
  await runPushQueues(queues, async canisterId => {
  const queue = Actor.createActor(idlFactory, { agent, canisterId });

  const recovered = unwrapQueueResult(await queue.recover(), "recover");
  if (recovered > 0) console.log(`Recovered ${recovered} stranded notifications`);

  const claimed = await queue.claim(nowMs(), BATCH_SIZE);
  if (claimed.Err) throw new Error(`claim failed: ${claimed.Err}`);
  const items = claimed.Ok ?? [];
  if (items.length === 0) {
    console.log("No pending notifications");
    return;
  }
  console.log(`Claimed ${items.length} notifications`);

  const users = [...new Set(items.map((n) => n.user))];
  const tokenRows = unwrapQueueResult(await directory.list_device_tokens(users), "device tokens");
  const tokensByUser = new Map();
  for (const t of tokenRows) {
    if (t.platform !== "android" && t.platform !== "ios") continue; // web tokens need a VAPID path — skipped for now
    if (!tokensByUser.has(t.user)) tokensByUser.set(t.user, []);
    tokensByUser.get(t.user).push(t);
  }

  const oauth = await getFcmAccessToken(sa);
  const deadTokens = new Map(); // user -> [token]

  const outcomes = await pool(items, SEND_CONCURRENCY, async (n) => {
    const tokens = tokensByUser.get(n.user) ?? [];
    try {
      const result = await deliverPushItem(queue, n, tokens, t => sendFcm(sa.project_id, oauth, t.token, n));
      for (const t of result.dead) {
        if (!deadTokens.has(t.user)) deadTokens.set(t.user, []);
        deadTokens.get(t.user).push(t.token);
      }
      return { n, ...result };
    } catch (error) { return { n, status: 'failed', error: error.message }; }
  });

  let acked = 0;
  let failed = 0;
  let noTokens = 0;
  await pool(outcomes, ACK_CONCURRENCY, async (o) => {
    const key = notificationKey(o.n);
    try {
      if (o.status === "delivered") {
        unwrapQueueResult(await queue.acknowledge(o.n.id, key), "acknowledge");
        acked++;
      } else if (o.status === "no_tokens") {
        // No device registered — treat as delivered so it doesn't retry forever.
        unwrapQueueResult(await queue.acknowledge(o.n.id, key), "acknowledge");
        noTokens++;
      } else {
        // A denied/unavailable scope is never counted as delivered. Retry
        // preserves its original body, and authority is checked again.
        unwrapQueueResult(await queue.fail(o.n.id, o.error ?? "delivery denied", o.status === 'denied' ? [] : [nowMs() + BigInt(RETRY_DELAY_MS)]), "retry");
        failed++;
      }
    } catch (e) {
      console.error(`settle error for ${o.n.id}: ${e?.message ?? e}`);
    }
  });

  for (const [user, tokens] of deadTokens) {
    try {
      const r = await directory.remove_device_tokens(user, tokens);
      if (r.Err) console.error(`prune error for ${user}: ${r.Err}`);
    } catch (e) {
      console.error(`prune error for ${user}: ${e?.message ?? e}`);
    }
  }

  console.log(`Delivered ${acked}, failed ${failed}, no-device ${noTokens}, pruned ${[...deadTokens.values()].reduce((a, t) => a + t.length, 0)} dead tokens`);
  });
}

main().catch((e) => {
  console.error(`::error::ICP push delivery failed: ${e?.message ?? e}`);
  process.exit(1);
});
