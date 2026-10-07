import { Principal } from "@icp-sdk/core/principal";
import { connectLiveClubDomain, connectLiveMessagingDomain } from "../domains";
import type { FeatureBackendContext } from "../featureRouter";
import { candidOpt, unwrapCandid } from "./candid";
import { batched, groupBy } from "./batching";

type MessagingActor = Awaited<ReturnType<typeof connectLiveMessagingDomain>>["actor"];
const msgConn = (ctx: FeatureBackendContext) => () => connectLiveMessagingDomain(ctx.target, ctx.identity);

/**
 * Messaging feature -> messaging_domain canister.
 *
 * Canister-side counterpart of the Supabase chat data layer in
 * `features/messaging/`. Routed to only when placement settings resolve ICP
 * and a messaging_domain canister ID is configured.
 *
 * NOTE: untested against a live canister until deployment. The canister has
 * no realtime broadcast — live message updates need polling or a future
 * push path; the Supabase branch keeps its realtime channels.
 */

export async function createLiveConversation(
  ctx: FeatureBackendContext,
  clubId: string,
  participants: Principal[],
  teamId?: string | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_conversation(clubId, candidOpt(teamId), participants),
    "Create conversation",
  );
}

/**
 * Provisions the club chat and every team chat of a club on the messaging
 * canister (find-or-create with current membership). Any club member may
 * trigger it; the chat pages call this before first read/send so a
 * conversation missing on the messaging canister self-heals.
 */
export async function ensureLiveClubConversations(
  ctx: FeatureBackendContext,
  clubId: string,
) {
  const { actor } = await connectLiveClubDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.ensure_club_conversations(clubId), "Ensure club conversations");
}

export async function listLiveMessages(
  ctx: FeatureBackendContext,
  conversationId: string,
  afterMs?: number | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.list_messages(
    conversationId,
    candidOpt(afterMs === null || afterMs === undefined ? undefined : BigInt(afterMs)),
  );
}

export async function listLiveMessagesPage(
  ctx: FeatureBackendContext,
  conversationId: string,
  afterMs: number | null,
  limit: number,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.list_messages_page(
      conversationId,
      candidOpt(afterMs === null ? undefined : BigInt(afterMs)),
      limit,
    ),
    "List messages",
  );
}

/**
 * Newest-first page read. `before = null` returns the newest `limit` messages;
 * `before = <cursor>` returns the page just older than that cursor. The
 * returned `next_sequence` is the backward cursor for the next-older page —
 * null means nothing older remains. This is what a chat screen wants on open;
 * `listLiveMessagesPage` pages forward from the OLDEST message instead.
 */
export async function listLiveLatestMessagesPage(
  ctx: FeatureBackendContext,
  conversationId: string,
  before: number | null,
  limit: number,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  try {
    return await unwrapCandid(
      actor.list_latest_messages_page(
        conversationId,
        candidOpt(before === null ? undefined : BigInt(before)),
        limit,
      ),
      "List latest messages",
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Canisters deployed before this method existed reject the call outright
    // ("Canister has no query method '<name>'", IC0536; some paths report
    // IC0504). Fall back to the forward read for the first page so chat still
    // loads until the redeploy lands; scroll-back paging keeps its pre-fix
    // behaviour on those canisters.
    const methodMissing =
      /has no (?:query |update |)method|IC0536|IC0504|method .*(?:not found|does not exist)|does not exist/i.test(
        message,
      );
    if (before !== null || !methodMissing) throw err;
    return unwrapCandid(
      actor.list_messages_page(conversationId, candidOpt(undefined), limit),
      "List messages",
    );
  }

}



export interface LiveMessageAttachment {
  /** "poll" | "news" | "image" — matches the group chat composer payloads. */
  kind: string;
  refId: string;
  url?: string | null;
}

async function shortCanisterRefId(refId: string): Promise<string> {
  if (refId.length > 0 && refId.length <= 128) return refId;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(refId));
  return "sha256:" + [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sendLiveMessage(
  ctx: FeatureBackendContext,
  conversationId: string,
  body: string,
  idempotencyKey: string,
  attachment?: LiveMessageAttachment | null,
  replyToId?: string | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  // The canister rejects an empty body and ids over 128 chars. Photo-only
  // messages send a single space; long photo addresses get a short digest id
  // (the full address still travels in `url`, which allows 2048 chars).
  const safeBody = body.trim() === "" && attachment ? " " : body;
  const refId = attachment ? await shortCanisterRefId(attachment.refId) : "";
  return unwrapCandid(
    actor.send_message(
      conversationId,
      safeBody,
      idempotencyKey,
      candidOpt(
        attachment
          ? { kind: attachment.kind, ref_id: refId, url: candidOpt(attachment.url) }
          : null,
      ),
      candidOpt(replyToId ?? null),
    ),
    "Send message",
  );
}

export async function updateLiveMessage(
  ctx: FeatureBackendContext,
  messageId: string,
  body: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.update_message(messageId, body), "Update message");
}

export async function deleteLiveMessage(ctx: FeatureBackendContext, messageId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_message(messageId), "Delete message");
}

