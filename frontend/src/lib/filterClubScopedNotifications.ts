import { supabase } from "@/integrations/supabase/client";

interface NotifRow {
  id: string;
  type: string;
  related_id: string | null;
  club_id?: string | null;
  [k: string]: any;
}

/**
 * Many notification rows are written with `club_id = NULL` even though the
 * underlying entity (team_message, club_message, group_message, event_*,
 * pending_sub, team_invite, photo_comment, etc.) does belong to a specific
 * club. The bell-badge SQL widens its filter to include `club_id IS NULL` to
 * avoid hiding genuinely-global rows (system_update, role_request_*, child_added,
 * streak/reward) — but that widening lets *other clubs'* notifications leak
 * into the active-club badge.
 *
 * This helper resolves the owning club for each row via its `related_id` and
 * drops anything whose owning club is not `activeClubFilter`. Types we can't
 * resolve (or are genuinely global) pass through.
 */

// Types that have no per-club entity — always keep regardless of active club.
const GLOBAL_PASSTHROUGH = new Set<string>([
  "system_update",
  "role_request",
  "role_request_approved",
  "role_request_denied",
  "child_added",
  "join_request",
]);

// Types known to belong to a specific club via an underlying entity. If we
// cannot resolve ownership for one of these, fail closed (drop) rather than
// leaking a foreign-club row into the active-club view.
const KNOWN_CLUB_SCOPED_TYPES = new Set<string>([
  "direct_message",
  "message_reaction",
  "team_message",
  "message_mention",
  "message_reply",
  "club_message",
  "group_message",
  "event_invite",
  "event_note",
  "event_updated",
  "rsvp_updated",
  "pending_sub",
  "formation_change",
  "half_time",
  "game_finished",
  "team_invite",
  "comment_reaction",
  "comment_reply",
  "photo_comment",
  // Reward / gamification family — every one of these is generated per-club
  // and must never surface while the app is filtered to a different club.
  "reward_claimed",
  "reward_proximity",
  "reward_unlocked",
  "early_rsvp_points",
  "streak_progress",
  "streak_bonus",
  "leaderboard_update",
  "points_awarded",
]);


