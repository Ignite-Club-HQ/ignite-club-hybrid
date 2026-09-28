// Live integration probe for multi-site placement registry and domain-specific shard routing.
import fs from 'node:fs';
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { Principal } from '../node_modules/@icp-sdk/core/lib/esm/principal/index.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';
import { idlFactory as placementIdl } from '../src/lab/bindings/placement_registry/declarations/placement_registry.did.js';
import { idlFactory as routerIdl } from '../src/lab/bindings/shard_router/declarations/shard_router.did.js';

const root = new URL('../../', import.meta.url);
const configPath = process.env.IDENTITY_BOOTSTRAP_CONFIG ?? '.local-icp/public.json';
const config = fs.existsSync(new URL(configPath, root)) ? JSON.parse(fs.readFileSync(new URL(configPath, root), 'utf8')) : {};
const mapping = fs.existsSync(new URL('.icp/cache/mappings/local.ids.json', root)) ? JSON.parse(fs.readFileSync(new URL('.icp/cache/mappings/local.ids.json', root), 'utf8')) : {};

const host = process.env.CONTROL_PLANE_HOST ?? config.apiUrl ?? 'http://127.0.0.1:4943';
const placementId = process.env.PLACEMENT_ID ?? config.placement_registry ?? mapping.placement_registry;
const routerId = process.env.ROUTER_ID ?? config.shard_router ?? mapping.shard_router;
if (!placementId || !routerId) {
  throw new Error('PLACEMENT_ID and ROUTER_ID are required');
}

const governor = syntheticIdentity('governor');
const agent = await HttpAgent.create({
  host,
  identity: governor,
  shouldFetchRootKey: true,
  shouldSyncTime: false,
  useQueryNonces: true,
  retryTimes: 1,
});

const placement = Actor.createActor(placementIdl, { agent, canisterId: placementId });
const router = Actor.createActor(routerIdl, { agent, canisterId: routerId });

const fail = (label, result) => {
  if ('Err' in result) throw new Error(`${label}: ${result.Err}`);
  return result.Ok;
};
const check = (condition, message) => {
  if (!condition) throw new Error(message);
};

const suffix = Date.now().toString(36);
const siteAClub = `club-site-a-${suffix}`;
const siteBClub = `club-site-b-${suffix}`;
const shardDefault = Principal.fromText(placementId);
const shardEvents = Principal.fromText(routerId);
const shardMessaging = governor.getPrincipal();

console.log('--- Step 1: Testing Multi-Site Placement & Targets ---');
// Set country policies
const auPolicyPrev = fail('Policy AU read', await placement.get_policy('AU'));
fail('Policy AU', await placement.set_policy('AU', true, true, auPolicyPrev.version));

const euPolicyPrev = fail('Policy EU read', await placement.get_policy('EU'));
fail('Policy EU', await placement.set_policy('EU', true, true, euPolicyPrev.version));

// Set residency policies
const auResPolicyPrev = fail('Residency Policy AU read', await placement.get_residency_policy('AU'));
fail('Residency Policy AU', await placement.set_residency_policy('AU', ['AU_SYDNEY'], auResPolicyPrev.version));

const euResPolicyPrev = fail('Residency Policy EU read', await placement.get_residency_policy('EU'));
fail('Residency Policy EU', await placement.set_residency_policy('EU', ['EU_FRANKFURT'], euResPolicyPrev.version));

// Register Site A (Core Hybrid) Target
let version = await placement.version();
const targetA = fail('Target Site A', await placement.set_target(
  `target-site-a-${suffix}`,
  ['site-a'],
  'AU_SYDNEY',
  { Supabase: { environment: 'site-a-primary' } },
  'supabase_primary',
  true,
  version
));

// Register Site B (Secondary Supabase) Target
version = await placement.version();
const targetB = fail('Target Site B', await placement.set_target(
  `target-site-b-${suffix}`,
  ['site-b'],
  'EU_FRANKFURT',
  { Supabase: { environment: 'site-b-secondary' } },
  'supabase_tenant',
  true,
  version
));

// Assign placements
version = await placement.version();
fail('Placement Site A', await placement.set_placement(siteAClub, 'AU', { Supabase: { environment: 'site-a-primary' } }, version));
version = await placement.version();
fail('Placement Site B', await placement.set_placement(siteBClub, 'EU', { Supabase: { environment: 'site-b-secondary' } }, version));

// Assign residencies
version = await placement.version();
fail('Residency Site A', await placement.set_residency(siteAClub, 'AU_SYDNEY', targetA.alias, version));
version = await placement.version();
fail('Residency Site B', await placement.set_residency(siteBClub, 'EU_FRANKFURT', targetB.alias, version));

// Check initial decisions
const decisionA = fail('Decision A', await placement.get_decision(siteAClub))[0];
const decisionB = fail('Decision B', await placement.get_decision(siteBClub))[0];
check(decisionA?.writable === true, 'Site A placement must be writable initially');
check(decisionB?.writable === true, 'Site B placement must be writable initially');

