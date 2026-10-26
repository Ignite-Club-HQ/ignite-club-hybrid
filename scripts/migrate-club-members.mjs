// Pure claim-gated conversions. No network, claim activation or source writes.
const opt = v => v == null || v === '' ? [] : [v];
export function timestamp(value, optional = false) {
  if (value == null && optional) return [];
  const n = Date.parse(value);
  if (!Number.isSafeInteger(n) || n < 0) throw Error('Invalid source timestamp');
  return optional ? [BigInt(n)] : BigInt(n);
}
function integer(value, min, max) {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw Error('Invalid source points value');
  return value;
}
const int32 = v => integer(v, -2147483648, 2147483647);
const nat32 = v => integer(v, 0, 4294967295);
export function claimedPrincipal(claims, user) {
  const p = claims?.get(user);
  if (!p || typeof p.toText !== 'function' || ['2vxsx-fae', 'aaaaa-aa'].includes(p.toText())) throw Error('Missing verified account claim');
  return p;
}
function childReference(children, id) {
  if (!children?.has(id)) throw Error('Missing verified migrated child');
  return id;
}
function subject(row, claims, children) {
  if (Boolean(row.user_id) === Boolean(row.child_id)) throw Error('Invalid points subject');
  return { user_id: row.user_id ? [claimedPrincipal(claims, row.user_id).toText()] : [],
    child_id: row.child_id ? [childReference(children, row.child_id)] : [] };
}
function principalOpt(claims, user) { return user ? [claimedPrincipal(claims, user)] : []; }
function scoped(rows, clubId) {
  if (rows.some(r => r.club_id !== clubId)) throw Error('Foreign club record refused');
  return rows;
}
function unique(rows, key) {
  const keys = rows.map(key);
  if (new Set(keys).size !== keys.length) throw Error('Duplicate source record refused');
  return rows;
}
function mediaReference(url, media) {
  if (!url) return [];
  const ref = media?.get(url);
  if (!ref) throw Error('Missing verified migrated media reference');
  return [ref];
}

/** Preserve ledgers, not new awards/transactions. Child/media dependencies must already be verified. */
export function buildPointsSnapshot({ clubId, claims, migratedChildren, mediaReferences, club, subscriptions = [],
  rewards = [], users = [], children = [], history = [], redemptions = [], cooldowns = [] }) {
  if (club?.id !== clubId) throw Error('Foreign club settings refused');
  for (const rows of [subscriptions, rewards, users, children, history, redemptions, cooldowns]) scoped(rows, clubId);
  if (subscriptions.length > 1) throw Error('Duplicate subscription settings refused');
  for (const rows of [rewards, history, redemptions, cooldowns]) unique(rows, r => r.id);
  unique(users, r => r.user_id); unique(children, r => r.child_id);
  const rewardIds = new Set(rewards.map(r => r.id));
  const sub = subscriptions[0];
  return {
    roles: [], // Authority comes from the separately imported club memberships, never from a claim.
    users: users.map(r => ({ club_id: clubId, user_id: claimedPrincipal(claims, r.user_id).toText(), points: int32(r.points), updated_at_ms: timestamp(r.updated_at) })),
    children: children.map(r => ({ club_id: clubId, child_id: childReference(migratedChildren, r.child_id), points: int32(r.points), updated_at_ms: timestamp(r.updated_at) })),
    history: history.map(r => ({ id: r.id, club_id: clubId, ...subject(r, claims, migratedChildren), amount: int32(r.amount),
      balance_after: int32(r.balance_after), source_type: r.source_type, source_id: opt(r.source_id), description: r.description,
      created_at_ms: timestamp(r.created_at), created_by: principalOpt(claims, r.created_by), season_id: opt(r.season_id) })),
    rewards: rewards.map(r => ({ id: r.id, club_id: clubId, name: r.name, description: opt(r.description), points_required: nat32(r.points_required),
      is_default: r.is_default, is_active: r.is_active, logo_url: mediaReference(r.logo_url, mediaReferences), reward_type: r.reward_type,
      qr_code_url: mediaReference(r.qr_code_url, mediaReferences), show_qr_code: r.show_qr_code, sponsor_id: opt(r.sponsor_id), team_id: opt(r.team_id),
      created_at_ms: timestamp(r.created_at), updated_at_ms: timestamp(r.updated_at) })),
    redemptions: redemptions.map(r => {
      if (!rewardIds.has(r.reward_id)) throw Error('Missing redemption reward');
      return { id: r.id, club_id: clubId, reward_id: r.reward_id, ...subject(r, claims, migratedChildren), points_spent: nat32(r.points_spent),
        status: r.status, verified_by: principalOpt(claims, r.verified_by), verified_at_ms: timestamp(r.verified_at, true),
        created_at_ms: timestamp(r.created_at), redeemed_at_ms: timestamp(r.redeemed_at, true), idempotency_key: opt(r.idempotency_key) };
    }),
    cooldowns: cooldowns.map(r => ({ id: r.id, club_id: clubId, user_id: claimedPrincipal(claims, r.user_id).toText(), action_type: r.action_type,
      scope_id: r.scope_id, awarded_date: r.awarded_date, points_awarded: nat32(r.points_awarded), created_at_ms: timestamp(r.created_at) })),
    settings: [{ club_id: clubId, display_name: opt(club.points_display_name), disabled: !!sub?.disable_points_system,
      disable_team_pom_rewards: !!sub?.disable_team_pom_rewards, points_icon_url: mediaReference(club.points_icon_url, mediaReferences),
      updated_at_ms: timestamp(sub?.updated_at ?? club.updated_at ?? club.created_at) }],
  };
}

export function buildClaimedRsvps({ events, rsvps = [], claims, migratedChildren }) {
  const ids = new Set(events.map(e => e.id));
  const rows = rsvps.map(r => {
    if (!ids.has(r.event_id)) throw Error('Foreign event RSVP refused');
    if (r.mini_league_player_id) throw Error('Missing mini-league RSVP subject mapping');
    if (!['going', 'maybe', 'not_going'].includes(r.status)) throw Error('Invalid RSVP status');
    // Snapshot currently lacks these anti-double-award signals; never silently drop them.
    if (r.attendance_points_awarded || r.early_rsvp_points_awarded) throw Error('Missing RSVP award receipt support');
    return { event_id: r.event_id, account_id: claimedPrincipal(claims, r.user_id).toText(),
      child_id: r.child_id ? [childReference(migratedChildren, r.child_id)] : [], state: r.status, notes: r.notes ?? '',
      has_paid: opt(r.has_paid), source: r.source, updated_at_ms: timestamp(r.updated_at) };
  });
  return unique(rows, r => `${r.event_id}\u001f${r.account_id}\u001f${r.child_id[0] ?? ''}`);
}