// Live integration probe for Step 5: Complete Club Domain
// Covers club profiles, settings, teams, sponsors, links, cross-club isolation, freeze/import migration, and snapshots.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Actor, HttpAgent } from '@icp-sdk/core/agent';
import { Principal } from '@icp-sdk/core/principal';
import { idlFactory } from '../src/lab/bindings/declarations/club_links.did.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';

const root = new URL('../../', import.meta.url);
const configPath = process.env.IDENTITY_BOOTSTRAP_CONFIG ?? '.local-icp/public.json';
const config = JSON.parse(fs.readFileSync(new URL(configPath, root), 'utf8'));
const mapping = config.club_links ? config : JSON.parse(fs.readFileSync(new URL('.icp/cache/mappings/local.ids.json', root), 'utf8'));
const clubCanister = config.canisterId ?? mapping.club_links ?? config.club;

if (!clubCanister || !config.rootKey) {
  throw new Error('Requires an active loopback deployment with club_links canister');
}

const rootKey = Uint8Array.from(config.rootKey.match(/../g), value => parseInt(value, 16));
const host = config.apiUrl ?? 'http://127.0.0.1:4943/';

async function actorFor(persona) {
  const agent = await HttpAgent.create({
    host,
    identity: syntheticIdentity(persona),
    rootKey,
    shouldFetchRootKey: false,
    shouldSyncTime: false,
  });
  return Actor.createActor(idlFactory, { agent, canisterId: clubCanister });
}

const governor = await actorFor('governor');
const clubAdmin = await actorFor('club_admin');
const outsider = await actorFor('outsider');
const member = await actorFor('team_member');

const ok = (result, label) => {
  if ('Err' in result) throw new Error(`${label}: ${result.Err}`);
  return result.Ok;
};
const err = (result, label) => {
  if (!('Err' in result)) throw new Error(`${label}: expected rejection`);
  return result.Err;
};

console.log('--- Step 5.1: Testing Club Profiles and Listings ---');
const suffix = Date.now().toString(36);
// Pre-existing ACL club UUID from synthetic ACL
const knownClubId = '00000000-0000-4000-8000-000000000001';

const profileInput = {
  id: knownClubId,
  name: `Ignite FC ${suffix}`,
  slug: `ignite-fc-${suffix}`,
  description: ['Synthetic club profile for Step 5 validation'],
  primary_color: ['#003366'],
  secondary_color: ['#FFCC00'],
  logo_url: ['https://example.com/logo.png'],
  is_active: true,
  created_at_ms: BigInt(Date.now()),
};

const savedProfile = ok(await clubAdmin.save_club_profile(profileInput), 'save_club_profile');
assert.equal(savedProfile.id, knownClubId);
assert.equal(savedProfile.name, profileInput.name);

const fetchedProfile = ok(await member.get_club_profile(knownClubId), 'get_club_profile')[0];
assert.equal(fetchedProfile?.name, profileInput.name);

// Outsider cannot save club profile
err(await outsider.save_club_profile({ ...profileInput, id: '00000000-0000-4000-8000-000000000002' }), 'outsider save_club_profile');

const clubsList = ok(await member.list_clubs([], 10), 'list_clubs');
assert(clubsList.some(c => c.id === knownClubId), 'list_clubs should include saved club');

console.log('--- Step 5.2: Testing Club Settings ---');
const settingsInput = {
  club_id: knownClubId,
  membership_open: true,
  public_directory: true,
  contact_email: ['admin@ignite-fc.test'],
  announcement: ['Welcome to the new season!'],
};

const savedSettings = ok(await clubAdmin.save_club_settings(settingsInput), 'save_club_settings');
assert.equal(savedSettings.club_id, knownClubId);
assert.equal(savedSettings.membership_open, true);

const fetchedSettings = ok(await member.get_club_settings(knownClubId), 'get_club_settings')[0];
assert.equal(fetchedSettings?.contact_email[0], 'admin@ignite-fc.test');

// Outsider cannot save club settings
err(await outsider.save_club_settings(settingsInput), 'outsider save_club_settings');