export async function markLiveConversationRead(
  ctx: FeatureBackendContext,
  conversationId: string,
  messageId: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.mark_read(conversationId, messageId), "Mark read");
}

export async function getLiveUnreadCount(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unread_count(conversationId), "Unread count");
}

export interface LiveAnnouncementInput {
  clubId: string;
  teamIds: string[];
  includeClubChat: boolean;
  body: string;
  idempotencyKey: string;
}

/**
 * Club announcement fan-out (the canister counterpart of the
 * send-club-announcement edge function): posts the message to the club chat
 * and/or each listed team's conversation in one call. Teams without a
 * canister conversation are skipped and reported in `skipped`, never
 * fatal. The caller must be a club admin on the canister; announcements
 * allow a longer body than the 128-char chat message limit.
 */
export async function broadcastLiveAnnouncement(
  ctx: FeatureBackendContext,
  input: LiveAnnouncementInput,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.broadcast_announcement(
      input.clubId,
      input.teamIds,
      input.includeClubChat,
      input.body,
      input.idempotencyKey,
    ),
    "Broadcast announcement",
  );
}

export interface LiveGroupMetadata {
  conversationId: string;
  kind: string;
  name: string;
  teamId: string | null;
  clubId: string | null;
  members: Principal[];
  createdAtMs: number;
  description: string | null;
  avatar: string | null;
  adminOnlyPosting: boolean;
}

function toLiveGroupMetadata(raw: {
  conversation_id: string;
  kind: string;
  name: string;
  team_id: [] | [string];
  club_id: [] | [string];
  members: Principal[];
  created_at_ms: bigint;
  // Optional so metadata from a canister deployed before the
  // description/avatar/admin_only_posting migration still maps cleanly.
  description?: [] | [string];
  avatar?: [] | [string];
  admin_only_posting?: boolean;
}): LiveGroupMetadata {
  return {
    conversationId: raw.conversation_id,
    kind: raw.kind,
    name: raw.name,
    teamId: raw.team_id[0] ?? null,
    clubId: raw.club_id[0] ?? null,
    members: raw.members,
    createdAtMs: Number(raw.created_at_ms),
    description: raw.description?.[0] ?? null,
    avatar: raw.avatar?.[0] ?? null,
    adminOnlyPosting: raw.admin_only_posting ?? false,
  };
}

/**
 * Group/team/competition-thread metadata (name, kind, members) — the
 * canister counterpart of the Supabase `chat_groups` row read.
 */
/**
 * Provision the platform broadcast feed on the chat canister. Any signed-in
 * member may call it — it grants no membership: reads are open to every
 * authenticated caller canister-side, and posting is restricted to platform
 * admins there. Returns the fixed conversation id the app reads and posts by.
 */
export async function ensureLiveBroadcastConversation(ctx: FeatureBackendContext): Promise<string> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const conversation = await unwrapCandid(
    actor.ensure_broadcast_conversation(),
    "Ensure broadcast conversation",
  );
  return conversation.id;
}

/**
 * Thread id formula shared with the canister: a club's admin thread for one
 * member. Both sides derive it, so opening a thread needs no lookup.
 */
export function liveClubAdminThreadId(clubId: string, member: string): string {
  return `club-admin-${clubId}-${member}`;
}

/**
 * Open (and re-sync) one member's thread with their club's admins. Canister-side
 * the caller must be that member or one of the club's admins; membership is
 * re-read from club_domain on every call, so admin changes take effect on the
 * next open.
 */
export async function ensureLiveClubAdminThread(
  ctx: FeatureBackendContext,
  clubId: string,
  member: string,
): Promise<string> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const conversation = await unwrapCandid(
    actor.ensure_club_admin_thread(clubId, Principal.fromText(member)),
    "Ensure club admin thread",
  );
  return conversation.id;
}