export async function filterClubScopedNotifications<T extends NotifRow>(
  rows: T[],
  recipientUserId: string,
  activeClubFilter: string,
): Promise<T[]> {
  if (!rows.length) return rows;

  // Decision map: notification.id -> "keep" | "drop" | undefined (unresolved → keep)
  const decision = new Map<string, "keep" | "drop">();

  // Anything already scoped to the active club: keep. Anything scoped to a
  // different club: drop. (Defence in depth — the SQL OR shouldn't return
  // these but better safe.)
  for (const n of rows) {
    if (n.club_id) {
      decision.set(n.id, n.club_id === activeClubFilter ? "keep" : "drop");
    } else if (GLOBAL_PASSTHROUGH.has(n.type)) {
      decision.set(n.id, "keep");
    }
  }

  const remaining = rows.filter((n) => !decision.has(n.id) && n.related_id);

  // ---- Group remaining rows by type for batched resolution ----
  const byType: Record<string, T[]> = {};
  for (const n of remaining) {
    (byType[n.type] ||= []).push(n);
  }

  const setDecisionByOwningClub = (n: T, owningClubId: string | null | undefined) => {
    if (!owningClubId) return; // unresolved — leave undefined (kept by default)
    decision.set(n.id, owningClubId === activeClubFilter ? "keep" : "drop");
  };

  // --- DMs (existing behaviour) ---
  const dmRows = byType["direct_message"] || [];
  const authorByDmMsg = new Map<string, string>();
  if (dmRows.length) {
    const { data } = await supabase
      .from("direct_messages")
      .select("id, author_id")
      .in("id", dmRows.map((n) => n.related_id as string));
    (data || []).forEach((m: any) => authorByDmMsg.set(m.id, m.author_id));
  }

  // --- team_message / team_message_reply etc. ---
  const teamMsgTypes = ["team_message", "message_mention", "message_reply"];
  const teamMsgRows = teamMsgTypes.flatMap((t) => byType[t] || []);
  const teamIdByMsg = new Map<string, string>();
  if (teamMsgRows.length) {
    const { data } = await supabase
      .from("team_messages")
      .select("id, team_id")
      .in("id", teamMsgRows.map((n) => n.related_id as string));
    (data || []).forEach((m: any) => teamIdByMsg.set(m.id, m.team_id));
  }

  // --- club_message ---
  const clubMsgRows = byType["club_message"] || [];
  const clubByClubMsg = new Map<string, string>();
  if (clubMsgRows.length) {
    const { data } = await supabase
      .from("club_messages")
      .select("id, club_id")
      .in("id", clubMsgRows.map((n) => n.related_id as string));
    (data || []).forEach((m: any) => clubByClubMsg.set(m.id, m.club_id));
  }

  // --- group_message ---
  const groupMsgRows = byType["group_message"] || [];
  const groupIdByMsg = new Map<string, string>();
  if (groupMsgRows.length) {
    const { data } = await supabase
      .from("group_messages")
      .select("id, group_id")
      .in("id", groupMsgRows.map((n) => n.related_id as string));
    (data || []).forEach((m: any) => groupIdByMsg.set(m.id, m.group_id));
  }

  // --- event-related ---
  const eventTypes = [
    "event_invite", "event_note", "event_updated", "rsvp_updated",
    "pending_sub", "formation_change", "half_time", "game_finished",
    "points_awarded", "early_rsvp_points",
  ];
  const eventRows = eventTypes.flatMap((t) => byType[t] || []);
  const eventClubByEvent = new Map<string, { club_id: string | null; team_id: string | null }>();
  if (eventRows.length) {
    const { data } = await supabase
      .from("events")
      .select("id, club_id, team_id")
      .in("id", eventRows.map((n) => n.related_id as string));
    (data || []).forEach((e: any) => eventClubByEvent.set(e.id, { club_id: e.club_id, team_id: e.team_id }));
  }

  // --- team_invite ---
  const teamInviteRows = byType["team_invite"] || [];
  const teamByInvite = new Map<string, string>();
  if (teamInviteRows.length) {
    const { data } = await supabase
      .from("team_invites")
      .select("id, team_id")
      .in("id", teamInviteRows.map((n) => n.related_id as string));
    (data || []).forEach((r: any) => teamByInvite.set(r.id, r.team_id));
  }

  // --- photo_comment / comment_reaction / comment_reply ---
  const commentTypes = ["comment_reaction", "comment_reply", "photo_comment"];
  const commentRows = commentTypes.flatMap((t) => byType[t] || []);
  const photoIdByComment = new Map<string, string>();
  if (commentRows.length) {
    const { data } = await supabase
      .from("photo_comments")
      .select("id, photo_id")
      .in("id", commentRows.map((n) => n.related_id as string));
    (data || []).forEach((c: any) => photoIdByComment.set(c.id, c.photo_id));
  }

  // --- message_reaction (DM conversation) ---
  const reactionRows = byType["message_reaction"] || [];
  const otherByConversation = new Map<string, string>();
  if (reactionRows.length) {
    const { data } = await supabase
      .from("direct_conversations")
      .select("id, participant_1, participant_2")
      .in("id", reactionRows.map((n) => n.related_id as string));
    (data || []).forEach((c: any) => {
      const other = c.participant_1 === recipientUserId ? c.participant_2 : c.participant_1;
      otherByConversation.set(c.id, other);
    });
  }

  // --- reward_claimed (redemption → club) ---
  const rewardClaimedRows = byType["reward_claimed"] || [];
  const clubByRedemption = new Map<string, string>();
  if (rewardClaimedRows.length) {
    const { data } = await supabase
      .from("reward_redemptions")
      .select("id, club_id")
      .in("id", rewardClaimedRows.map((n) => n.related_id as string));
    (data || []).forEach((r: any) => r.club_id && clubByRedemption.set(r.id, r.club_id));
  }

  // --- reward_proximity (club_rewards → club) ---
  const proximityRows = byType["reward_proximity"] || [];
  const clubByReward = new Map<string, string>();
  if (proximityRows.length) {
    const { data } = await supabase
      .from("club_rewards")
      .select("id, club_id")
      .in("id", proximityRows.map((n) => n.related_id as string));
    (data || []).forEach((r: any) => r.club_id && clubByReward.set(r.id, r.club_id));
  }

  // ---- Batch second-level resolutions ----

  // teams (from team_messages + team_invites) → clubs
  const teamIds = [...new Set([
    ...teamIdByMsg.values(),
    ...teamByInvite.values(),
    ...[...eventClubByEvent.values()].map((e) => e.team_id).filter(Boolean) as string[],
  ])];
  const clubByTeam = new Map<string, string>();
  if (teamIds.length) {
    const { data } = await supabase
      .from("teams")
      .select("id, club_id")
      .in("id", teamIds);
    (data || []).forEach((t: any) => clubByTeam.set(t.id, t.club_id));
  }

  // chat_groups → clubs (group_messages)
  const groupIds = [...new Set(groupIdByMsg.values())];
  const clubByGroup = new Map<string, string | null>();
  if (groupIds.length) {
    const { data } = await supabase
      .from("chat_groups")
      .select("id, club_id, team_id")
      .in("id", groupIds);
    (data || []).forEach((g: any) => {
      clubByGroup.set(g.id, g.club_id ?? (g.team_id ? clubByTeam.get(g.team_id) ?? null : null));
    });
  }

  // photos → clubs (photo_comments)
  const photoIds = [...new Set(photoIdByComment.values())];
  const clubByPhoto = new Map<string, string | null>();
  if (photoIds.length) {
    const { data } = await supabase
      .from("photos")
      .select("id, club_id, team_id")
      .in("id", photoIds);
    (data || []).forEach((p: any) => {
      clubByPhoto.set(p.id, p.club_id ?? (p.team_id ? clubByTeam.get(p.team_id) ?? null : null));
    });
  }

  // DM author → share-a-club check
  const dmAuthorIds = [...new Set([
    ...authorByDmMsg.values(),
    ...otherByConversation.values(),
  ].filter(Boolean) as string[])];
  const allowedUsers = new Set<string>();
  if (dmAuthorIds.length) {
    const { data: directRoles } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("user_id", dmAuthorIds)
      .eq("club_id", activeClubFilter);
    (directRoles || []).forEach((r: any) => allowedUsers.add(r.user_id));
    const { data: teamRoles } = await supabase
      .from("user_roles")
      .select("user_id, teams!inner(club_id)")
      .in("user_id", dmAuthorIds)
      .eq("teams.club_id", activeClubFilter);
    (teamRoles || []).forEach((r: any) => allowedUsers.add(r.user_id));
  }

  // ---- Apply decisions ----
  for (const n of remaining) {
    if (decision.has(n.id)) continue;
    const rid = n.related_id as string;

    switch (n.type) {
      case "direct_message": {
        const author = authorByDmMsg.get(rid);
        decision.set(n.id, author && allowedUsers.has(author) ? "keep" : "drop");
        break;
      }
      case "message_reaction": {
        // DM reaction: scope via other participant share-a-club.
        // Non-DM reaction: related_id not in conversations map → leave unresolved (keep).
        const other = otherByConversation.get(rid);
        if (other) decision.set(n.id, allowedUsers.has(other) ? "keep" : "drop");
        break;
      }
      case "team_message":
      case "message_mention":
      case "message_reply": {
        const teamId = teamIdByMsg.get(rid);
        if (teamId) setDecisionByOwningClub(n, clubByTeam.get(teamId));
        break;
      }
      case "club_message": {
        setDecisionByOwningClub(n, clubByClubMsg.get(rid));
        break;
      }
      case "group_message": {
        const groupId = groupIdByMsg.get(rid);
        if (groupId) setDecisionByOwningClub(n, clubByGroup.get(groupId) ?? null);
        break;
      }
      case "event_invite":
      case "event_note":
      case "event_updated":
      case "rsvp_updated":
      case "pending_sub":
      case "formation_change":
      case "half_time":
      case "game_finished":
      case "points_awarded": {
        const ev = eventClubByEvent.get(rid);
        if (ev) {
          const club = ev.club_id ?? (ev.team_id ? clubByTeam.get(ev.team_id) ?? null : null);
          setDecisionByOwningClub(n, club);
        }
        break;
      }
      case "early_rsvp_points": {
        // New reminder rows use related_id=event id, while awarded-point rows
        // use related_id=club id. Resolve an event when one exists; otherwise
        // retain the established direct-club producer contract.
        const ev = eventClubByEvent.get(rid);
        if (ev) {
          const club = ev.club_id ?? (ev.team_id ? clubByTeam.get(ev.team_id) ?? null : null);
          setDecisionByOwningClub(n, club);
        } else {
          decision.set(n.id, rid === activeClubFilter ? "keep" : "drop");
        }
        break;
      }
      case "team_invite": {
        const teamId = teamByInvite.get(rid);
        if (teamId) setDecisionByOwningClub(n, clubByTeam.get(teamId));
        break;
      }
      case "comment_reaction":
      case "comment_reply":
      case "photo_comment": {
        const photoId = photoIdByComment.get(rid);
        if (photoId) setDecisionByOwningClub(n, clubByPhoto.get(photoId) ?? null);
        break;
      }
      case "reward_claimed": {
        setDecisionByOwningClub(n, clubByRedemption.get(rid));
        break;
      }
      case "reward_proximity": {
        setDecisionByOwningClub(n, clubByReward.get(rid));
        break;
      }
      case "reward_unlocked":
      case "streak_progress":
      case "streak_bonus":
      case "leaderboard_update": {
        // Producer contract: related_id IS the owning club's id. Anything
        // else (or a missing related_id) stays unresolved → fail closed.
        if (rid) decision.set(n.id, rid === activeClubFilter ? "keep" : "drop");
        break;
      }
      default:
        // Unknown type — leave unresolved (kept by default).
        break;
    }
  }

  return rows.filter((n) => {
    const d = decision.get(n.id);
    if (d === "drop") return false;
    if (d === "keep") return true;
    // Unresolved: fail closed for known club-scoped types; keep unknown/global.
    if (KNOWN_CLUB_SCOPED_TYPES.has(n.type)) return false;
    return true;
  });
}
