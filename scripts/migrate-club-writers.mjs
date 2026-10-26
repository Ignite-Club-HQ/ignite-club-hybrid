// Destination writers for the club migration tool.
//
// Each writer converts one step's Supabase rows into the destination canister's
// own snapshot format and loads it with the governor-only import_club_snapshot
// endpoint. Snapshot Candid shapes are generated from the canister sources
// (scripts/migrate-schemas/*.snapshot.did) so encodings cannot drift silently.
//
// Imports are idempotent replaces on the canister side, so re-sending a page
// whose reply was lost converges to the same state.
//
// Member-owned records (roles, guardians, RSVPs, messages, points) need each
// Supabase user's Internet Identity principal, which only exists after the
// member account claim ships. Until then writers load club-owned data only and
// leave member-owned arrays empty; the claim attaches people afterwards.

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

/** Candid type of a snapshot, read from the generated schema service's `schema` argument. */
export async function snapshotType(require, file) {
  const { idlFactory } = await import(file);
  const { IDL } = require('@dfinity/candid');
  const svc = idlFactory({ IDL });
  return svc._fields.find(([n]) => n === 'schema')[1].argTypes[0];
}

/**
 * Writers keyed by step id. `ctx` = { require, agent, target, clubId, rows(table), schemaFile(domain) }.
 * Each returns { records } after the canister acknowledged the import.
 */
export const WRITERS = {
  async club(ctx) {
    const { IDL } = ctx.require('@dfinity/candid');
    const { Actor } = ctx.require('@dfinity/agent');
    const canisterId = ctx.target.canisters.club_domain;
    if (!canisterId) throw Error('Destination club service missing');
    const [clubs, teams, sponsors] = await Promise.all([ctx.rows('clubs', 'id'), ctx.rows('teams', 'club_id'), ctx.rows('sponsors', 'club_id')]);
    const snap = buildClubSnapshot({ club: clubs[0], teams, sponsors });
    const type = await snapshotType(ctx.require, ctx.schemaFile('club_domain'));
    const blob = new Uint8Array(IDL.encode([type], [snap]));
    const Res = IDL.Variant({ Ok: IDL.Null, Err: IDL.Text });
    const actor = Actor.createActor(({ IDL }) => IDL.Service({
      freeze_club: IDL.Func([IDL.Text, IDL.Nat64], [IDL.Variant({ Ok: IDL.Nat64, Err: IDL.Text })], []),
      import_club_snapshot: IDL.Func([IDL.Text, IDL.Vec(IDL.Nat8)], [Res], []),
    }), { agent: ctx.agent, canisterId });
    const f = await actor.freeze_club(ctx.clubId, 1n);
    if ('Err' in f) throw Error(`Club lock refused: ${f.Err}`);
    const r = await actor.import_club_snapshot(ctx.clubId, blob);
    if ('Err' in r) throw Error(`Club import refused: ${r.Err}`);
    return { records: 1 + snap.teams.length + snap.sponsors.length };
  },
};