/**
 * The club's admin inbox: every member thread in the club with its owner.
 * Canister-side only that club's admins receive anything; everyone else gets an
 * empty list.
 */
export async function listLiveClubAdminThreads(
  ctx: FeatureBackendContext,
  clubId: string,
): Promise<Array<{ id: string; member: string }>> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  // Returns a plain array (not a Result variant), so no unwrapCandid.
  const raw = await actor.list_club_admin_threads(clubId);
  return raw.map((entry) => ({ id: entry.id, member: entry.member.toText() }));
}

export async function upsertLiveGroupMetadata(

  ctx: FeatureBackendContext,
  conversationId: string,
  kind: string,
  name: string,
  teamId: string | null | undefined,
  clubId: string | null | undefined,
  members: Principal[],
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(
    actor.upsert_group_metadata(
      conversationId,
      kind,
      name,
      candidOpt(teamId),
      candidOpt(clubId),
      members,
    ),
    "Upsert group metadata",
  );
  return toLiveGroupMetadata(raw);
}

export async function getLiveGroupMetadata(ctx: FeatureBackendContext, conversationId: string) {
  type Raw = Awaited<ReturnType<MessagingActor["get_group_metadata"]>> extends infer R
    ? R extends { Ok: infer O } ? O : never : never;
  const raw = await batched<MessagingActor, Raw | null>(
    ctx, "messaging:group_meta", conversationId, msgConn(ctx),
    async (actor, ids) => {
      const rows = await unwrapCandid(actor.get_group_metadata_multi(ids), "Get group metadata");
      const m = new Map<string, Raw | null>(ids.map((i) => [i, null]));
      for (const r of rows) m.set((r as { conversation_id: string }).conversation_id, r as Raw);
      return m;
    },
    (actor, id) => unwrapCandid(actor.get_group_metadata(id), "Get group metadata") as Promise<Raw>,
  );
  if (!raw) throw new Error("Get group metadata failed: Group metadata not found");
  return toLiveGroupMetadata(raw);
}

/**
 * Club membership roster used by `can_dm_user` / messaging ACL checks on the
 * canister. NOTE: there is no frontend membership-write path that produces
 * an Internet-Identity-keyed club membership row yet (team/club membership
 * is still written to Supabase `user_roles` keyed by uuid) — this wrapper is
 * intentionally unused today. It exists so the future Supabase->ICP
 * membership migration can call it directly once club membership writes
 * move to identity_access/club_domain principals.
 */
export async function upsertLiveClubMembership(
  ctx: FeatureBackendContext,
  user: Principal,
  clubId: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.upsert_club_membership(user, clubId), "Upsert club membership");
}

/** Whether the caller is allowed to open/continue a DM with `other`. */
export async function canLiveDmUser(ctx: FeatureBackendContext, other: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.can_dm_user(other);
}

/** App-admin-controlled per-user disable of the DM "+" attachment menu. */
export async function setLiveDmAttachmentsDisabled(
  ctx: FeatureBackendContext,
  user: Principal,
  disabled: boolean,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_dm_attachments_disabled(user, disabled),
    "Set DM attachments disabled",
  );
}

export async function isLiveDmAttachmentsDisabled(ctx: FeatureBackendContext, user: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.dm_attachments_disabled(user);
}

/** Grants competition-admin standing for a conversation (enforced canister-side in send_message). */
export async function grantLiveCompetitionAdmin(
  ctx: FeatureBackendContext,
  conversationId: string,
  user: Principal,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.grant_competition_admin(conversationId, user),
    "Grant competition admin",
  );
}

export async function isLiveCompetitionAdmin(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.is_competition_admin(conversationId);
}

export interface LiveUnreadSummary {
  conversationId: string;
  kind: string;
  count: number;
}

