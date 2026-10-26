// Destination writers for the club migration tool.
//
// Each writer converts one step's Supabase rows into the destination canister's
// own snapshot format and loads it with the governor-only import_club_snapshot
// endpoint. Snapshot Candid shapes are generated from the canister sources
// (scripts/migrate-schemas/*.snapshot.did) so encodings cannot drift silently.
//
// Imports replace club data; the runner never replays an unknown outcome.
//
// Member-owned records (roles, guardians, RSVPs, messages, points) need each
// Supabase user's Internet Identity principal, which only exists after the
// member account claim ships. Until then writers load club-owned data only and
// leave member-owned arrays empty; the claim attaches people afterwards.

import { buildPointsSnapshot, buildClaimedRsvps } from './migrate-club-members.mjs';
import { buildChatPages } from './migrate-club-messaging.mjs';
import { buildNotificationSnapshot } from './migrate-club-notifications.mjs';
import { buildMediaSnapshot } from './migrate-club-media.mjs';
import { buildVaultSnapshot } from './migrate-club-vault.mjs';
import { buildGameResults, buildEventExtras } from './migrate-club-event-results.mjs';
import { prepareFamilyCopy, productionPiiPublicKey } from './migrate-club-family.mjs';
import { planByteCopies, copyClubBytes, applyPhotoBlobRefs, applyVaultBlobRefs } from './migrate-club-bytes.mjs';
const ms = (iso) => (iso ? BigInt(Date.parse(iso)) : null);
const opt = (v) => (v === null || v === undefined || v === '' ? [] : [v]);
const optMs = (iso) => opt(ms(iso));

export function hslToHex(h, s, l) {
  if (h == null || s == null || l == null) return null;
  const a = (s / 100) * Math.min(l / 100, 1 - l / 100);
  const f = (n) => {
    const k = (n + h / 30) % 12;
    const c = l / 100 - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
    return Math.round(255 * c).toString(16).padStart(2, '0');
  };
  return `#${f(0)}${f(8)}${f(4)}`;
}

export function slugify(name, id) {
  const base = String(name ?? '').toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48);
  return base || `club-${String(id).slice(0, 8)}`;
}

const TIERS = new Set(['platinum', 'gold', 'silver', 'bronze']);
const clampPct = (n) => (n == null ? [] : [Math.max(0, Math.min(100, Math.round(Number(n))))]);

