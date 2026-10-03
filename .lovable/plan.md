# Realtime chat on ICP via a WebSocket gateway

## Goal

Match Supabase-mode responsiveness for Internet Identity members: new messages and reactions appear in open chats within ~1 second of being sent, instead of up to ~10 seconds on today's adaptive polling.

## How it works

The Internet Computer has no native WebSocket support, so the standard pattern is the open-source IC WebSocket Gateway (omnia-network), run as a small hosted service:

```text
Browser (II identity)  <--WSS (TLS)-->  WS Gateway  <--canister calls-->  messaging_domain
```

1. The app opens a secure WebSocket to the gateway, signed with the member's Internet Identity delegation. No Supabase involved.
2. The gateway registers the session with the messaging canister and keeps the socket open.
3. When someone sends a message or toggles a reaction, the canister hands a tiny "poke" to the gateway (chat id + version number only — never message content).
4. The gateway pushes the poke to every connected member of that chat in well under a second.
5. The app reacts to a poke exactly the way it reacts to today's poll tick: it refetches that chat's messages/reactions through the normal certified query path. So the UI code barely changes.

Poke-only pushes mean the gateway never handles message bodies, cycle costs stay minimal, and all content still flows through the existing authenticated reads.

## What changes

### Canister (messaging_domain)

- Add the `ic-websocket-cdk-motoko` mops package and expose the four standard gateway methods (`ws_open`, `ws_message`, `ws_close`, `ws_get_messages`) delegating to the SDK.
- On all four message-send paths (send / broadcast / forward / replay) and on reaction toggles, after state is committed, send a poke `{ chat_id, version }` to the currently-connected members of that chat.
- New stable state for the WebSocket registry arrives via a new timestamped migration (per the migration chain rules).
- Fail-safe by design: if no gateway is connected, sends and reactions work exactly as today.

### Frontend

- Add the `ic-websocket-js` client package.
- One shared connection module (`frontend/src/live/wsRealtime.ts`): opens the socket after II sign-in using the existing live agent's identity, reconnects with backoff, and silently falls back to the current adaptive polling if the gateway is unreachable.
- Chat hooks (TeamChatPage, group/DM/club chats, inbox badge, message reads) subscribe to pokes and invalidate the same React Query cache keys the pollers already use. Poll intervals drop to a slow safety-net cadence while the socket is healthy.
- Reactions ride the same channel, so they feel instant for everyone in the chat.
- Supabase-signed-in members are untouched — they keep the existing Supabase realtime.

### Infrastructure you host (one new piece)

- Run the WS Gateway (official Docker image `omniadevs/ic-websocket-gateway`, or the Rust binary): 1 small instance to start, 2+ behind a load balancer for redundancy.
- A domain with TLS, e.g. `wss://ws.yourapp.com`.
- The gateway's URL gets added to Placement Settings alongside the canister IDs, so it stays runtime-configurable like everything else.

## Later, same channel (not in this round)

- Typing indicators and online presence for II members (currently hidden).
- Live inbox/notification badge pushes.

## Gates

- `moc` compile clean, candid drift 17/17 green, bindings regenerated in both lab dirs.
- Product typecheck 0 diagnostics, guard lint green, build OK.
- Full end-to-end proof still requires deployed canisters + a running gateway; the frontend fallback keeps everything working before that.