/** Per-conversation unread counts for the caller — the canister counterpart of `get_unread_message_counts`. */
export async function myLiveUnreadCounts(ctx: FeatureBackendContext): Promise<LiveUnreadSummary[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await actor.my_unread_counts();
  return raw.map((r) => ({ conversationId: r.conversation_id, kind: r.kind, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Groups with roles, membership, and lifecycle.
// ---------------------------------------------------------------------------

export async function createLiveGroupWithRoles(
  ctx: FeatureBackendContext,
  clubId: string,
  teamId: string | null | undefined,
  name: string,
  kind: string,
  roleEntries: Array<[Principal, string]>,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_group_with_roles(clubId, candidOpt(teamId), name, kind, roleEntries),
    "Create group",
  );
}

export async function updateLiveGroup(
  ctx: FeatureBackendContext,
  conversationId: string,
  name?: string | null,
  description?: string | null,
  avatar?: string | null,
  adminOnlyPosting?: boolean | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.update_group(
      conversationId,
      candidOpt(name),
      candidOpt(avatar),
      candidOpt(description),
      candidOpt(adminOnlyPosting),
    ),
    "Update group",
  );
}

/**
 * AI catch-up recap for a conversation — the canister makes an HTTPS
 * outcall to the configured LLM endpoint (see set_recap_config). Caller
 * needs message-read access and ai_catchup_enabled in their messaging
 * settings (governor/app_admin bypass).
 */
export async function generateLiveChatRecap(
  ctx: FeatureBackendContext,
  conversationId: string,
  sinceMs: bigint,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.generate_chat_recap(conversationId, sinceMs),
    "Generate chat recap",
  );
}

export async function addLiveGroupMembers(
  ctx: FeatureBackendContext,
  conversationId: string,
  members: Principal[],
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.add_group_members(conversationId, members), "Add group members");
}

export async function softDeleteLiveGroup(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.soft_delete_group(conversationId), "Delete group");
}

// ---------------------------------------------------------------------------
// Presence & blocking.
// ---------------------------------------------------------------------------

/** Record the caller's heartbeat; call on an interval while chat is open. */
export async function livePresenceHeartbeat(ctx: FeatureBackendContext, platform?: string | null) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.presence_heartbeat(candidOpt(platform ?? null)), "Presence heartbeat");
}

/** All users seen online in the last 90s. App-admin/governor only canister-side. */
export async function liveListAllOnlineUsers(
  ctx: FeatureBackendContext,
): Promise<{ user: Principal; last_seen_ms: bigint; platform: [] | [string] }[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const result = await actor.list_all_online_users();
  if ("Err" in result) throw new Error(`List online users failed: ${result.Err}`);
  return result.Ok;
}

/**
 * Governor-only system DM (welcome message). Idempotent per
 * `idempotencyKey`; the canister finds-or-creates the DM conversation and
 * bypasses block checks. Throws on #Err so callers fall back to the
 * Supabase edge-function path or skip silently.
 */
export async function sendLiveSystemMessage(
  ctx: FeatureBackendContext,
  toUser: Principal,
  body: string,
  idempotencyKey: string,
): Promise<void> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  await unwrapCandid(Promise.resolve(actor.send_system_message(toUser, body, idempotencyKey)), "Send system message");
}

/**
 * Post-signup welcome DM. Any authenticated caller may trigger it for
 * themselves; the canister posts it from the governor (the support
 * identity) and derives the idempotency key from the caller, so repeated
 * calls are safe no-ops. Fire-and-forget from the caller's perspective.
 */
export async function sendLiveWelcomeMessage(
  ctx: FeatureBackendContext,
  body: string,
): Promise<void> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  await unwrapCandid(Promise.resolve(actor.send_welcome_message(body)), "Send welcome message");
}

/** Minimum supported app versions per platform, governor-configured on the canister. */
export async function getLiveMinimumAppVersions(
  ctx: FeatureBackendContext,
): Promise<[string, string][]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const result = await actor.get_minimum_app_versions();
  if ("Err" in result) throw new Error(`Get minimum app versions failed: ${result.Err}`);
  return result.Ok;
}

/**
 * Server-side link preview via the canister's HTTPS outcall (replicated
 * read, no API key needed). Replaces the Supabase fetch-link-preview edge
 * function in ICP mode.
 */
export async function fetchLiveLinkPreview(
  ctx: FeatureBackendContext,
  url: string,
): Promise<{ title: [] | [string]; description: [] | [string]; image: [] | [string]; site_name: [] | [string] }> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(Promise.resolve(actor.fetch_link_preview(url)), "Fetch link preview");
}

/**
 * Link preview for email-account (Supabase) users: same messaging_domain
 * outcall, called anonymously (the canister caches per URL and caps anonymous
 * outcalls per hour). Returns null when the messaging canister isn't set.
 */
