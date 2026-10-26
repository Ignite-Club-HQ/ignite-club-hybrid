// Pure planning/journal rules for moving ONE whole club from Supabase into a
// chosen canister group. No network access here — migrate-club.mjs supplies
// readings. The Supabase copy is never written by any step.
import { createHash } from 'node:crypto';

export const CONFIRM_MIGRATE = 'MIGRATE CLUB TO CANISTERS';
export const CONFIRM_RECOVER = 'RECOVER CLUB MIGRATION';
export const FILL_LIMIT = 0.8; // capacity-fill-first: new clubs switch away at 80%

/**
 * Source tables per destination step: [table, column, via]. via says what
 * the column holds: club -> the club ID, team -> one of the club's team IDs,
 * event -> one of the club's event IDs. (Polls are counted for team chats.)
 * media: rows that carry Storage objects to copy (encrypted on the way in).
 * Retired drills/pitch tables are intentionally absent.
 */
export const STEPS = Object.freeze([
  { id: 'club', domain: 'club_domain', tables: [
    ['clubs', 'id', 'club'], ['teams', 'club_id', 'club'], ['user_roles', 'club_id', 'club'], ['team_memberships', 'team_id', 'team'], ['team_captains', 'team_id', 'team'],
    ['team_player_positions', 'team_id', 'team'], ['team_folders', 'club_id', 'club'], ['sponsors', 'club_id', 'club'], ['seasons', 'club_id', 'club'],
    ['club_news', 'club_id', 'club'], ['pending_invites', 'club_id', 'club'], ['role_requests', 'club_id', 'club'], ['team_invites', 'team_id', 'team'],
    ['club_member_exclusions', 'club_id', 'club'], ['team_member_exclusions', 'team_id', 'team']] },
  { id: 'children', domain: 'pii_access_control', tables: [['child_team_assignments', 'team_id', 'team']] },
  { id: 'events', domain: 'events_domain', tables: [
    ['events', 'club_id', 'club'], ['rsvps', 'event_id', 'event'], ['duties', 'event_id', 'event'], ['match_captains', 'event_id', 'event'], ['match_goalkeepers', 'event_id', 'event'],
    ['player_of_match', 'event_id', 'event'], ['event_guests', 'event_id', 'event'], ['event_groups', 'event_id', 'event'], ['game_results', 'event_id', 'event'],
    ['game_player_stats', 'event_id', 'event'], ['event_payments', 'event_id', 'event']] },
  { id: 'messaging', domain: 'messaging_domain', tables: [
    ['team_messages', 'team_id', 'team'], ['club_messages', 'club_id', 'club'], ['chat_groups', 'club_id', 'club'], ['polls', 'chat_id', 'team'],
    ['scheduled_messages', 'club_id', 'club'], ['club_admin_conversations', 'club_id', 'club']] },
  { id: 'rewards', domain: 'club_points_domain', tables: [['club_rewards', 'club_id', 'club'], ['user_club_points', 'club_id', 'club'], ['child_club_points', 'club_id', 'club'], ['points_history', 'club_id', 'club'], ['reward_redemptions', 'club_id', 'club'], ['points_cooldowns', 'club_id', 'club'], ['club_subscriptions', 'club_id', 'club']] },
  { id: 'competitions', domain: 'competition_domain', tables: [['competitions', 'organizer_club_id', 'club']] },
  { id: 'mini_leagues', domain: 'mini_league_domain', tables: [['mini_leagues', 'club_id', 'club']] },
  { id: 'notifications', domain: 'notification_queue', tables: [['notifications', 'club_id', 'club']] },
  { id: 'media', domain: 'media_metadata', media: true, tables: [['photos', 'club_id', 'club'], ['photo_albums', 'club_id', 'club']] },
  { id: 'vault', domain: 'vault_domain', media: true, tables: [['vault_files', 'club_id', 'club']] },
  // Byte copy-and-encrypt runs after both metadata steps; it patches their
  // blob_ref pointers via idempotent snapshot re-import.
  { id: 'media_bytes', domain: 'media_blob_store', media: true, tables: [] },
]);

export const VERIFY_STEP = 'verify';
export const ROUTE_STEP = 'route';
export const STEP_ORDER = Object.freeze([...STEPS.map(s => s.id), VERIFY_STEP, ROUTE_STEP]);

