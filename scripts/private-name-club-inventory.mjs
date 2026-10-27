// Bounded consensus inventory adapter. Never infers membership from public
// directories or role labels. Global atomicity requires an independently
// authenticated, continuously held external fence; this module cannot grant it.
import { createHash } from 'node:crypto';
import { canonical } from './migrate-club-plan.mjs';
import { preparePrivateNameArtifact } from './private-name-plan-artifact.mjs';

const text = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f/]/.test(value);
const nat = value => {
  if ((typeof value !== 'bigint' && typeof value !== 'string') || !/^(0|[1-9][0-9]*)$/.test(String(value))) throw Error('Exact source revision/cursor required');
  return BigInt(value);
};
const cursorValue = cursor => {
  if (!cursor || Object.keys(cursor).sort().join(',') !== 'nested,offset,phase,revision') throw Error('Invalid membership source cursor');
  return { revision: nat(cursor.revision), phase: nat(cursor.phase), offset: nat(cursor.offset), nested: nat(cursor.nested) };
};
const unwrap = (reply, label) => {
  if (!reply || !Object.hasOwn(reply, 'Ok') || Object.hasOwn(reply, 'Err')) throw Error(`${label} refused`);
  return reply.Ok;
};

/** Only committed generated bindings and a caller-supplied signed agent.
 * Never fetches a mainnet root key, logs credentials, or uses query fallbacks. */
export async function createClubInventoryActors(agent, sources) {
  const { createRequire } = await import('node:module');
  const require = createRequire(new URL('../frontend/package.json', import.meta.url));
  const { Actor } = require('@icp-sdk/core/agent');
  const { Principal } = require('@icp-sdk/core/principal');
  const { idlFactory } = await import('../frontend/src/lab/bindings/club_domain/declarations/club_domain.did.js');
  return new Map(sources.map(source => {
    const actor = Actor.createActor(idlFactory, { agent, canisterId: source.canisterId });
    return [source.canisterId, {
      read_membership_source_page: cursor => actor.read_membership_source_page(cursor),
      read_membership_discovery_status: () => actor.read_membership_discovery_status(),
      read_has_club_membership: (subject, club) => actor.read_has_club_membership(Principal.fromText(subject), club),
    }];
  }));
}

