// Offline preparation only. No source reads, canister calls, claims or imports.
// Family records are shared across clubs: never merge a guessed destination row.
import { createRequire } from 'node:module';
import { claimedPrincipal, timestamp } from './migrate-club-members.mjs';
const require = createRequire(new URL('../frontend/package.json', import.meta.url));
const encoder = new TextEncoder();
const opt = value => value == null ? [] : [value];
const ROLE_NAMES = new Set(['club_admin', 'team_admin', 'coach', 'player', 'parent', 'committee_member']);
const TEAM_ROLES = new Set(['team_admin', 'coach', 'player']);
const id = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(value)) throw Error('Invalid source identifier');
  return value;
};
function unique(rows, key) {
  const keys = rows.map(key);
  if (new Set(keys).size !== keys.length) throw Error('Duplicate family source record refused');
}
function bound(input) {
  const { clubId, groupId, target, destination } = input;
  id(clubId);
  if (!/^g\d+$/.test(groupId) || target?.groupId !== groupId || !target.canisters?.club_domain || !target.canisters?.pii_access_control ||
      destination?.clubId !== clubId || destination?.groupId !== groupId ||
      destination.clubDomain !== target.canisters.club_domain || destination.piiDomain !== target.canisters.pii_access_control ||
      !(destination.childIds instanceof Set) || !(destination.piiIds instanceof Set)) throw Error('Missing exact-destination family inventory');
}
function accountId(input, user) {
  const principal = claimedPrincipal(input.claims, user);
  const row = input.accounts?.get(user);
  // Account claims bind principals, not identity account IDs. Never invent the mirror.
  if (!row || row.principal !== principal.toText() || typeof row.accountId !== 'string' || !row.accountId) throw Error('Missing verified destination identity account');
  return row.accountId;
}

/** Preserve only explicit club/team grants. Claiming alone never creates roles. */
export function buildFamilyMemberships(input) {
  bound(input);
  const { clubId, teams = [], userRoles = [], exclusions = [], teamExclusions = [], memberships = [] } = input;
  if (memberships.length) throw Error('Missing season-membership destination contract');
  if (teamExclusions.length) throw Error('Missing team-exclusion destination contract');
  unique(teams, t => id(t.id));
  if (teams.some(t => t.club_id !== clubId || t.deleted_at)) throw Error('Foreign or deleted family team refused');
  const teamIds = new Set(teams.map(t => t.id));
  unique(userRoles, r => id(r.id));
  const roles = userRoles.map(r => {
    if (r.club_id !== clubId || (r.team_id && !teamIds.has(r.team_id))) throw Error('Foreign membership scope refused');
    if (!ROLE_NAMES.has(r.role) || (TEAM_ROLES.has(r.role) && !r.team_id) || r.via_captain) throw Error('Unsupported membership authority refused');
    return { user: claimedPrincipal(input.claims, r.user_id), club: [clubId], team: opt(r.team_id), role: r.role };
  });
  unique(roles, r => `${r.user.toText()}\u001f${r.role}\u001f${r.team[0] ?? ''}`);
  const account_roles = userRoles.map((r, i) => ({ account_id: accountId(input, r.user_id), club: [clubId], team: roles[i].team, role: r.role }));
  // Two source users cannot alias the same destination roster subject.
  const subjects = new Map();
  for (const r of userRoles) {
    const account = accountId(input, r.user_id), principal = claimedPrincipal(input.claims, r.user_id).toText();
    for (const key of [`a:${account}`, `p:${principal}`]) {
      if (subjects.has(key) && subjects.get(key) !== r.user_id) throw Error('Ambiguous destination membership identity');
      subjects.set(key, r.user_id);
    }
  }
  unique(exclusions, r => r.user_id);
  const mappedExclusions = exclusions.map(r => {
    if (r.club_id !== clubId) throw Error('Foreign membership exclusion refused');
    return { club: clubId, user: claimedPrincipal(input.claims, r.user_id) };
  });
  return { roles, account_roles, exclusions: mappedExclusions };
}

/** The destination group's production PII public key (key_1, immutable context). */
export async function productionPiiPublicKey(target) {
  const { Principal } = require('@icp-sdk/core/principal');
  const { MasterPublicKey } = await import(new URL('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js', import.meta.url).href);
  return MasterPublicKey.productionKey('key_1')
    .deriveCanisterKey(Principal.fromText(target.canisters.pii_access_control).toUint8Array())
    .deriveSubKey(encoder.encode('ignite-pii-v1')).publicKeyBytes();
}

/** Encrypt using the same immutable production identity/context as the app. */
export async function encryptFamilyField(target, publicKey, childId, field, text) {
  const { DerivedPublicKey, IbeCiphertext, IbeIdentity, IbeSeed } = await import(new URL('../frontend/node_modules/@icp-sdk/vetkeys/dist/lib/index.es.js', import.meta.url).href);
  const expected = await productionPiiPublicKey(target);
  if (!(publicKey instanceof Uint8Array) || publicKey.length !== expected.length || publicKey.some((b, i) => b !== expected[i])) throw Error('Destination PII public key mismatch');
  return IbeCiphertext.encrypt(DerivedPublicKey.deserialize(publicKey),
    IbeIdentity.fromBytes(encoder.encode(`${childId}\u001f${field}`)), encoder.encode(text), IbeSeed.random()).serialize();
}