export async function fetchAnonymousLinkPreview(url: string) {
  const [{ AnonymousIdentity }, { getActiveIcpTarget }, { isDomainConfigured }] = await Promise.all([
    import("@icp-sdk/core/agent"),
    import("../targetRegistry"),
    import("../domains"),
  ]);
  const target = getActiveIcpTarget();
  if (!isDomainConfigured(target, "messaging_domain")) return null;
  return fetchLiveLinkPreview({ target, identity: new AnonymousIdentity() } as unknown as FeatureBackendContext, url);
}

/**
 * Online participant count for a conversation (last 90s, caller excluded).
 * Callers pass the team/club/group id — it doubles as the conversation id
 * under the same provisional mapping the send/read paths use.
 */
export async function liveOnlineCount(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  // Query call: the binding resolves to the variant directly, not a Promise.
  const result = await actor.online_count(conversationId);
  if ("Err" in result) throw new Error(`Online count failed: ${result.Err}`);
  return Number(result.Ok);
}

export async function liveBlockUser(ctx: FeatureBackendContext, user: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.block_user(user), "Block user");
}

export async function liveUnblockUser(ctx: FeatureBackendContext, user: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unblock_user(user), "Unblock user");
}

/** Principals (as text) the caller has blocked. */
export async function liveListBlockedUsers(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const blocked = await actor.list_blocked_users();
  return blocked.map((p) => p.toText());
}

// ---------------------------------------------------------------------------
// Join requests.
// ---------------------------------------------------------------------------

export async function requestLiveJoinGroup(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.request_join_group(conversationId), "Request to join group");
}

export async function approveLiveJoinRequest(
  ctx: FeatureBackendContext,
  conversationId: string,
  user: Principal,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.approve_join_request(conversationId, user), "Approve join request");
}

export async function rejectLiveJoinRequest(
  ctx: FeatureBackendContext,
  conversationId: string,
  user: Principal,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.reject_join_request(conversationId, user), "Reject join request");
}

export async function listLiveJoinRequests(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_join_requests(conversationId), "List join requests");
}

// ---------------------------------------------------------------------------
// Polls.
// ---------------------------------------------------------------------------

export async function createLivePoll(
  ctx: FeatureBackendContext,
  conversationId: string,
  messageId: string | null | undefined,
  question: string,
  options: string[],
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.create_poll(conversationId, candidOpt(messageId), question, options),
    "Create poll",
  );
}

export async function voteLivePoll(ctx: FeatureBackendContext, pollId: string, optionIndex: number) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.vote_poll(pollId, optionIndex), "Vote poll");
}

export async function closeLivePoll(ctx: FeatureBackendContext, pollId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.close_poll(pollId), "Close poll");
}

export async function getLivePollResults(ctx: FeatureBackendContext, pollId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_poll_results(pollId), "Get poll results");
}

// ---------------------------------------------------------------------------
// Mute preferences.
// ---------------------------------------------------------------------------

export async function setLiveMutePreference(
  ctx: FeatureBackendContext,
  conversationId: string,
  muted: boolean,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_mute_preference(conversationId, muted), "Set mute preference");
}

export async function getLiveMutePreference(ctx: FeatureBackendContext, conversationId: string) {
  return batched<MessagingActor, boolean>(
    ctx, "messaging:mute", conversationId, msgConn(ctx),
    async (actor, ids) => new Map(await unwrapCandid(actor.get_mute_preferences(ids), "Get mute preferences")),
    (actor, id) => actor.get_mute_preference(id),
  );
}

// ---------------------------------------------------------------------------
// Direct messages and message forwarding.
// ---------------------------------------------------------------------------

export async function getOrCreateLiveDm(ctx: FeatureBackendContext, other: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.get_or_create_dm(other), "Get or create DM");
}

export async function forwardLiveMessage(
  ctx: FeatureBackendContext,
  messageId: string,
  toConversationId: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.forward_message(messageId, toConversationId), "Forward message");
}

// ---------------------------------------------------------------------------
// Scheduled messages — canister-side register/replay, distinct from the
// notification_queue's schedule_message/list_scheduled/cancel_scheduled.
// ---------------------------------------------------------------------------

export async function registerLiveScheduledMessage(
  ctx: FeatureBackendContext,
  conversationId: string,
  body: string,
  scheduledAtMs: number,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.register_scheduled_message(conversationId, body, BigInt(Math.trunc(scheduledAtMs))),
    "Register scheduled message",
  );
}

