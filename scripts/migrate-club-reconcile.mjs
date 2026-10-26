// Final reconciliation: after every data step is done, read each destination
// canister's own export back and prove the record counts match what the
// writers acknowledged. A mismatch stops the run; routing stays blocked
// regardless (separate auth approval).

import { snapshotType } from './migrate-club-writers.mjs';

/** Records per domain, counted from a decoded snapshot. */
export function countSnapshot(domain, snap) {
  // Candid `opt vec T` decodes as [] or [T[]]; plain `vec T` decodes as T[].
  const len = (v) => {
    if (!Array.isArray(v)) return 0;
    if (v.length === 1 && Array.isArray(v[0])) return v[0].length;
    return v.length;
  };
  switch (domain) {
    case 'club_domain':
      return 1 + (snap.teams?.length ?? 0) + (snap.sponsors?.length ?? 0)
        + (snap.children?.length ?? 0) + (snap.guardians?.length ?? 0)
        + (snap.roles?.length ?? 0) + (snap.account_roles?.length ?? 0) + (snap.exclusions?.length ?? 0);
    case 'pii_access_control':
      return (snap.records?.length ?? snap.fields?.length ?? 0);
    case 'events_domain': {
      // Decoded field names follow the snapshot contract (results/summaries/
      // stats); accept the table-style names too for older journals.
      const pick = (...keys) => keys.reduce((n, k) => n + len(snap[k]), 0);
      return pick('events', 'rsvps') + pick('results', 'game_results') + pick('summaries', 'game_summaries') + pick('stats', 'game_player_stats')
        + pick('stat_extras') + pick('duties', 'duty_teams', 'open_duties', 'guests', 'captains', 'goalkeepers', 'player_of_match');
    }
    case 'competition_domain':
      return (snap.competitions?.length ?? 0) + (snap.matches?.length ?? 0) + (snap.entries?.length ?? 0) + (snap.divisions?.length ?? 0);
    case 'mini_league_domain':
      return (snap.leagues?.length ?? 0) + (snap.sessions?.length ?? 0) + (snap.groups?.length ?? 0);
    case 'messaging_domain':
      return len(snap.conversations) + len(snap.messages) + len(snap.polls) + len(snap.poll_votes);
    case 'club_points_domain':
      return (snap.users?.length ?? 0) + (snap.children?.length ?? 0) + (snap.history?.length ?? 0)
        + (snap.rewards?.length ?? 0) + (snap.redemptions?.length ?? 0) + (snap.cooldowns?.length ?? 0) + (snap.settings?.length ?? 0);
    case 'notification_queue':
      return (snap.items?.length ?? 0) + (snap.scheduled?.length ?? 0);
    case 'media_metadata':
      return len(snap.assets) + len(snap.albums);
    case 'vault_domain':
      return (snap.folders?.length ?? 0) + (snap.files?.length ?? 0);
    default:
      throw Error(`No counter for ${domain}`);
  }
}

/** Sum the per-domain counts recorded in the journal by each writer. */
export function expectedCounts(journal) {
  const out = {};
  for (const [step, s] of Object.entries(journal.steps ?? {})) {
    if (s?.state !== 'done' || !s.counts) continue;
    for (const [domain, n] of Object.entries(s.counts)) out[domain] = (out[domain] ?? 0) + n;
  }
  return out;
}

/** Decode one exported snapshot blob with the generated schema. */
export async function decodeSnapshot(require, schemaFile, blob) {
  const { IDL } = require('@icp-sdk/core/candid');
  const type = await snapshotType(require, schemaFile);
  const [snap] = IDL.decode([type], Buffer.from(blob));
  return snap;
}

/**
 * Read every domain back, count and compare against the journal.
 * `deps`: { readSnapshot(domain) -> decoded snapshot object } — the caller
 * handles export paging (messaging) and decoding. Returns a per-domain
 * report; throws on the first mismatch.
 */
export async function reconcileClub(ctx, journal, deps) {
  const expected = expectedCounts(journal);
  const report = [];
  for (const [domain, want] of Object.entries(expected)) {
    const snap = await deps.readSnapshot(domain);
    const got = countSnapshot(domain, snap);
    report.push({ domain, expected: want, actual: got, ok: got === want });
    if (got !== want) throw Error(`Reconciliation failed for ${domain}: destination has ${got}, writers acknowledged ${want}`);
  }
  // media_bytes: every photo/Vault record must point at on-chain bytes.
  if (journal.steps?.media_bytes?.state === 'done') {
    for (const domain of ['media_metadata', 'vault_domain']) {
      const snap = await deps.readSnapshot(domain);
      const rows = domain === 'media_metadata' ? snap.assets ?? [] : snap.files ?? [];
      const missing = rows.filter((r) => !(r.blob_ref?.length)).length;
      report.push({ domain: `${domain} blob_refs`, expected: rows.length, actual: rows.length - missing, ok: missing === 0 });
      if (missing) throw Error(`${missing} ${domain} records still lack on-chain bytes`);
    }
  }
  return report;
}
