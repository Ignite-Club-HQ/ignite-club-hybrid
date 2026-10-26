// Pure planning/journal rules for moving ONE whole club from Supabase into a
// chosen canister group. No network access here — migrate-club.mjs supplies
// readings. The Supabase copy is never written by any step.
import { createHash } from 'node:crypto';

export const CONFIRM_MIGRATE = 'MIGRATE CLUB TO CANISTERS';
export const CONFIRM_RECOVER = 'RECOVER CLUB MIGRATION';
export const FILL_LIMIT = 0.8; // capacity-fill-first: new clubs switch away at 80%

/**
 * Source tables per destination step. scope: how rows belong to the club.
 *  club  -> column club_id = club
 *  team  -> team_id in the club's teams
 *  event -> event_id in the club's events
 * media: rows that carry Storage objects to copy (encrypted on the way in).
 * Retired drills/pitch tables are intentionally absent.
 */
export const STEPS = Object.freeze([
  { id: 'club', domain: 'club_domain', tables: [
    ['clubs', 'id'], ['teams', 'club'], ['user_roles', 'club'], ['team_memberships', 'team'], ['team_captains', 'team'],
    ['team_player_positions', 'team'], ['team_folders', 'club'], ['sponsors', 'club'], ['seasons', 'club'],
    ['club_news', 'club'], ['pending_invites', 'club'], ['role_requests', 'club'], ['team_invites', 'team'],
    ['club_member_exclusions', 'club'], ['team_member_exclusions', 'team']] },
  { id: 'children', domain: 'pii_access_control', tables: [['child_team_assignments', 'team']] },
  { id: 'events', domain: 'events_domain', tables: [
    ['events', 'club'], ['rsvps', 'event'], ['duties', 'event'], ['match_captains', 'event'], ['match_goalkeepers', 'event'],
    ['player_of_match', 'event'], ['event_guests', 'event'], ['event_groups', 'event'], ['game_results', 'event'],
    ['game_player_stats', 'event'], ['event_payments', 'event']] },
  { id: 'messaging', domain: 'messaging_domain', tables: [
    ['team_messages', 'team'], ['club_messages', 'club'], ['chat_groups', 'club'], ['polls', 'club'],
    ['scheduled_messages', 'club'], ['club_admin_conversations', 'club']] },
  { id: 'rewards', domain: 'club_points_domain', tables: [['club_rewards', 'club'], ['user_club_points', 'club'], ['points_history', 'club'], ['reward_redemptions', 'club']] },
  { id: 'competitions', domain: 'competition_domain', tables: [['competitions', 'club']] },
  { id: 'mini_leagues', domain: 'mini_league_domain', tables: [['mini_leagues', 'club']] },
  { id: 'notifications', domain: 'notification_queue', tables: [['notifications', 'club']] },
  { id: 'media', domain: 'media_metadata', media: true, tables: [['photos', 'club'], ['photo_albums', 'club']] },
  { id: 'vault', domain: 'vault_domain', media: true, tables: [['vault_files', 'club']] },
]);

export const VERIFY_STEP = 'verify';
export const ROUTE_STEP = 'route';
export const STEP_ORDER = Object.freeze([...STEPS.map(s => s.id), VERIFY_STEP, ROUTE_STEP]);

const UUIDish = /^[0-9a-zA-Z][0-9a-zA-Z_-]{0,127}$/;
export const normalizeConfirmation = v => String(v ?? '').replace(/[\u200b-\u200d\u2060\ufeff"'`\u2018\u2019\u201c\u201d]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
export const normalizePlan = v => String(v ?? '').replace(/[^0-9a-fA-F]/g, '').toLowerCase();

export function validateRequest({ action, clubId, groupId, plan, confirmation }) {
  if (!['check', 'migrate', 'recover'].includes(action)) throw Error('Action must be check, migrate or recover');
  if (!UUIDish.test(String(clubId ?? ''))) throw Error('Club ID is missing or invalid');
  if (!/^g\d+$/.test(String(groupId ?? ''))) throw Error('Target group must look like g1, g2, ...');
  if (action === 'check') return;
  if (normalizePlan(plan).length !== 64) throw Error('Paste the 64-character plan hash from the check run');
  const want = action === 'migrate' ? CONFIRM_MIGRATE : CONFIRM_RECOVER;
  if (normalizeConfirmation(confirmation) !== want) throw Error(`Type ${want}`);
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
export function recordReply(j, step, page, { ok, last, unknown }) {
  const cur = j.steps[step];
  if (!cur || cur.state !== 'intent' || cur.page !== page) throw Error(`No matching intent for ${step} page ${page}`);
  const state = unknown ? 'unknown' : !ok ? 'failed' : last ? 'done' : 'paging';
  return { ...j, steps: { ...j.steps, [step]: { state, page } }, ...(step === ROUTE_STEP && state === 'done' ? { routed: true } : {}) };
}
/** Routing may only switch after every data step and verify are done. */
export function mayRoute(j) {
  return STEP_ORDER.filter(s => s !== ROUTE_STEP).every(s => j.steps[s]?.state === 'done');
}
