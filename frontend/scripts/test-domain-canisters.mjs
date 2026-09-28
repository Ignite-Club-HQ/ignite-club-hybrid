// Disposable local-only live gate for the four domain canisters.
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { Principal } from '../node_modules/@icp-sdk/core/lib/esm/principal/index.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as mediaIdl } from '../src/lab/bindings/media_metadata/declarations/media_metadata.did.js';

const host = process.env.DOMAIN_HOST ?? 'http://127.0.0.1:4943';
const ids = {
  events: process.env.EVENTS_ID,
  competition: process.env.COMPETITION_ID,
  messaging: process.env.MESSAGING_ID,
  media: process.env.MEDIA_ID,
};
for (const [name, id] of Object.entries(ids)) if (!id) throw new Error(`${name.toUpperCase()}_ID is required`);
const governor = syntheticIdentity('governor');
const member = syntheticIdentity('team_member').getPrincipal();
const outsider = syntheticIdentity('outsider');
const agent = await HttpAgent.create({ host, identity: governor, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const outsiderAgent = await HttpAgent.create({ host, identity: outsider, shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const events = Actor.createActor(eventsIdl, { agent, canisterId: ids.events });
const competition = Actor.createActor(competitionIdl, { agent, canisterId: ids.competition });
const messaging = Actor.createActor(messagingIdl, { agent, canisterId: ids.messaging });
const media = Actor.createActor(mediaIdl, { agent, canisterId: ids.media });
const memberAgent = await HttpAgent.create({ host, identity: syntheticIdentity('team_member'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 });
const memberMessaging = Actor.createActor(messagingIdl, { agent: memberAgent, canisterId: ids.messaging });
const outsiderEvents = Actor.createActor(eventsIdl, { agent: outsiderAgent, canisterId: ids.events });
const outsiderMessaging = Actor.createActor(messagingIdl, { agent: outsiderAgent, canisterId: ids.messaging });
const outsiderMedia = Actor.createActor(mediaIdl, { agent: outsiderAgent, canisterId: ids.media });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const ok = (result, label) => { check('Ok' in result, `${label}: ${'Err' in result ? result.Err : 'unknown error'}`); return result.Ok; };
const err = (result, label) => { check('Err' in result, `${label}: expected rejection`); return result.Err; };
const club = `club-domain-${Date.now()}`;
const team = `team-domain-${Date.now()}`;

ok(await events.grant_role(governor.getPrincipal(), 'club_admin', club, []), 'events role grant');
const event = ok(await events.create_event(club, [team], 'Synthetic training', 'Domain probe', 10n, 20n), 'event create');
const rsvp = ok(await events.set_rsvp(event.id, 'account-domain', 'yes'), 'event rsvp');
const attendance = ok(await events.set_attendance(event.id, 'account-domain', true, 'present'), 'event attendance');
const duty = ok(await events.set_duty(event.id, 'account-domain', 'coach'), 'event duty');
const roster = ok(await events.set_roster(event.id, 'account-domain', ['child-domain']), 'event roster');
const recurrence = ok(await events.set_recurrence(event.id, 'weekly', 100n), 'event recurrence');
check(rsvp.event_id === event.id && attendance.present && duty.duty === 'coach' && roster.child_id[0] === 'child-domain' && recurrence.frequency === 'weekly', 'event records were not persisted');
err(await outsiderEvents.update_event(event.id, 'tampered', 'denied', 10n, 20n), 'unauthorized event update');

ok(await competition.grant_role(governor.getPrincipal(), 'club_admin', club, []), 'competition club role grant');
const createdCompetition = ok(await competition.create_competition(club, 'Synthetic league', '2026'), 'competition create');
const entry = ok(await competition.register_team(createdCompetition.id, team, club), 'competition team entry');
const awayTeam = `${team}-away`;
const awayEntry = ok(await competition.register_team(createdCompetition.id, awayTeam, club), 'competition away team entry');
const season = ok(await competition.create_season(createdCompetition.id, 'Spring 2026'), 'competition season create');
const activeSeason = ok(await competition.set_season_status(createdCompetition.id, 'active', season.revision), 'competition season activate');
const scheduledMatch = ok(await competition.record_match(createdCompetition.id, team, awayTeam), 'competition match record');
const completedMatch = ok(await competition.set_match_result(scheduledMatch.id, 2, 1, scheduledMatch.revision), 'competition match result');
check(entry.team_id === team && awayEntry.team_id === awayTeam && activeSeason.status === 'active' && completedMatch.status === 'completed', 'competition records were not persisted');
const token = ok(await competition.issue_join_token(createdCompetition.id, team, BigInt(Date.now() + 60_000)), 'competition join token');
const claim = ok(await competition.claim_join_token(token.id), 'competition token claim');
check(entry.competition_id === createdCompetition.id && claim.includes(createdCompetition.id), 'competition state mismatch');
err(await competition.claim_join_token(token.id), 'replayed competition token');
const archivedSeason = ok(await competition.set_season_status(createdCompetition.id, 'archived', activeSeason.revision), 'competition season archive');
err(await competition.set_season_status(createdCompetition.id, 'active', archivedSeason.revision), 'archived season reopen');

const conversation = ok(await messaging.create_conversation(club, [team], [governor.getPrincipal(), member]), 'conversation create');
const firstMessage = ok(await messaging.send_message(conversation.id, 'hello domain', 'message-key-1'), 'message send');
const replayedMessage = ok(await messaging.send_message(conversation.id, 'hello domain', 'message-key-1'), 'message replay');
check(firstMessage.sequence === 1n && replayedMessage.id === firstMessage.id, 'message ordering/idempotency mismatch');
const secondMessage = ok(await messaging.send_message(conversation.id, 'second message', 'message-key-2'), 'second message send');
const page = await messaging.list_messages(conversation.id, [1n]);
check(page.length === 1 && page[0].id === secondMessage.id, 'message cursor mismatch');
const boundedPage = ok(await messaging.list_messages_page(conversation.id, [], 1), 'bounded message page');
check(boundedPage.messages.length === 1 && boundedPage.latest_sequence === 2n, 'bounded message page mismatch');
const unread = ok(await memberMessaging.unread_count(conversation.id), 'unread count');
check(unread.count === 2n, 'unread count mismatch');
ok(await memberMessaging.mark_read(conversation.id, firstMessage.id), 'mark message read');
const unreadAfterRead = ok(await memberMessaging.unread_count(conversation.id), 'unread after read');
check(unreadAfterRead.count === 1n && unreadAfterRead.last_read_sequence === 1n, 'read receipt/unread mismatch');
err(await messaging.list_messages_page(conversation.id, [99n], 10), 'stale message cursor');
err(await outsiderMessaging.send_message(conversation.id, 'outside', 'message-key-outside'), 'unauthorized message send');
err(await messaging.create_conversation(club, [team], [member]), 'non-participant conversation creator');
err(await outsiderMessaging.delete_message(firstMessage.id), 'non-author message delete');
ok(await messaging.delete_message(secondMessage.id), 'author message delete');

const asset = ok(await media.register_asset(club, 'child_photo', 'image/png', 'checksum-domain', '/synthetic/domain.png', 'club', BigInt(Date.now() + 60_000)), 'asset registration');
check(asset.encrypted && asset.child_sensitive && !asset.deleted, 'child media protection metadata mismatch');
const capability = ok(await media.issue_capability(asset.id, 'download', 'child_photo_view', BigInt(Date.now() + 60_000)), 'media capability');
check(capability.asset_id === asset.id && capability.owner.toText() === governor.getPrincipal().toText() && capability.purpose === 'child_photo_view', 'media capability scope mismatch');
err(await outsiderMedia.issue_capability(asset.id, 'download', 'child_photo_view', BigInt(Date.now() + 60_000)), 'unauthorized media capability');
err(await media.issue_capability(asset.id, 'upload', 'child_photo_upload', 1n), 'expired media capability');
const deletedAsset = ok(await media.delete_asset(asset.id), 'media asset deletion');
check(deletedAsset.deleted && deletedAsset.retention_until_ms <= BigInt(Date.now() + 5_000), 'media deletion/retention mismatch');

const states = {
  events: ok(await events.export_state(), 'events export'),
  competition: ok(await competition.export_state(), 'competition export'),
  messaging: ok(await messaging.export_state(), 'messaging export'),
  media: ok(await media.export_state(), 'media export'),
};
check(states.events.events.length === 1 && states.events.duties.length === 1 && states.events.roster.length === 1 && states.events.recurrences.length === 1, 'event export mismatch');
check(states.competition.competitions.length === 1 && states.competition.seasons.length === 1 && states.competition.matches.length === 1, 'competition export mismatch');
check(states.messaging.messages.length === 1 && states.messaging.unread.length >= 1 && states.media.assets.length === 1 && states.media.assets[0].deleted, 'domain durable state mismatch');
console.log(JSON.stringify({ host, ids, event: event.id, competition: createdCompetition.id, conversation: conversation.id, asset: asset.id, checks: ['authorization', 'revisioned event records', 'event duties/roster/recurrence', 'competition seasons/archive', 'competition fixtures/results', 'join-token replay protection', 'message ordering/idempotency', 'bounded pagination/stale cursors', 'unread/read receipts', 'author-only deletion', 'capability expiry/scope', 'durable exports'] }, null, 2));