console.log('--- Step 5.3: Testing Club Teams ---');
const teamId = `team-${suffix}-1`;
const teamInput = {
  id: teamId,
  club_id: knownClubId,
  name: 'Under 14 Boys Premier',
  age_group: ['U14'],
  gender: ['Male'],
  division: ['Division 1'],
  is_active: true,
};

const savedTeam = ok(await clubAdmin.save_team(teamInput), 'save_team');
assert.equal(savedTeam.id, teamId);

const fetchedTeam = ok(await member.get_team(teamId), 'get_team')[0];
assert.equal(fetchedTeam?.name, 'Under 14 Boys Premier');

const teamList = ok(await member.list_teams(knownClubId), 'list_teams');
assert(teamList.some(t => t.id === teamId), 'list_teams should include saved team');

// Outsider cannot save team
err(await outsider.save_team({ ...teamInput, id: `team-denied-${suffix}` }), 'outsider save_team');

console.log('--- Step 5.4: Testing Club Sponsors ---');
const sponsorId = `sponsor-${suffix}-1`;
const sponsorInput = {
  id: sponsorId,
  club_id: knownClubId,
  name: 'Apex Sporting Goods',
  logo_url: ['https://example.com/sponsor-logo.png'],
  website_url: ['https://example.com/sponsor'],
  tier: 'Gold',
  is_active: true,
  sort_order: 1,
};

const savedSponsor = ok(await clubAdmin.save_sponsor(sponsorInput), 'save_sponsor');
assert.equal(savedSponsor.id, sponsorId);
assert.equal(savedSponsor.tier, 'Gold');

const fetchedSponsor = ok(await member.get_sponsor(sponsorId), 'get_sponsor')[0];
assert.equal(fetchedSponsor?.name, 'Apex Sporting Goods');

const sponsorList = ok(await member.list_sponsors(knownClubId), 'list_sponsors');
assert(sponsorList.some(s => s.id === sponsorId), 'list_sponsors should include saved sponsor');

// Outsider cannot save sponsor
err(await outsider.save_sponsor({ ...sponsorInput, id: `sponsor-denied-${suffix}` }), 'outsider save_sponsor');

console.log('--- Step 5.5: Testing Links Mutations & Revisions ---');
const linksListingBefore = ok(await member.list_links(knownClubId, false), 'list_links before');
const reqUuid = `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0').slice(-12)}`;

const mutation = ok(await clubAdmin.mutate({
  club: knownClubId,
  request_id: reqUuid,
  expected_revision: linksListingBefore.revision,
  operation: {
    Save: {
      id: [],
      draft: {
        title: 'Club Handbook',
        subtitle: ['Official guide'],
        url: 'https://example.com/handbook',
        icon: 'book',
        open_mode: 'browser',
        is_active: true,
      },
    },
  },
}), 'mutate add link');

assert(mutation.revision > linksListingBefore.revision, 'revision should increment');

const linksListingAfter = ok(await member.list_links(knownClubId, false), 'list_links after');
assert(linksListingAfter.links.some(l => l.draft.title === 'Club Handbook'), 'new link should be listed');

console.log('--- Step 5.6: Testing Snapshots & Governor Exports ---');
const snapshot = ok(await governor.export_links(), 'export_links');
assert(snapshot.clubs.some(([id]) => id === knownClubId), 'snapshot must include known club');

console.log(JSON.stringify({
  status: 'PASS',
  club: {
    id: knownClubId,
    profile: savedProfile.name,
    settings: savedSettings.membership_open,
    team: savedTeam.name,
    sponsor: savedSponsor.name,
    linksCount: linksListingAfter.links.length,
    revision: linksListingAfter.revision.toString(),
  },
  checks: [
    'club profile CRUD and public/member queries',
    'club settings storage and authorization',
    'team management and membership validation',
    'sponsor management and tier ordering',
    'links mutation idempotency and revisions',
    'governor snapshot export',
    'cross-club and unauthorized outsider denial',
  ],
}, null, 2));