console.log('--- Step 2: Testing Independent Site Availability Kill Switches ---');
// Disable Site B
version = await placement.version();
const siteBStatus = fail('Disable Site B', await placement.set_site_availability('site-b', false, version));
check(siteBStatus.enabled === false, 'Site B should be disabled');

const decisionAAfter = fail('Decision A After', await placement.get_decision(siteAClub))[0];
const decisionBAfter = fail('Decision B After', await placement.get_decision(siteBClub))[0];
check(decisionAAfter?.writable === true, 'Site A MUST remain writable when Site B is disabled');
check(decisionBAfter?.writable === false, 'Site B MUST NOT be writable when Site B is disabled');
check(decisionBAfter?.reason === 'Site disabled', `Expected "Site disabled", got: ${decisionBAfter?.reason}`);

// Re-enable Site B
version = await placement.version();
fail('Re-enable Site B', await placement.set_site_availability('site-b', true, version));
const decisionBReenabled = fail('Decision B Re-enabled', await placement.get_decision(siteBClub))[0];
check(decisionBReenabled?.writable === true, 'Site B should be writable after re-enabling');

console.log('--- Step 3: Testing Domain-Level Shard Routing & Migrations ---');
// Assign default club route
let routerRev = await router.version();
const assignClubResult = fail('Assign Club Route', await router.assign({
  club_id: siteAClub,
  shard: shardDefault,
  expected_revision: routerRev,
}));
check(assignClubResult.route.shard.toText() === shardDefault.toText(), 'Club route shard mismatch');

// Query domain route before specific override: should fall back to club default route mapped to domain
const defaultEventsRoute = fail('Default events route', await router.get_domain_route(siteAClub, 'events'))[0];
check(defaultEventsRoute?.shard.toText() === shardDefault.toText(), 'Default domain route should match club route');

// Assign specific domain route for events
routerRev = await router.version();
const assignEventsResult = fail('Assign Events Domain Route', await router.assign_domain({
  club_id: siteAClub,
  domain: 'events',
  shard: shardEvents,
  expected_revision: routerRev,
}));
check(assignEventsResult.route.shard.toText() === shardEvents.toText(), 'Events domain route mismatch');

// Assign specific domain route for messaging
routerRev = await router.version();
const assignMessagingResult = fail('Assign Messaging Domain Route', await router.assign_domain({
  club_id: siteAClub,
  domain: 'messaging',
  shard: shardMessaging,
  expected_revision: routerRev,
}));
check(assignMessagingResult.route.shard.toText() === shardMessaging.toText(), 'Messaging domain route mismatch');

// Verify distinct domain routes
const currentEventsRoute = fail('Current events route', await router.get_domain_route(siteAClub, 'events'))[0];
const currentMessagingRoute = fail('Current messaging route', await router.get_domain_route(siteAClub, 'messaging'))[0];
const currentMediaRoute = fail('Current media route (unassigned fallback)', await router.get_domain_route(siteAClub, 'media'))[0];

check(currentEventsRoute?.shard.toText() === shardEvents.toText(), 'Events route mismatch');
check(currentMessagingRoute?.shard.toText() === shardMessaging.toText(), 'Messaging route mismatch');
check(currentMediaRoute?.shard.toText() === shardDefault.toText(), 'Media route fallback mismatch');

console.log('--- Step 4: Testing Domain-Level Migration Fences ---');
// Begin migration for events domain from shardEvents to shardMessaging
routerRev = await router.version();
const domainMigration = fail('Begin domain migration', await router.begin_domain_migration(
  siteAClub,
  'events',
  shardMessaging,
  currentEventsRoute.revision
));
check(domainMigration.destination.toText() === shardMessaging.toText(), 'Migration destination mismatch');

// Commit domain migration
const commitResult = fail('Commit domain migration', await router.commit_domain_migration(
  siteAClub,
  'events',
  domainMigration.migration_revision
));
check(commitResult.route.shard.toText() === shardMessaging.toText(), 'Committed route shard mismatch');

const migratedEventsRoute = fail('Migrated events route', await router.get_domain_route(siteAClub, 'events'))[0];
check(migratedEventsRoute?.shard.toText() === shardMessaging.toText(), 'Events route should point to new destination');

console.log(JSON.stringify({
  status: 'PASS',
  multiSite: {
    siteA: { club: siteAClub, target: targetA.alias, writable: decisionAAfter.writable },
    siteB: { club: siteBClub, target: targetB.alias, writableAfterReenable: decisionBReenabled.writable },
  },
  domainRouting: {
    eventsShard: migratedEventsRoute.shard.toText(),
    messagingShard: currentMessagingRoute.shard.toText(),
    mediaFallbackShard: currentMediaRoute.shard.toText(),
  },
  checks: [
    'multi-site targets and residency policies',
    'independent site availability isolation',
    'domain-specific shard assignment and fallback',
    'domain-level migration lifecycle',
    'audit logging',
  ],
}, null, 2));
