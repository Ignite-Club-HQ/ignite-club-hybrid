# ICP chat notification fan-out — canister-side recipient expansion

Status: spec, not yet implemented (2026-10-02). Recorded as a NEEDS-CANISTER
follow-up after the chat-notify wiring pass.

## Problem

`notification_queue.record_chat_notify_batch(message_id, conversation_id,
sender, preview, recipients, mute_list)` requires the caller to supply the
exact recipient list and mute list for a chat message. Under ICP the browser
has no legitimate way to know either:

- Group/team conversation membership lives on `messaging_domain`
  (`conversations[].participants`, group membership, club memberships). A
  member can list participants of their own conversation, so recipients alone
  are theoretically fetchable client-side.
- Mute preferences are per-user private state on `messaging_domain`
  (`mutePreferences`); no principal can read another member's mutes.
- Blocking (DM pairs) is likewise private state on `messaging_domain`.

So a client-driven fan-out would require fabricating mute data, which the
frontend deliberately refuses to do. Under Supabase this expansion happens in
a database trigger the client never sees; the ICP equivalent must also be
canister-side.

## Chosen design: push hook on messaging_domain

On a successful `send_message` (and the group/team/broadcast send variants),
`messaging_domain` expands the recipient set itself and forwards it to
`notification_queue`.

1. After the message is persisted, compute:
   - `recipients` = conversation participants (or group/team membership for
     scoped conversations) minus the sender;
   - `muted` = recipients with a `mutePreferences` entry
     `(user, conversation_id, muted = true)`;
   - exclude blocked pairs (reuse the existing `isBlockedPair` check) and, for
     competition chats with admin-only posting, the existing role rules.
2. Call `notification_queue.record_chat_notify_batch(message_id,
   conversation_id, sender_text, preview, recipients, muted)`.
   - `preview` = body truncated canister-side (e.g. first 140 chars);
     attachment-only messages get a static label ("Photo", "File").
   - The call is best-effort: a failure is logged (or dropped) and never
     fails or rolls back the message send. Idempotency is already guaranteed
     by `chatMessageProcessed(message_id)` on notification_queue, so a retry
     or duplicate hook call is safe.
3. `notification_queue` keeps its existing per-recipient preference filter
   (`recipientAllowed(recipient, "message_chat")`) and inbox enqueue logic —
   unchanged.

### Alternatives considered

- **notification_queue pulls membership/mutes from messaging_domain**
  (record_chat_notify_batch takes only message_id/conversation_id/sender/
  preview and makes an inter-canister query): splits one logical operation
  across two canisters, needs a new member-list query on messaging_domain
  callable by a canister, and doubles the inter-canister latency on the
  notify path. Rejected.
- **Client fetches participants and passes recipients, canister applies
  mutes**: still requires messaging_domain to answer "who is muted in this
  conversation" for someone else's data, and lets any client forge the
  recipient set. Rejected.

## Required canister changes

### messaging_domain

- New state: `notificationQueueCanister : ?Principal` (governor-set).
- New governor method: `set_notification_queue_canister(id : Principal)`.
- In `send_message` (and sibling send paths): build the recipient/mute sets
  and fire the inter-canister call. Use a fire-and-forget pattern so the send
  response does not wait on notification_queue; trap/timeout on the notify
  leg must not affect the returned message.
- Recipients are principals internally; convert to text for the existing
  candid signature (or change the signature to `vec principal` — see open
  questions).

### notification_queue

- New state: `messagingDomainCanister : ?Principal` (governor-set).
- New governor method: `set_messaging_domain_canister(id : Principal)`.
- `record_chat_notify_batch` caller rules (hardening, applies regardless of
  this feature): today any authenticated principal can call it with a forged
  `sender` and arbitrary recipients. Change to:
  - caller == configured messaging_domain canister → trusted, accept as-is;
  - otherwise caller's principal text must equal `sender` (a user may only
    fan out their own messages), and the mute list is ignored for
    non-canister callers (canister applies mutes itself) or the method
    rejects non-canister callers entirely once the hook is live.
- Fail-closed: if `messagingDomainCanister` is unset, non-canister callers
  follow the `sender == caller` rule; nothing breaks.

### Deploy rules (add to backend/AGENTS.md when implemented)

- Immediately after `initialize()` on both canisters, the deploy script MUST
  call `messaging_domain.set_notification_queue_canister(<notification_queue
  id>)` and `notification_queue.set_messaging_domain_canister
  (<messaging_domain id>)` — the hook is fail-closed while unset (messages
  send fine, no chat notifications enqueued).
- No new key material or env vars beyond the two canister IDs.

## Frontend changes

Minimal. `recordLiveChatNotifyBatch` in `frontend/src/live/features/
notifications.ts` stays as the manual/recovery path (e.g. forwarding), but
ordinary sends drop any client-side notify call once the hook is live — the
hook covers them. No UI changes.

## Open questions

- Should the candid signature take `vec principal` instead of `vec text` for
  recipients/mutes? Text matches the existing Notification record (`user :
  text`); keeping text avoids a contract change.
- Scheduled messages (`schedule_message` on notification_queue) already carry
  chat scope fields — confirm the scheduled-send path fans out through the
  same expansion rather than its own list.
- Large groups: `record_chat_notify_batch` caps at 500 recipients; decide
  batching or a higher cap for club-wide broadcast conversations.