/** Supabase club + teams + sponsors -> club_domain ClubSnapshot (club-owned data only). */
export function buildClubSnapshot({ club, teams = [], sponsors = [] }) {
  if (!club?.id) throw Error('Club row missing');
  const id = club.id;
  const col = (p) => hslToHex(club[`${p}_h`], club[`${p}_s`], club[`${p}_l`]);
  const liveTeams = teams.filter((t) => t.club_id === id && !t.deleted_at);
  return {
    competition_recovery: [],
    profiles: [{
      id, name: club.name ?? 'Club', slug: slugify(club.name, id),
      created_at_ms: ms(club.created_at) ?? 0n, deleted_at_ms: optMs(club.deleted_at),
      description: opt(club.description), is_active: !club.deleted_at, logo_url: opt(club.logo_url),
      playhq_org_id: opt(club.playhq_org_id), playhq_tenant: opt(club.playhq_tenant),
      primary_color: opt(col('theme_primary')), secondary_color: opt(col('theme_secondary')), sport: opt(club.sport),
    }],
    settings: [{
      club_id: id, announcement: [], club_switcher_hint: [],
      chat_thread_ads_enabled: !!club.chat_thread_ads_enabled, contact_email: opt(club.contact_email),
      events_sponsor_strip_enabled: club.events_sponsor_strip_enabled !== false,
      header_club_name_enabled: club.show_name_in_header !== false, header_logo_enabled: club.show_logo_in_header !== false,
      invite_email_style: opt(club.invite_email_style), logo_only_mode: !!club.logo_only_mode,
      media_header_sponsors_enabled: !!club.media_header_sponsors_enabled, media_sponsors_enabled: club.media_sponsors_enabled !== false,
      membership_open: true, public_directory: !!club.listed_on_marketplace, theme_enabled: !!club.theme_enabled,
      theme_primary_color: opt(col('theme_primary')), theme_secondary_color: opt(col('theme_secondary')), theme_accent_color: opt(col('theme_accent')),
      theme_dark_primary_color: opt(col('theme_dark_primary')), theme_dark_secondary_color: opt(col('theme_dark_secondary')), theme_dark_accent_color: opt(col('theme_dark_accent')),
    }],
    teams: liveTeams.map((t) => ({
      id: t.id, club_id: id, name: t.name ?? 'Team', age_group: opt(t.level_age), archived: !!t.is_archived,
      deleted_at_ms: [], description: opt(t.description), division: [], folder_id: opt(t.folder_id), gender: [],
      is_active: !t.is_archived, is_shell: !!t.is_shell, logo_url: opt(t.logo_url),
      playhq_auto_create_events: !!t.playhq_auto_create_events, playhq_competition_id: opt(t.playhq_competition_id), playhq_team_id: opt(t.playhq_team_id),
      // Shell claims are re-issued after cutover; Supabase user ids are not principals.
      shell_claim_token: [], shell_claimed_at_ms: optMs(t.shell_claimed_at), shell_claimed_by: [],
      shell_contact_email: opt(t.shell_contact_email), shell_contact_name: opt(t.shell_contact_name), shell_invited_by: [],
      team_type: opt(t.team_type),
    })),
    sponsors: sponsors.filter((s) => s.club_id === id).map((s, i) => ({
      id: s.id, club_id: id, name: s.name ?? 'Sponsor', description: opt(s.description), website_url: opt(s.website_url),
      logo_url: opt(s.logo_url), is_active: s.is_active !== false, is_team_only: !!s.is_team_only,
      exposure_percentage: clampPct(s.exposure_percentage), sort_order: Math.max(0, s.display_order ?? i),
      tier: TIERS.has(s.tier) ? s.tier : 'bronze',
    })),
    listing: { links: [], revision: 0n },
    roles: [], acl_teams: liveTeams.map((t) => ({ id: t.id, club: id })), member: true,
    exclusions: [], children: [], guardians: [], account_roles: [], team_folders: [], news: [], news_audience: [],
    parent_invites: [], role_requests: [], team_invites: [], team_invite_links: [],
  };
}

const n16 = (v, d = 0) => Math.max(0, Math.min(65535, Math.round(Number(v ?? d)))) ;
const optN16 = (v) => (v == null ? [] : [n16(v)]);
const EVENT_TYPES = new Set(['game', 'training', 'social', 'mini_league']);
const HOUR = 3_600_000n;

/** Supabase events -> events_domain EventsSnapshot (details, RSVPs, game results and event extras: duties, captains, goalkeepers, player of the match, guests). */
export function buildEventsSnapshot({ clubId, events = [], creator, rsvps = [], claims, migratedChildren, gameResults = [], gameSummaries = [], gamePlayerStats = [], duties = [], captains = [], goalkeepers = [], playerOfMatch = [], guests = [] }) {
  const rows = events.filter((e) => e.club_id === clubId).map((e) => {
    const start = ms(e.start_time ?? e.event_date) ?? 0n;
    const end = ms(e.end_time);
    return {
      id: e.id, club_id: clubId, team_id: opt(e.team_id), title: e.title ?? 'Event', description: e.description ?? '',
      event_type: EVENT_TYPES.has(e.type) ? e.type : 'social', location: opt(e.location_name ?? e.location), address: opt(e.address),
      cancelled: !!e.is_cancelled, creator, starts_at_ms: start, ends_at_ms: end && end > start ? end : start + HOUR,
      series_id: [], revision: 1n, deleted: false, opponent: opt(e.opponent), mini_league_id: opt(e.mini_league_id),
      updated_at_ms: ms(e.updated_at) ?? start, rsvp_audience: opt(e.rsvp_audience), adults_only: !!e.adults_only,
      restricted_to_roles: e.restricted_to_roles?.length ? [e.restricted_to_roles] : [],
      target_team_ids: e.target_team_ids?.length ? [e.target_team_ids] : [],
    };
  });
  const game = buildGameResults({ eventIds: rows.map((e) => e.id), gameResults, gameSummaries, gamePlayerStats, claims, migratedChildren });
  // A team's duty assignment may live on the event row itself.
  const eventDutyTeams = events.filter((e) => e.club_id === clubId && e.duty_team_id).map((e) => ({ event_id: e.id, team_id: e.duty_team_id }));
  const extras = buildEventExtras({ eventIds: rows.map((e) => e.id), duties, eventDutyTeams, captains, goalkeepers, playerOfMatch, guests, claims, migratedChildren });
  return { events: rows, rsvps: buildClaimedRsvps({ events: rows, rsvps, claims, migratedChildren }), series: [], groups: [], group_players: [], group_duties: [], match_links: [], materializations: [],
    operations: [], player_details: [game.player_details], results: [game.results], stats: [game.stats], summaries: [game.summaries], stat_extras: [game.stat_extras],
    duties: [extras.duties], duty_teams: [extras.duty_teams], open_duties: [extras.open_duties], guests: [extras.guests],
    captains: [extras.captains], goalkeepers: [extras.goalkeepers], player_of_match: [extras.player_of_match] };
}