const UUIDish = /^[0-9a-zA-Z][0-9a-zA-Z_-]{0,127}$/;
export const normalizeConfirmation = v => String(v ?? '').replace(/[\u200b-\u200d\u2060\ufeff"'`\u2018\u2019\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
export const normalizePlan = v => String(v ?? '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

export function validateRequest({ action, clubId, groupId, plan, confirmation, approvalScope }) {
  if (!['check', 'migrate', 'recover', 'invite'].includes(action)) throw Error('Action must be check, migrate, recover or invite');
  if (!UUIDish.test(String(clubId ?? ''))) throw Error('Club ID is missing or invalid');
  if (!/^g\d+$/.test(String(groupId ?? ''))) throw Error('Target group must look like g1, g2, ...');
  if (action === 'check') return;
  const scope = action === 'invite' ? 'auth' : 'data';
  if (approvalScope !== scope) throw Error(`Separate ${scope} migration approval is required for this club and group`);
  if (action === 'invite') { if (normalizeConfirmation(confirmation) !== 'SEND CLAIM EMAILS') throw Error('Type SEND CLAIM EMAILS'); return; }
  if (normalizePlan(plan).length !== 64) throw Error('Paste the 64-character plan hash from the check run');
  const want = action === 'migrate' ? CONFIRM_MIGRATE : CONFIRM_RECOVER;
  if (normalizeConfirmation(confirmation) !== want) throw Error(`Type ${want}`);
}

/** A build, read-only check, or approval of the other scope grants no writes. */
export function assertMigrationOwner(action, env) {
  if (action === 'check') return;
  const owner = String(env.MIGRATION_OWNER_GITHUB_LOGIN ?? '').trim().toLowerCase();
  if (env.GITHUB_ACTIONS !== 'true' || !owner || String(env.GITHUB_ACTOR ?? '').toLowerCase() !== owner ||
      (env.GITHUB_TRIGGERING_ACTOR && String(env.GITHUB_TRIGGERING_ACTOR).toLowerCase() !== owner)) {
    throw Error('Live migration is disabled until the configured owner personally starts this approved workflow');
  }
}

export function assertMigrationApproval(approval, scope, clubId, groupId, planHash) {
  validateRequest(approval ?? {});
  if (approval.action === 'check' || approval.approvalScope !== scope ||
      approval.clubId !== clubId || approval.groupId !== groupId ||
      (scope === 'data' && normalizePlan(approval.plan) !== planHash)) {
    throw Error(`Separate ${scope} migration approval must match this club, group and plan`);
  }
}

/** Decide whether the club may move into the group. Returns blocking reasons. */
export function gateReasons({ inventory, target, clubOnChain, usage, limits }) {
  const reasons = [];
  if (!inventory?.clubFound) reasons.push('Club not found in Supabase');
  if (!target) reasons.push('Target group is not in the mainnet inventory');
  else {
    const missing = STEPS.map(s => s.domain).filter(d => !target.canisters?.[d]);
    if (missing.length) reasons.push(`Target group lacks: ${[...new Set(missing)].join(', ')}`);
    if (!target.mediaStore) reasons.push('Target group has no photo store');
  }
  if (clubOnChain === null || clubOnChain === undefined) reasons.push('Could not confirm the club is absent from every group');
  else if (clubOnChain) reasons.push(`Club already exists on-chain (${clubOnChain}); encrypted-media clubs stay put`);
  for (const [svc, limit] of Object.entries(limits ?? {})) {
    if (!target?.canisters?.[svc] && svc !== 'media_blob_store') continue;
    const used = usage?.[svc];
    if (typeof used !== 'number') { reasons.push(`Could not read ${svc} usage`); continue; }
    const extra = svc === 'media_blob_store' ? (inventory?.mediaBytes ?? 0) : 0;
    if ((used + extra) / limit > FILL_LIMIT) reasons.push(`${svc} would pass ${FILL_LIMIT * 100}% fill`);
  }
  return reasons;
}

/** Canonical JSON (sorted keys) so the hash is stable. */
export function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  return JSON.stringify(v ?? null);
}

export function buildPlan({ clubId, groupId, revision, inventory, target }) {
  const body = {
    clubId, groupId, revision: String(revision ?? ''),
    canisters: Object.fromEntries(STEPS.map(s => [s.domain, target?.canisters?.[s.domain] ?? null])),
    mediaStore: target?.mediaStore ?? null,
    counts: inventory?.counts ?? {}, mediaFiles: inventory?.mediaFiles ?? 0, mediaBytes: inventory?.mediaBytes ?? 0,
    steps: STEP_ORDER,
  };
  return { body, hash: createHash('sha256').update(canonical(body)).digest('hex') };
}

// ---- Journal: intent -> acked per step page; unknown outcomes never replay ----
export function newJournal(planHash) { return { planHash, steps: {}, routed: false }; }

export function nextAction(journal) {
  for (const id of STEP_ORDER) {
    const s = journal.steps[id];
    if (!s) return { step: id, page: 0 };
    if (s.state === 'unknown') return { blocked: `Step ${id} page ${s.page} has an unknown outcome; reconcile before resuming` };
    if (s.state === 'intent') return { blocked: `Step ${id} page ${s.page} was sent without a recorded reply; reconcile before resuming` };
    if (s.state === 'paging') return { step: id, page: s.page + 1 };
    if (s.state !== 'done') return { blocked: `Step ${id} is in an invalid state` };
  }
  return { done: true };
}

export function recordIntent(j, step, page) {
  const cur = j.steps[step];
  if (cur && (cur.state === 'intent' || cur.state === 'unknown')) throw Error(`Refusing to resend ${step}: previous outcome unresolved`);
  return { ...j, steps: { ...j.steps, [step]: { state: 'intent', page } } };
}
export function recordReply(j, step, page, { ok, last, unknown, counts }) {
  const cur = j.steps[step];
  if (!cur || cur.state !== 'intent' || cur.page !== page) throw Error(`No matching intent for ${step} page ${page}`);
  const state = unknown ? 'unknown' : !ok ? 'failed' : last ? 'done' : 'paging';
  return { ...j, steps: { ...j.steps, [step]: { state, page, ...(counts ? { counts } : {}) } }, ...(step === ROUTE_STEP && state === 'done' ? { routed: true } : {}) };
}
/** Routing may only switch after every data step and verify are done. */
export function mayRoute(j) {
  return STEP_ORDER.filter(s => s !== ROUTE_STEP).every(s => j.steps[s]?.state === 'done');
}