export async function replayLiveScheduledMessage(ctx: FeatureBackendContext, id: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.replay_scheduled_message(id), "Replay scheduled message");
}

// ---------------------------------------------------------------------------
// Attachments and reactions.
// ---------------------------------------------------------------------------

export async function registerLiveAttachmentMetadata(
  ctx: FeatureBackendContext,
  conversationId: string,
  messageId: string | null | undefined,
  kind: string,
  refId: string,
  url?: string | null,
  sizeBytes?: number | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.register_attachment_metadata(
      conversationId,
      candidOpt(messageId),
      kind,
      refId,
      candidOpt(url),
      candidOpt(sizeBytes === null || sizeBytes === undefined ? undefined : BigInt(Math.trunc(sizeBytes))),
    ),
    "Register attachment metadata",
  );
}

export async function toggleLiveReaction(ctx: FeatureBackendContext, messageId: string, emoji: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.toggle_reaction(messageId, emoji), "Toggle reaction");
}

export interface LiveReaction {
  message_id: string;
  user: Principal;
  emoji: string;
}

/**
 * Full reaction rows for a conversation (who reacted with which emoji), so
 * chat pages can restore reactions after a refetch. Requires the canister
 * version that ships `list_reactions`; callers should tolerate the method
 * being absent on an older deploy.
 */
export async function listLiveReactions(
  ctx: FeatureBackendContext,
  conversationId: string,
): Promise<LiveReaction[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.list_reactions(conversationId), "List reactions");
}

// ---------------------------------------------------------------------------
// Messages since / unread-by-club / recent conversations.
// ---------------------------------------------------------------------------

export async function messagesLiveSince(
  ctx: FeatureBackendContext,
  conversationId: string,
  sinceMs: number,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.messages_since(conversationId, BigInt(Math.trunc(sinceMs))),
    "Messages since",
  );
}

export async function unreadLiveCountByClub(ctx: FeatureBackendContext, principal: Principal) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unread_count_by_club(principal), "Unread count by club");
}

export async function recentLiveConversations(
  ctx: FeatureBackendContext,
  principal: Principal,
  limit: number,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.recent_conversations(principal, limit), "Recent conversations");
}

// ---------------------------------------------------------------------------
// Club DM settings and per-user messaging settings.
// ---------------------------------------------------------------------------

export async function getLiveClubDmSettings(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.get_club_dm_settings(clubId);
}

export async function setLiveClubDmSettings(
  ctx: FeatureBackendContext,
  clubId: string,
  dmDisabled: boolean,
  attachmentsDisabled: boolean,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_dm_settings(clubId, dmDisabled, attachmentsDisabled),
    "Set club DM settings",
  );
}

export async function setLiveClubDmAllowedRoles(
  ctx: FeatureBackendContext,
  clubId: string,
  allowedRoles: string[],
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_dm_allowed_roles(clubId, allowedRoles),
    "Set club DM allowed roles",
  );
}

export async function setLiveClubMessagePrivacy(
  ctx: FeatureBackendContext,
  clubId: string,
  forceDisablePreviews: boolean,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_message_privacy(clubId, forceDisablePreviews),
    "Set club message privacy",
  );
}

export async function setLiveClubAiCatchUp(
  ctx: FeatureBackendContext,
  clubId: string,
  aiCatchUpEnabled: boolean,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_club_ai_catch_up(clubId, aiCatchUpEnabled),
    "Set club AI catch-up",
  );
}

export async function enableLiveAiCatchUpForAllMembers(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(
    actor.enable_ai_catch_up_for_all_members(clubId),
    "Enable AI catch-up for all members",
  );
  return Number(raw);
}

export async function getLiveUserMessagingSettings(ctx: FeatureBackendContext) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return actor.get_user_messaging_settings();
}

export async function setLiveUserMessagingSettings(
  ctx: FeatureBackendContext,
  hideMessagePreview: boolean,
  aiCatchupEnabled: boolean,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(
    actor.set_user_messaging_settings(hideMessagePreview, aiCatchupEnabled),
    "Set user messaging settings",
  );
}

// ---------------------------------------------------------------------------
// Poll delete / group membership removal / leave.
// ---------------------------------------------------------------------------

export async function deleteLivePoll(ctx: FeatureBackendContext, pollId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.delete_poll(pollId), "Delete poll");
}