/** Supabase competitions organised by this club -> competition_domain FenceSnapshot. Hidden scores stay hidden. */
export function buildCompetitionSnapshot({ clubId, competitions = [], divisions = [], entries = [], matches = [] }) {
  const comps = competitions.filter((c) => c.organizer_club_id === clubId);
  const ids = new Set(comps.map((c) => c.id));
  const divs = divisions.filter((d) => ids.has(d.competition_id));
  const privacy = [
    ...comps.filter((c) => c.hide_scores).map((c) => ({ competition_id: c.id, division: [], hide_scores: true })),
    ...divs.filter((d) => d.hide_scores).map((d) => ({ competition_id: d.competition_id, division: [d.id], hide_scores: true })),
  ];
  return {
    competitions: comps.map((c) => ({ id: c.id, club_id: clubId, name: c.name ?? 'Competition', description: opt(c.description),
      season: c.season ?? '', status: c.status ?? 'draft', visibility: c.visibility ?? 'private',
      points_win: n16(c.points_win, 3), points_draw: n16(c.points_draw, 1), points_loss: n16(c.points_loss, 0), revision: 1n })),
    divisions: divs.map((d) => ({ competition_id: d.competition_id, division: d.id, hide_ladder: !!d.hide_ladder })),
    entries: entries.filter((e) => ids.has(e.competition_id)).map((e) => ({ competition_id: e.competition_id, team_id: e.team_id,
      club_id: clubId, division_id: opt(e.division_id), status: e.status ?? 'invited' })),
    matches: matches.filter((m) => ids.has(m.competition_id)).map((m) => ({ id: m.id, competition_id: m.competition_id,
      division_id: opt(m.division_id), home_team: m.home_team_id ?? m.home_team_name ?? 'TBC', away_team: m.away_team_id ?? m.away_team_name ?? 'TBC',
      home_score: n16(m.home_score), away_score: n16(m.away_score), status: m.status ?? 'scheduled', scheduled_at_ms: optMs(m.scheduled_at),
      venue: opt(m.venue), notes: opt(m.notes), pitch_number: opt(m.pitch_number), round_number: optN16(m.round_number),
      duration_minutes: optN16(m.duration_minutes), arrival_minutes_before: optN16(m.arrival_minutes_before), revision: 1n })),
    score_privacy: [privacy],
    ladders: comps.filter((c) => c.hide_ladder).map((c) => ({ competition_id: c.id, hide_ladder: true })),
    broadcasts: [], chat_settings: [], eoi: [], invites: [], join_links: [], member_welcome_jobs: [], official_chats: [], official_invites: [],
    owners: [], playhq_links: [], playhq_metadata: [], playhq_stats: [], recovery: [], role_links: [], roles: [], seasons: [], tokens: [],
    welcome: [], welcome_jobs: [],
  };
}