export async function collectPrivateNameClubInventory({ accounts, sources, identityId, operator, deploymentHash, historyRevision, maxCalls = 20000, maxClubs = 10000 }, { actors, assertFence }) {
  if (!Array.isArray(accounts) || accounts.length > 100000 || !Array.isArray(sources) || sources.length === 0 || sources.length > 100 || !text(identityId) || !text(operator) || !/^[a-f0-9]{64}$/.test(deploymentHash) || !Number.isSafeInteger(maxCalls) || maxCalls < 1 || maxCalls > 1000000 || !Number.isSafeInteger(maxClubs) || maxClubs < 1 || maxClubs > 10000 || typeof assertFence !== 'function') throw Error('Complete fenced inventory dependencies required');
  nat(historyRevision);
  accounts = structuredClone(accounts);
  sources = structuredClone(sources);
  actors = new Map(actors);
  const ids = new Set(), subjects = new Set(), accountIds = new Set();
  for (const source of sources) {
    if (!source || Object.keys(source).sort().join(',') !== 'canisterId,group' || !text(source.canisterId) || !/^g[0-9]+$/.test(source.group) || ids.has(source.canisterId) || !actors.has(source.canisterId)) throw Error('Distinct complete source actors required');
    ids.add(source.canisterId);
  }
  if (new Set(sources.map(s => s.group)).size !== sources.length) throw Error('Duplicate group source');
  for (const account of accounts) {
    if (!account || !text(account.accountId) || !text(account.subject) || accountIds.has(account.accountId) || subjects.has(account.subject)) throw Error('Unambiguous distinct account subjects required');
    subjects.add(account.subject); accountIds.add(account.accountId);
  }
  const allAliases=new Set();
  const accountEvidence=accounts.map(account=>{
    if(account.principals===undefined)return {accountId:account.accountId,subject:account.subject}; // legacy local fixtures, not complete account evidence
    if(!Array.isArray(account.principals) || !account.principals.length || account.principals.length>8 || !account.principals.includes(account.subject) || !account.principals.every(text) || new Set(account.principals).size!==account.principals.length || !['Active','Suspended'].includes(account.status) || nat(account.version)>18446744073709551615n || typeof account.profilePresent!=='boolean' || !Array.isArray(account.sourceDigest) || account.sourceDigest.length!==32 || !account.sourceDigest.every(b=>Number.isInteger(b)&&b>=0&&b<=255) || !(text(account.sink) || (account.sink === null && account.nameAbsent === true)))throw Error('Complete account alias/status/version/authority evidence required');
    return {accountId:account.accountId,subject:account.subject,principals:[...account.principals].sort(),status:account.status,version:String(account.version),profilePresent:account.profilePresent,sourceDigest:[...account.sourceDigest],sink:account.sink};
  });
  for(const account of accounts)for(const alias of account.principals??[account.subject]){if(allAliases.has(alias))throw Error('Ambiguous account aliases');allAliases.add(alias);}
  const context = structuredClone({ identityId, operator, deploymentHash, historyRevision: String(historyRevision), sources, accounts: accountEvidence });
  let calls = 0;
  // assertFence must authenticate complete registered-plus-original-G1 source
  // coverage, account aliases/eligibility, management lifecycle, topology and
  // uninterrupted external writer exclusion. A boolean fixture is not proof.
  const fenced = async fn => {
    if (++calls > maxCalls) throw Error('Inventory consensus call budget exceeded');
    if (await assertFence(structuredClone(context)) !== true) throw Error('Authenticated complete external fence required');
    const result = await fn();
    if (await assertFence(structuredClone(context)) !== true) throw Error('External inventory fence changed');
    return result;
  };
  const memberships = new Map(accounts.map(a => [a.accountId, []]));
  const ownership = new Map(), sourceReceipts = [];
  for (const source of [...sources].sort((a,b) => a.group.localeCompare(b.group))) {
    const actor = actors.get(source.canisterId);
    let cursor = [], revision, scanned = 0;
    const clubs = new Map();
    for (;;) {
      const page = unwrap(await fenced(() => actor.read_membership_source_page(cursor)), 'Governor membership source');
      const current = nat(page.revision);
      if (revision !== undefined && current !== revision) throw Error('Membership source revision changed');
      revision = current;
      const count = nat(page.scanned);
      if (count > 100n || !Array.isArray(page.edges) || page.edges.length > Number(count) || !Array.isArray(page.next) || page.next.length > 1) throw Error('Invalid bounded source page');
      scanned += Number(count);
      if (!Number.isSafeInteger(scanned) || scanned > 1000000) throw Error('Membership source scan budget exceeded');
      for (const edge of page.edges) {
        if (!edge || Object.keys(edge).length !== 1 || !['Club','Role','Parent','Guardian','ChildTeam','Team','Excluded'].includes(Object.keys(edge)[0])) throw Error('Malformed source edge');
        if (!Object.hasOwn(edge, 'Club')) continue; // roles/children never grant access here
        const club = edge.Club;
        if (!club || !text(club.id) || club.id.length > 64 || typeof club.deleted !== 'boolean' || clubs.has(club.id) || ownership.has(club.id)) throw Error('Conflicting or invalid club ownership');
        clubs.set(club.id, club.deleted); ownership.set(club.id, source.canisterId);
        if (ownership.size > maxClubs) throw Error('Club inventory budget exceeded');
      }
      if (page.next.length === 0) break;
      if (count === 0n) throw Error('Source cursor made no progress');
      const next = cursorValue(page.next[0]);
      if (next.revision !== revision || next.phase > 7n) throw Error('Source continuation revision changed');
      if (cursor.length) {
        const prior = cursorValue(cursor[0]);
        if (!(next.phase > prior.phase || (next.phase === prior.phase && (next.offset > prior.offset || (next.offset === prior.offset && next.nested > prior.nested))))) throw Error('Source cursor made no progress');
      } else if (next.phase === 0n && next.offset === 0n && next.nested === 0n) throw Error('Source cursor made no progress');
      cursor = [next];
    }
    const active = [...clubs].filter(([,deleted]) => !deleted).map(([id]) => id).sort();
    for (const account of accounts) for (const club of active) {
      let member=false;
      // Do not short-circuit: every alias is part of complete read evidence.
      for(const alias of account.principals??[account.subject]){
        const reply=await fenced(() => actor.read_has_club_membership(alias, club));
        if(typeof reply!=='boolean')throw Error('Consensus membership reply required');
        member=member||reply;
      }
      if (member) {
        const list = memberships.get(account.accountId);
        list.push(club);
        if (list.length > 100) throw Error('Account club inventory exceeds bound');
      }
    }
    // This recheck detects drift; only the held external fence establishes
    // atomic cross-source completeness, never these repeated observations.
    const status = unwrap(await fenced(() => actor.read_membership_discovery_status()), 'Membership source status');
    if (nat(status.revision) !== revision) throw Error('Membership source revision changed');
    sourceReceipts.push({ ...source, revision: String(revision), scanned, clubs: [...clubs].sort(([a],[b]) => a.localeCompare(b)) });
  }
  if (await assertFence(structuredClone(context)) !== true) throw Error('External inventory fence changed');
  const rows = accounts.map(account => ({ accountId: account.accountId, subject: account.subject, clubs: memberships.get(account.accountId).sort() })).sort((a,b) => a.accountId.localeCompare(b.accountId));
  const body = { ...context, sourceReceipts, rows };
  return { body, hash: createHash('sha256').update(canonical(body)).digest('hex'), calls };
}

/** Direct local composition: no caller-provided clubs survive. The same held
 * fence must remain valid through encryption; artifacts confer no approval. */
export async function prepareInventoriedPrivateNameArtifact(input, deps) {
  input = structuredClone(input);
  const inventory = await collectPrivateNameClubInventory(input, deps);
  const byId = new Map(inventory.body.rows.map(row => [row.accountId, row]));
  const artifact = await preparePrivateNameArtifact({ ...input, inventoryHash: inventory.hash, rows: input.accounts.map(account => ({accountId: account.accountId, subject: account.subject, name: account.name, sink: account.sink, clubs: byId.get(account.accountId).clubs})) }, deps);
  const context = {identityId: input.identityId, operator: input.operator, deploymentHash: input.deploymentHash, historyRevision: String(input.historyRevision), sources: structuredClone(input.sources), accounts: structuredClone(inventory.body.accounts)};
  if (await deps.assertFence(context) !== true) throw Error('External inventory fence changed during encryption');
  return {artifact, inventory};
}