export async function removeLiveGroupMember(
  ctx: FeatureBackendContext,
  conversationId: string,
  member: Principal,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(
    actor.remove_group_member(conversationId, member),
    "Remove group member",
  );
  return toLiveGroupMetadata(raw);
}

export async function leaveLiveGroup(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.leave_group(conversationId), "Leave group");
  return toLiveGroupMetadata(raw);
}

// ---------------------------------------------------------------------------
// Typing indicators & pinned messages.
// ---------------------------------------------------------------------------

export interface LiveTypingUser {
  user: Principal;
  name: string;
}

/** Record (or clear) the caller's typing state in a conversation. */
export async function setLiveTyping(
  ctx: FeatureBackendContext,
  conversationId: string,
  isTyping: boolean,
  name: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_typing(conversationId, isTyping, name), "Set typing");
}

/** Currently-typing users in a conversation (recent pings only, canister-side TTL). */
export async function listLiveTyping(
  ctx: FeatureBackendContext,
  conversationId: string,
): Promise<LiveTypingUser[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.list_typing(conversationId), "List typing");
  return raw.map((entry) => ({ user: entry.user, name: entry.name }));
}

export interface LivePinnedMessage {
  id: string;
  conversationId: string;
  messageId: string;
  pinnedBy: Principal;
  createdAtMs: number;
}

function toLivePinnedMessage(raw: {
  id: string;
  conversation_id: string;
  message_id: string;
  pinned_by: Principal;
  created_at_ms: bigint;
}): LivePinnedMessage {
  return {
    id: raw.id,
    conversationId: raw.conversation_id,
    messageId: raw.message_id,
    pinnedBy: raw.pinned_by,
    createdAtMs: Number(raw.created_at_ms),
  };
}

export async function pinLiveMessage(
  ctx: FeatureBackendContext,
  conversationId: string,
  messageId: string,
): Promise<LivePinnedMessage> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.pin_message(conversationId, messageId), "Pin message");
  return toLivePinnedMessage(raw);
}

export async function unpinLiveMessage(
  ctx: FeatureBackendContext,
  conversationId: string,
  messageId: string,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.unpin_message(conversationId, messageId), "Unpin message");
}

export async function listLivePinnedMessages(
  ctx: FeatureBackendContext,
  conversationId: string,
): Promise<LivePinnedMessage[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(
    actor.list_pinned_messages(conversationId),
    "List pinned messages",
  );
  return raw.map(toLivePinnedMessage);
}

export interface LiveGroupSummary {
  conversationId: string;
  kind: string;
  name: string;
  teamId: string | null;
  clubId: string | null;
  memberCount: number;
  isMember: boolean;
  description: string | null;
  avatar: string | null;
}

function toLiveGroupSummary(raw: {
  conversation_id: string;
  kind: string;
  name: string;
  team_id: [] | [string];
  club_id: [] | [string];
  member_count: number;
  is_member: boolean;
  description: [] | [string];
  avatar: [] | [string];
}): LiveGroupSummary {
  return {
    conversationId: raw.conversation_id,
    kind: raw.kind,
    name: raw.name,
    teamId: raw.team_id[0] ?? null,
    clubId: raw.club_id[0] ?? null,
    memberCount: Number(raw.member_count),
    isMember: raw.is_member,
    description: raw.description[0] ?? null,
    avatar: raw.avatar[0] ?? null,
  };
}

/** Groups (team/club/competition chats) scoped to a club — the canister counterpart of the `chat_groups` by-club read. */
export async function listLiveGroupsByClub(ctx: FeatureBackendContext, clubId: string) {
  const raw = await batched(
    ctx, "messaging:groups_by_club", clubId, msgConn(ctx),
    async (actor: MessagingActor, ids) => {
      const rows = await unwrapCandid(actor.list_groups_by_clubs(ids), "List groups by club");
      return groupBy(ids, rows, (r) => {
        const c = (r as { club_id?: unknown }).club_id;
        return Array.isArray(c) ? String(c[0] ?? "") : String(c ?? "");
      });
    },
    (actor: MessagingActor, id) => unwrapCandid(actor.list_groups_by_club(id), "List groups by club"),
  );
  return raw.map(toLiveGroupSummary);
}

/** Groups scoped to a team — the canister counterpart of the `chat_groups` by-team read. */
export async function listLiveGroupsByTeam(ctx: FeatureBackendContext, teamId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.list_groups_by_team(teamId), "List groups by team");
  return raw.map(toLiveGroupSummary);
}