/**
 * Prepare complete fixture/input bundles without exposing child fields in domain rows.
 * Destination inventory and account evidence are INPUTS, not certified by this helper.
 * No writer is registered: collision reads, metadata import and durable receipts are
 * required before a production loader can consume this output.
 */
export async function prepareFamilyCopy(input) {
  bound(input);
  const { clubId, teams = [], children = [], assignments = [], guardians = [] } = input;
  const membership = buildFamilyMemberships(input);
  unique(children, c => id(c.id)); unique(assignments, a => id(a.id)); unique(guardians, g => id(g.id));
  unique(assignments, a => `${a.child_id}\u001f${a.team_id}`);
  unique(guardians, g => `${g.child_id}\u001f${g.guardian_id}`);
  const teamIds = new Set(teams.map(t => t.id)), childIds = new Set(children.map(c => c.id));
  if (assignments.some(a => !teamIds.has(a.team_id) || !childIds.has(a.child_id))) throw Error('Foreign or missing child assignment refused');
  if (guardians.some(g => !childIds.has(g.child_id))) throw Error('Dangling child guardian refused');
  for (const c of children) {
    if (!assignments.some(a => a.child_id === c.id)) throw Error('Missing authoritative child club assignment');
    if (input.destination.childIds.has(c.id) || input.destination.piiIds.has(c.id)) throw Error('Existing destination family identity refused');
    if (c.ignite_points != null && c.ignite_points !== 0) throw Error('Missing global child points destination contract');
    if (typeof c.name !== 'string' || !c.name.trim()) throw Error('Invalid private child name');
    if (c.year_of_birth != null && (!Number.isInteger(c.year_of_birth) || c.year_of_birth < 1900 || c.year_of_birth > 9999)) throw Error('Invalid private birth year');
    timestamp(c.created_at);
  }
  // Validate ALL relationships and principals before any encryption work.
  const mappedGuardians = guardians.map(g => {
    if (g.relationship_type != null && typeof g.relationship_type !== 'string') throw Error('Invalid guardian relationship');
    if (g.is_primary != null && typeof g.is_primary !== 'boolean') throw Error('Invalid primary guardian');
    return { child: g.child_id, user: claimedPrincipal(input.claims, g.guardian_id) };
  });
  const mappedChildren = children.map(c => {
    const parent = c.parent_id ? claimedPrincipal(input.claims, c.parent_id) : null;
    if (!parent) throw Error('Missing explicit child owner');
    accountId(input, c.parent_id);
    return { id: c.id, club_id: [clubId], parent: [parent], teams: assignments.filter(a => a.child_id === c.id).map(a => a.team_id) };
  });
  const records = [], grants = [];
  for (let i = 0; i < children.length; i++) {
    const c = children[i], owner = mappedChildren[i].parent[0];
    const readers = [...new Map(mappedGuardians.filter(g => g.child === c.id).map(g => [g.user.toText(), g.user])).values()];
    const fields = [['name', c.name], ...(c.year_of_birth == null ? [] : [['year_of_birth', String(c.year_of_birth)]])];
    for (const [field, value] of fields) {
      const ciphertext = await encryptFamilyField(input.target, input.publicKey, c.id, field, value);
      records.push({ pii_id: c.id, field_id: field, ciphertext, nonce: [], master_key_id: 'vetkey-ibe-v1',
        created_at: timestamp(c.created_at) * 1_000_000n, last_accessed: 0n, access_count: 0n, domain_owner: owner, readers });
      grants.push({ pii_id: c.id, field_id: field, club_id: clubId });
    }
  }
  const byGuardian = new Map();
  for (const g of mappedGuardians) {
    const key = g.user.toText(), previous = byGuardian.get(key) ?? { guardian: g.user, children: [] };
    previous.children.push(g.child); byGuardian.set(key, previous);
  }
  // Relationship labels/primary flags ride the display-only guardian-label
  // sidecar (never gates access); first label per guardian wins.
  const labelsByGuardian = new Map();
  for (let i = 0; i < mappedGuardians.length; i++) {
    const src = guardians[i], key = mappedGuardians[i].user.toText();
    if (labelsByGuardian.has(key)) continue;
    if (src.relationship_type == null && src.is_primary == null) continue;
    labelsByGuardian.set(key, { guardian: mappedGuardians[i].user, rel_label: opt(src.relationship_type), is_primary: opt(src.is_primary) });
  }
  return {
    domain: { ...membership, children: mappedChildren, guardians: mappedGuardians },
    pii: { records, grants, guardians: [...byGuardian.values()], guardian_labels: [[...labelsByGuardian.values()]] },
    counts: { children: children.length, guardians: guardians.length, privateFields: records.length, roles: membership.roles.length },
  };
}