/** Supabase mini-leagues -> mini_league_domain LeagueSnapshot (structure only; players/availability wait for the claim). */
export function buildLeagueSnapshot({ clubId, leagues = [], sessions = [], groups = [], creator }) {
  const ls = leagues.filter((l) => l.club_id === clubId);
  const lid = new Set(ls.map((l) => l.id));
  const ss = sessions.filter((x) => lid.has(x.mini_league_id));
  const sid = new Set(ss.map((x) => x.id));
  const now = (r) => ms(r.created_at) ?? 0n;
  return {
    leagues: ls.map((l) => ({ id: l.id, club_id: clubId, name: l.name ?? 'Mini league', description: opt(l.description), logo_url: opt(l.logo_url),
      bib_colors: l.bib_colors ?? [], team_size: n16(l.team_size, 5), min_players_per_side: n16(l.min_players_per_side, 3),
      minutes_per_half: n16(l.minutes_per_half, 10), show_matches_to_members: l.show_matches_to_members !== false, status: 'active',
      created_by: creator, created_at_ms: now(l), updated_at_ms: ms(l.updated_at) ?? now(l) })),
    sessions: ss.map((x) => ({ id: x.id, mini_league_id: x.mini_league_id, session_date: x.session_date, start_time: String(x.start_time ?? '00:00').slice(0, 5),
      end_time: opt(x.end_time && String(x.end_time).slice(0, 5)), location_name: opt(x.location_name), address: opt(x.address), postcode: opt(x.postcode),
      status: x.status ?? 'scheduled', team_size_override: optN16(x.team_size_override), linked_event_id: opt(x.linked_event_id),
      created_by: creator, created_at_ms: now(x), updated_at_ms: ms(x.updated_at) ?? now(x) })),
    groups: groups.filter((g) => sid.has(g.session_id)).map((g) => ({ id: g.id, session_id: g.session_id, name: g.name ?? 'Group',
      ability_band: opt(g.ability_band), target_size: n16(g.target_size, 5), pitch_name: opt(g.pitch_name), display_order: n16(g.display_order),
      linked_event_id: opt(g.linked_event_id), created_at_ms: now(g), updated_at_ms: ms(g.updated_at) ?? now(g) })),
    roles: [], players: [], invites: [], admins: [], join_links: [], availability: [], group_players: [], duties: [], children: [], guardians: [],
  };
}

/** Candid type of a snapshot, read from the generated schema service's `schema` argument. */
export async function snapshotType(require, file) {
  const { idlFactory } = await import(file);
  const { IDL } = require('@icp-sdk/core/candid');
  const svc = idlFactory({ IDL });
  return svc._fields.find(([n]) => n === 'zz_migrate_schema')[1].argTypes[0];
}

/** Lock the club on one service, then load its snapshot (idempotent replace). */
async function loadSnapshot(ctx, domain, snap, lock) {
  const { IDL } = ctx.require('@icp-sdk/core/candid');
  const { Actor } = ctx.require('@icp-sdk/core/agent');
  const canisterId = ctx.target.canisters[domain];
  if (!canisterId) throw Error(`Destination ${domain} missing`);
  const type = await snapshotType(ctx.require, ctx.schemaFile(domain));
  const blob = new Uint8Array(IDL.encode([type], [snap]));
  const okRes = domain === 'club_domain' ? IDL.Variant({ Ok: IDL.Null, Err: IDL.Text }) : IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text });
  const actor = Actor.createActor(({ IDL }) => IDL.Service({
    freeze_club: IDL.Func([IDL.Text, IDL.Nat64], [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })], []),
    set_transfer_fence: IDL.Func([IDL.Text, IDL.Bool], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
    import_club_snapshot: IDL.Func([IDL.Text, IDL.Vec(IDL.Nat8)], [okRes], []),
  }), { agent: ctx.agent, canisterId });
  const f = lock === 'freeze' ? await actor.freeze_club(ctx.clubId, 1n) : await actor.set_transfer_fence(ctx.clubId, true);
  if ('Err' in f) throw Error(`${domain} lock refused: ${f.Err}`);
  const r = await actor.import_club_snapshot(ctx.clubId, blob);
  if ('Err' in r) throw Error(`${domain} import refused: ${r.Err}`);
}