export interface LiveReadReceipt {
  conversationId: string;
  messageId: string;
  read: boolean;
  user: Principal;
}

/** Per-conversation read receipts — the canister counterpart of the Supabase `message_reads` table read. */
export async function listLiveReadReceipts(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.list_read_receipts(conversationId), "List read receipts");
  return raw.map((r) => ({
    conversationId: r.conversation_id,
    messageId: r.message_id,
    read: r.read,
    user: r.user,
  } satisfies LiveReadReceipt));
}

// ---------------------------------------------------------------------------
// Deleted-chats admin tool (app admin: all clubs; club admin: own club).
// ---------------------------------------------------------------------------

export interface LiveDeletedGroup {
  conversationId: string;
  name: string;
  kind: string;
  clubId: string | null;
  teamId: string | null;
  memberCount: number;
  createdAtMs: number;
  deletedAtMs: number | null;
  deletedBy: string | null;
}

/** Soft-deleted groups visible to the caller (scoped canister-side by role). */
export async function listLiveDeletedGroups(ctx: FeatureBackendContext): Promise<LiveDeletedGroup[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.list_deleted_groups(), "List deleted groups");
  return raw.map((m) => ({
    conversationId: m.conversation_id,
    name: m.name,
    kind: m.kind,
    clubId: m.club_id[0] ?? null,
    teamId: m.team_id[0] ?? null,
    memberCount: m.members.length,
    createdAtMs: Number(m.created_at_ms),
    deletedAtMs: m.deleted_at_ms[0] != null ? Number(m.deleted_at_ms[0]) : null,
    deletedBy: m.deleted_by[0]?.toText() ?? null,
  }));
}

export async function restoreLiveGroup(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.restore_group(conversationId), "Restore group");
}

/** Permanently removes a soft-deleted group and all of its data. App admin only. */
export async function purgeLiveGroup(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.purge_group(conversationId), "Purge group");
}

// ---------------------------------------------------------------------------
// DM attachment restriction admin lists (app admin only).
// ---------------------------------------------------------------------------

export async function listLiveDmAttachmentsDisabled(ctx: FeatureBackendContext): Promise<string[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.list_dm_attachments_disabled(), "List DM attachment restrictions");
  return raw.map((p) => p.toText());
}

export interface LiveClubDmSettings {
  clubId: string;
  dmDisabled: boolean;
  attachmentsDisabled: boolean;
  allowedRoles: string[];
  forceDisablePreviews: boolean;
  aiCatchUpEnabled: boolean;
}

export async function listLiveAllClubDmSettings(ctx: FeatureBackendContext): Promise<LiveClubDmSettings[]> {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const raw = await unwrapCandid(actor.list_club_dm_settings(), "List club DM settings");
  return raw.map((s) => ({
    clubId: s.club_id,
    dmDisabled: s.dm_disabled,
    attachmentsDisabled: s.attachments_disabled,
    allowedRoles: s.allowed_roles,
    forceDisablePreviews: s.force_disable_previews,
    aiCatchUpEnabled: s.ai_catch_up_enabled,
  }));
}

// ---------------------------------------------------------------------------
// Open-group discovery (join policy + category per club group)
// ---------------------------------------------------------------------------

export async function setLiveGroupJoinPolicy(
  ctx: FeatureBackendContext,
  conversationId: string,
  joinPolicy: "invite_only" | "request_to_join" | "open_to_club",
  category: string | null,
) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.set_group_join_policy(conversationId, joinPolicy, candidOpt(category)), "Set join policy");
}

export async function getLiveGroupJoinPolicy(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const r = await actor.get_group_join_policy(conversationId);
  return { joinPolicy: r.join_policy, category: r.category[0] ?? null };
}

export async function listLiveOpenGroups(ctx: FeatureBackendContext, clubId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  const rows = await unwrapCandid(actor.list_open_groups(clubId), "List open groups");
  return rows.map((r) => ({
    ...toLiveGroupSummary(r.summary),
    joinPolicy: r.join_policy,
    category: r.category[0] ?? null,
    requested: r.requested,
  }));
}

export async function joinLiveOpenGroup(ctx: FeatureBackendContext, conversationId: string) {
  const { actor } = await connectLiveMessagingDomain(ctx.target, ctx.identity);
  return unwrapCandid(actor.join_open_group(conversationId), "Join group");
}