/** Fence the club on messaging_domain, then load ChatPage pages in order (idempotent per message id). */
async function loadChatPages(ctx, pages) {
  const { IDL } = ctx.require('@icp-sdk/core/candid');
  const { Actor } = ctx.require('@icp-sdk/core/agent');
  const canisterId = ctx.target.canisters.messaging_domain;
  if (!canisterId) throw Error('Destination messaging_domain missing');
  const type = await snapshotType(ctx.require, ctx.schemaFile('messaging_domain'));
  const actor = Actor.createActor(({ IDL }) => IDL.Service({
    set_transfer_fence: IDL.Func([IDL.Text, IDL.Bool], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
    import_club_snapshot_page: IDL.Func([IDL.Text, IDL.Vec(IDL.Nat8)], [IDL.Variant({ Ok: IDL.Nat, Err: IDL.Text })], []),
  }), { agent: ctx.agent, canisterId });
  const f = await actor.set_transfer_fence(ctx.clubId, true);
  if ('Err' in f) throw Error(`messaging_domain lock refused: ${f.Err}`);
  for (const page of pages) {
    const blob = new Uint8Array(IDL.encode([type], [page]));
    const r = await actor.import_club_snapshot_page(ctx.clubId, blob);
    if ('Err' in r) throw Error(`messaging_domain import refused: ${r.Err}`);
  }
}

/**
 * Writers keyed by step id. `ctx` = { require, agent, target, clubId, creator, rows(table, col), rowsIn(table, col, ids), schemaFile(domain) }.
 * `creator` is the deploy identity's principal: Supabase authors have no ICP identity until they claim.
 * Each returns { records } after the canister acknowledged the import.
 */
export const WRITERS = {
  async club(ctx) {
    const [clubs, teams, sponsors] = await Promise.all([ctx.rows('clubs', 'id'), ctx.rows('teams', 'club_id'), ctx.rows('sponsors', 'club_id')]);
    const snap = buildClubSnapshot({ club: clubs[0], teams, sponsors });
    await loadSnapshot(ctx, 'club_domain', snap, 'freeze');
    return { records: 1 + snap.teams.length + snap.sponsors.length, counts: { club_domain: 1 + snap.teams.length + snap.sponsors.length } };
  },
  async events(ctx) {
    const events = await ctx.rows('events', 'club_id');
    const eventIds = events.map((e) => e.id);
    const [rsvps, gameResults, gameSummaries, gamePlayerStats, duties, captains, goalkeepers, playerOfMatch, guests] = await Promise.all([
      ctx.rowsIn('rsvps', 'event_id', eventIds), ctx.rowsIn('game_results', 'event_id', eventIds),
      ctx.rowsIn('game_summaries', 'event_id', eventIds), ctx.rowsIn('game_player_stats', 'event_id', eventIds),
      ctx.rowsIn('duties', 'event_id', eventIds), ctx.rowsIn('match_captains', 'event_id', eventIds),
      ctx.rowsIn('match_goalkeepers', 'event_id', eventIds), ctx.rowsIn('player_of_match', 'event_id', eventIds),
      ctx.rowsIn('event_guests', 'event_id', eventIds),
    ]);
    const snap = buildEventsSnapshot({ clubId: ctx.clubId, events, creator: ctx.creator, rsvps, claims: ctx.claims, migratedChildren: ctx.migratedChildren, gameResults, gameSummaries, gamePlayerStats, duties, captains, goalkeepers, playerOfMatch, guests });
    await loadSnapshot(ctx, 'events_domain', snap, 'fence');
    const n = snap.events.length + snap.rsvps.length + gameResults.length + gamePlayerStats.length + gameSummaries.length
      + snap.stat_extras[0].length + snap.duties[0].length + snap.duty_teams[0].length + snap.open_duties[0].length
      + captains.length + goalkeepers.length + playerOfMatch.length + guests.length;
    return { records: n, counts: { events_domain: n } };
  },
  async children(ctx) {
    const teams = (await ctx.rows('teams', 'club_id')).filter((t) => !t.deleted_at);
    const assignments = await ctx.rowsIn('child_team_assignments', 'team_id', teams.map((t) => t.id));
    const childIds = [...new Set(assignments.map((a) => a.child_id))];
    const [children, guardians, userRoles, exclusions] = await Promise.all([
      ctx.rowsIn('children', 'id', childIds), ctx.rowsIn('child_guardians', 'child_id', childIds),
      ctx.rows('user_roles', 'club_id'), ctx.rows('club_member_exclusions', 'club_id'),
    ]);
    // Account mirrors use the canister's own fallback convention (accountIdFor).
    const accounts = new Map([...ctx.claims.entries()].map(([u, p]) => [u, { principal: p.toText(), accountId: `principal:${p.toText()}` }]));
    const prepared = await prepareFamilyCopy({
      clubId: ctx.clubId, groupId: ctx.target.groupId, target: ctx.target,
      // The check gate confirmed this club is absent from every group; shared
      // children from another migrated club are refused canister-side by the
      // PII ciphertext-collision check.
      destination: { clubId: ctx.clubId, groupId: ctx.target.groupId, clubDomain: ctx.target.canisters.club_domain,
        piiDomain: ctx.target.canisters.pii_access_control, childIds: new Set(), piiIds: new Set() },
      claims: ctx.claims, accounts, teams, children, assignments, guardians, userRoles, exclusions,
      publicKey: await productionPiiPublicKey(ctx.target),
    });
    await loadSnapshot(ctx, 'pii_access_control', prepared.pii, 'fence');
    ctx.migratedChildren = new Set(childIds); // later steps verify child references against this
    // Re-import the club snapshot with the family arrays filled (idempotent replace).
    const [clubs, allTeams, sponsors] = await Promise.all([ctx.rows('clubs', 'id'), ctx.rows('teams', 'club_id'), ctx.rows('sponsors', 'club_id')]);
    const snap = buildClubSnapshot({ club: clubs[0], teams: allTeams, sponsors });
    Object.assign(snap, { roles: prepared.domain.roles, account_roles: prepared.domain.account_roles,
      exclusions: prepared.domain.exclusions, children: prepared.domain.children, guardians: prepared.domain.guardians });
    await loadSnapshot(ctx, 'club_domain', snap, 'freeze');
    const domainN = prepared.domain.roles.length + prepared.domain.account_roles.length + prepared.domain.exclusions.length + prepared.domain.children.length + prepared.domain.guardians.length;
    return { records: prepared.counts.children + prepared.counts.privateFields + prepared.counts.guardians + prepared.counts.roles,
      counts: { club_domain: domainN, pii_access_control: prepared.counts.privateFields } };
  },
  async rewards(ctx) {
    const tables = ['clubs', 'club_subscriptions', 'club_rewards', 'user_club_points', 'child_club_points', 'points_history', 'reward_redemptions', 'points_cooldowns'];
    const [clubs, subscriptions, rewards, users, children, history, redemptions, cooldowns] = await Promise.all(tables.map(t => ctx.rows(t, t === 'clubs' ? 'id' : 'club_id')));
    const snap = buildPointsSnapshot({ clubId: ctx.clubId, claims: ctx.claims, migratedChildren: ctx.migratedChildren,
      mediaReferences: ctx.mediaReferences, club: clubs[0], subscriptions, rewards, users, children, history, redemptions, cooldowns });
    await loadSnapshot(ctx, 'club_points_domain', snap, 'fence');
    const n = snap.users.length + snap.children.length + snap.history.length + snap.rewards.length + snap.redemptions.length + snap.cooldowns.length + snap.settings.length;
    return { records: n, counts: { club_points_domain: n } };
  },
  async competitions(ctx) {
    const competitions = await ctx.rows('competitions', 'organizer_club_id');
    const ids = competitions.map((c) => c.id);
    const [divisions, entries, matches] = await Promise.all(['competition_divisions', 'competition_entries', 'competition_matches'].map((t) => ctx.rowsIn(t, 'competition_id', ids)));
    const snap = buildCompetitionSnapshot({ clubId: ctx.clubId, competitions, divisions, entries, matches });
    await loadSnapshot(ctx, 'competition_domain', snap, 'fence');
    const n = snap.competitions.length + snap.matches.length + snap.entries.length + snap.divisions.length;
    return { records: n, counts: { competition_domain: n } };
  },
  async mini_leagues(ctx) {
    const leagues = await ctx.rows('mini_leagues', 'club_id');
    const sessions = await ctx.rowsIn('mini_league_sessions', 'mini_league_id', leagues.map((l) => l.id));
    const groups = await ctx.rowsIn('mini_league_groups', 'session_id', sessions.map((x) => x.id));
    const snap = buildLeagueSnapshot({ clubId: ctx.clubId, leagues, sessions, groups, creator: ctx.creator });
    await loadSnapshot(ctx, 'mini_league_domain', snap, 'fence');
    const n = snap.leagues.length + snap.sessions.length + snap.groups.length;
    return { records: n, counts: { mini_league_domain: n } };
  },
  async messaging(ctx) {
    const [teams, clubMessages, chatGroups, clubAdminConversations] = await Promise.all([
      ctx.rows('teams', 'club_id'), ctx.rows('club_messages', 'club_id'),
      ctx.rows('chat_groups', 'club_id'), ctx.rows('club_admin_conversations', 'club_id'),
    ]);
    const teamIds = teams.map((t) => t.id);
    // Polls can live in any conversation of the club: team chats (chat_id =
    // team id), the club chat (chat_id = club id), groups and admin rooms.
    const pollScopes = [...teamIds, ctx.clubId, ...chatGroups.map((g) => g.id), ...clubAdminConversations.map((c) => c.id)];
    const [teamMessages, polls, groupMessages, clubAdminMessages] = await Promise.all([
      ctx.rowsIn('team_messages', 'team_id', teamIds), ctx.rowsIn('polls', 'chat_id', pollScopes),
      ctx.rowsIn('group_messages', 'group_id', chatGroups.map((g) => g.id)),
      ctx.rowsIn('club_admin_messages', 'conversation_id', clubAdminConversations.map((c) => c.id)),
    ]);
    const pollVotes = await ctx.rowsIn('poll_votes', 'poll_id', polls.map((p) => p.id));
    const pages = buildChatPages({ clubId: ctx.clubId, teams: teams.filter((t) => !t.deleted_at), teamMessages, clubMessages,
      chatGroups, groupMessages, clubAdminConversations, clubAdminMessages, polls, pollVotes, claims: ctx.claims, creator: ctx.creator });
    await loadChatPages(ctx, pages);
    const n = pages.reduce((s, p) => s + p.conversations.length + p.messages.length + (p.polls?.[0]?.length ?? 0) + (p.poll_votes?.[0]?.length ?? 0), 0);
    return { records: n, counts: { messaging_domain: n } };
  },
  async notifications(ctx) {
    const [notifications, scheduledMessages] = await Promise.all([ctx.rows('notifications', 'club_id'), ctx.rows('scheduled_messages', 'club_id')]);
    const snap = buildNotificationSnapshot({ clubId: ctx.clubId, notifications, scheduledMessages, claims: ctx.claims });
    await loadSnapshot(ctx, 'notification_queue', snap, 'fence');
    const n = snap.items.length + snap.scheduled.length;
    return { records: n, counts: { notification_queue: n } };
  },
  async media(ctx) {
    const [photos, albums] = await Promise.all([ctx.rows('photos', 'club_id'), ctx.rows('photo_albums', 'club_id')]);
    const snap = buildMediaSnapshot({ clubId: ctx.clubId, photos, albums, claims: ctx.claims });
    await loadSnapshot(ctx, 'media_metadata', snap, 'fence');
    const n = snap.assets.length + snap.albums[0].length;
    return { records: n, counts: { media_metadata: n } };
  },
  async vault(ctx) {
    const [folders, files] = await Promise.all([ctx.rows('team_folders', 'club_id'), ctx.rows('vault_files', 'club_id')]);
    const snap = buildVaultSnapshot({ clubId: ctx.clubId, folders, files, claims: ctx.claims, creator: ctx.creator });
    await loadSnapshot(ctx, 'vault_domain', snap, 'fence');
    const n = snap.folders.length + snap.files.length;
    return { records: n, counts: { vault_domain: n } };
  },
  async media_bytes(ctx) {
    const [photos, vaultFiles] = await Promise.all([ctx.rows('photos', 'club_id'), ctx.rows('vault_files', 'club_id')]);
    const items = planByteCopies({ clubId: ctx.clubId, photos, vaultFiles, claims: ctx.claims, creator: ctx.creator });
    if (!items.length) return { records: 0 };
    const publicKey = await productionPiiPublicKey(ctx.target);
    const refs = await copyClubBytes(ctx.target, publicKey, items, {
      download: ctx.download, blobStore: ctx.blobStoreActor(), pii: ctx.piiActor(), journal: ctx.byteJournal,
    });
    // Patch the blob_ref pointers into both metadata snapshots and re-import
    // (idempotent replace; the clubs stay fenced throughout).
    const mediaSnap = buildMediaSnapshot({ clubId: ctx.clubId, photos, albums: await ctx.rows('photo_albums', 'club_id'), claims: ctx.claims });
    applyPhotoBlobRefs(mediaSnap, refs.photos);
    await loadSnapshot(ctx, 'media_metadata', mediaSnap, 'fence');
    const vaultSnap = buildVaultSnapshot({ clubId: ctx.clubId, folders: await ctx.rows('team_folders', 'club_id'), files: vaultFiles, claims: ctx.claims, creator: ctx.creator });
    applyVaultBlobRefs(vaultSnap, refs.vault);
    await loadSnapshot(ctx, 'vault_domain', vaultSnap, 'fence');
    return { records: items.length };
  },
};
