// Disposable local-only live gate for the four Motoko product domain canisters.
import { Actor, HttpAgent } from '../node_modules/@icp-sdk/core/lib/esm/agent/index.js';
import { Principal } from '../node_modules/@icp-sdk/core/lib/esm/principal/index.js';
import { syntheticIdentity } from '../src/lab/syntheticIdentities.mjs';
import { idlFactory as eventsIdl } from '../src/lab/bindings/events_domain/declarations/events_domain.did.js';
import { idlFactory as competitionIdl } from '../src/lab/bindings/competition_domain/declarations/competition_domain.did.js';
import { idlFactory as messagingIdl } from '../src/lab/bindings/messaging_domain/declarations/messaging_domain.did.js';
import { idlFactory as mediaIdl } from '../src/lab/bindings/media_metadata/declarations/media_metadata.did.js';

const host = process.env.DOMAIN_HOST ?? 'http://127.0.0.1:4943';
const ids = {
  events: process.env.EVENTS_MOTOKO_ID,
  competition: process.env.COMPETITION_MOTOKO_ID,
  messaging: process.env.MESSAGING_MOTOKO_ID,
  media: process.env.MEDIA_MOTOKO_ID,
};
for (const [name, id] of Object.entries(ids)) if (!id) throw new Error(`${name.toUpperCase()}_MOTOKO_ID is required`);
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
const teamAdminMessaging = Actor.createActor(messagingIdl, { agent: await HttpAgent.create({ host, identity: syntheticIdentity('team_member'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 }), canisterId: ids.messaging });
const coachMessaging = Actor.createActor(messagingIdl, { agent: await HttpAgent.create({ host, identity: syntheticIdentity('parent'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 }), canisterId: ids.messaging });
const clubAdminMessaging = Actor.createActor(messagingIdl, { agent: await HttpAgent.create({ host, identity: syntheticIdentity('club_admin'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 }), canisterId: ids.messaging });
const appAdminMessaging = Actor.createActor(messagingIdl, { agent: await HttpAgent.create({ host, identity: syntheticIdentity('app_admin'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 }), canisterId: ids.messaging });
const outsiderMessaging = Actor.createActor(messagingIdl, { agent: outsiderAgent, canisterId: ids.messaging });
const outsiderMedia = Actor.createActor(mediaIdl, { agent: outsiderAgent, canisterId: ids.media });
const check = (condition, message) => { if (!condition) throw new Error(message); };
const ok = (result, label) => { check('Ok' in result, `${label}: ${'Err' in result ? result.Err : 'unknown error'}`); return result.Ok; };
const err = async (promise, label) => {
  try {
    const result = await promise;
    if ('Err' in result) return result.Err;
    throw new Error(`${label}: expected rejection but call succeeded`);
  } catch (error) {
    const rejectMessage = error?.cause?.rejectMessage ?? error?.message ?? String(error);
    if (error?.cause?.kind === 'Reject' || error?.name === 'RejectError' || error?.cause?.code === 'IC0503') return rejectMessage;
    throw new Error(`${label}: ${rejectMessage}`);
  }
};
const club = `motoko-club-${Date.now()}`;
const team = `motoko-team-${Date.now()}`;

// Events domain Motoko verification
const eventsInit = await events.initialize();
if ('Err' in eventsInit && eventsInit.Err !== 'Already initialized') throw new Error(eventsInit.Err);
ok(await events.grant_role(governor.getPrincipal(), 'club_admin', club, []), 'events role grant');
const event = ok(await events.create_event(club, [team], 'Synthetic Motoko training', 'Domain probe', 10n, 20n), 'event create');
const rsvp = ok(await events.set_rsvp(event.id, 'account-domain', 'yes'), 'event rsvp');
const attendance = ok(await events.set_attendance(event.id, 'account-domain', true, 'present'), 'event attendance');
const duty = ok(await events.set_duty(event.id, 'account-domain', 'coach'), 'event duty');
const roster = ok(await events.set_roster(event.id, 'account-domain', ['child-domain']), 'event roster');
const recurrence = ok(await events.set_recurrence(event.id, 'weekly', 100n), 'event recurrence');
check(rsvp.event_id === event.id && attendance.present && duty.duty === 'coach' && roster.child_id[0] === 'child-domain' && recurrence.frequency === 'weekly', 'event records were not persisted');
await err(outsiderEvents.update_event(event.id, 'tampered', 'denied', 10n, 20n), 'unauthorized event update');
await err(outsiderEvents.export_state(), 'unauthorized event snapshot export');

// Competition domain Motoko verification
const competitionInit = await competition.initialize();
if ('Err' in competitionInit && competitionInit.Err !== 'Already initialized') throw new Error(competitionInit.Err);
ok(await competition.grant_role(governor.getPrincipal(), 'club_admin', club, []), 'competition club role grant');
const createdCompetition = ok(await competition.create_competition(club, 'Synthetic Motoko league', '2026'), 'competition create');
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
await err(competition.claim_join_token(token.id), 'replayed competition token');
const archivedSeason = ok(await competition.set_season_status(createdCompetition.id, 'archived', activeSeason.revision), 'competition season archive');
await err(competition.set_season_status(createdCompetition.id, 'active', archivedSeason.revision), 'archived season reopen');

// Messaging domain Motoko verification
const messagingInit = await messaging.initialize();
if ('Err' in messagingInit && messagingInit.Err !== 'Already initialized') throw new Error(messagingInit.Err);
const conversation = ok(await messaging.create_conversation(club, [team], [governor.getPrincipal(), member]), 'conversation create');
const firstMessage = ok(await messaging.send_message(conversation.id, 'hello Motoko domain', 'message-key-1'), 'message send');
const replayedMessage = ok(await messaging.send_message(conversation.id, 'hello Motoko domain', 'message-key-1'), 'message replay');
check(firstMessage.sequence === 1n && replayedMessage.id === firstMessage.id, 'message ordering/idempotency mismatch');
const secondMessage = ok(await messaging.send_message(conversation.id, 'second message', 'message-key-2'), 'second message send');
const page = await messaging.list_messages(conversation.id, [1n]);
const editedMessage = ok(await messaging.update_message(firstMessage.id, 'edited Motoko domain'), 'author message update');
check(editedMessage.id === firstMessage.id && editedMessage.conversation_id === firstMessage.conversation_id && editedMessage.sender.toText() === governor.getPrincipal().toText() && editedMessage.sequence === firstMessage.sequence && editedMessage.idempotency_key === firstMessage.idempotency_key && editedMessage.body === 'edited Motoko domain', 'message update changed immutable fields');
await err(memberMessaging.update_message(firstMessage.id, 'member tampering'), 'non-author message update');
const nonTeamConversation = ok(await messaging.create_conversation(club, [], [governor.getPrincipal()]), 'non-team conversation create');
const nonTeamMessage = ok(await messaging.send_message(nonTeamConversation.id, 'non-team message', 'non-team-message-key'), 'non-team message send');
await err(messaging.update_message(nonTeamMessage.id, 'non-team update'), 'non-team message update');
check(page.length === 1 && page[0].id === secondMessage.id, 'message cursor mismatch');
const boundedPage = ok(await messaging.list_messages_page(conversation.id, [], 1), 'bounded message page');
check(boundedPage.messages.length === 1 && boundedPage.latest_sequence === 2n, 'bounded message page mismatch');
const unread = ok(await memberMessaging.unread_count(conversation.id), 'unread count');
check(unread.count === 2n, 'unread count mismatch');
ok(await memberMessaging.mark_read(conversation.id, firstMessage.id), 'mark message read');
const unreadAfterRead = ok(await memberMessaging.unread_count(conversation.id), 'unread after read');
check(unreadAfterRead.count === 1n && unreadAfterRead.last_read_sequence === 1n, 'read receipt/unread mismatch');
await err(messaging.list_messages_page(conversation.id, [99n], 10), 'stale message cursor');
await err(outsiderMessaging.send_message(conversation.id, 'outside', 'message-key-outside'), 'unauthorized message send');
await err(messaging.create_conversation(club, [team], [member]), 'non-participant conversation creator');
await err(outsiderMessaging.delete_message(firstMessage.id), 'non-author message delete');
await err(outsiderMessaging.grant_role(member, 'team_admin', [club], [team]), 'non-governor role grant');
await err(messaging.grant_role(member, 'team_admin', [club], []), 'invalid team-admin scope');
await err(messaging.grant_role(member, 'unsupported_role', [club], [team]), 'unsupported role grant');
ok(await messaging.grant_role(member, 'team_admin', [club], [team]), 'team-admin role grant');
ok(await teamAdminMessaging.delete_message(firstMessage.id), 'team-admin message delete');
ok(await messaging.grant_role(syntheticIdentity('parent').getPrincipal(), 'coach', [club], [team]), 'coach role grant');
ok(await coachMessaging.delete_message(secondMessage.id), 'coach message delete');
const clubAdminMessage = ok(await messaging.send_message(conversation.id, 'club admin target', 'message-key-3'), 'club-admin target message');
ok(await messaging.grant_role(syntheticIdentity('club_admin').getPrincipal(), 'club_admin', [club], []), 'club-admin role grant');
const clubAdminPage = ok(await clubAdminMessaging.list_messages_page(conversation.id, [], 10), 'club-admin team-message read');
check(clubAdminPage.messages.some(item => item.id === clubAdminMessage.id), 'club-admin team-message read mismatch');
await err(clubAdminMessaging.list_messages_page(nonTeamConversation.id, [], 10), 'club-admin non-team message read');
await err(teamAdminMessaging.update_message(clubAdminMessage.id, 'team-admin tampering'), 'team-admin message update');
ok(await clubAdminMessaging.delete_message(clubAdminMessage.id), 'club-admin message delete');
const appAdminMessage = ok(await messaging.send_message(conversation.id, 'app admin target', 'message-key-4'), 'app-admin target message');
ok(await messaging.grant_role(syntheticIdentity('app_admin').getPrincipal(), 'app_admin', [], []), 'app-admin role grant');
const appAdminPage = ok(await appAdminMessaging.list_messages_page(conversation.id, [], 10), 'app-admin team-message read');
check(appAdminPage.messages.some(item => item.id === appAdminMessage.id), 'app-admin team-message read mismatch');
ok(await appAdminMessaging.delete_message(appAdminMessage.id), 'app-admin message delete');
const crossClubAdmin = Actor.createActor(messagingIdl, { agent: await HttpAgent.create({ host, identity: syntheticIdentity('other_admin'), shouldFetchRootKey: true, shouldSyncTime: false, useQueryNonces: true, retryTimes: 1 }), canisterId: ids.messaging });
const crossClubMessage = ok(await messaging.send_message(conversation.id, 'cross-club target', 'message-key-5'), 'cross-club target message');
ok(await messaging.grant_role(syntheticIdentity('other_admin').getPrincipal(), 'club_admin', [`${club}-other`], []), 'cross-club admin role grant');
await err(crossClubAdmin.list_messages_page(conversation.id, [], 10), 'cross-club admin message read');
await err(crossClubAdmin.delete_message(crossClubMessage.id), 'cross-club admin message delete');
ok(await messaging.delete_message(crossClubMessage.id), 'author message delete');
const retainedMessage = ok(await messaging.send_message(conversation.id, 'retained message', 'message-key-6'), 'retained message');

// Media metadata Motoko verification
const mediaInit = await media.initialize();
if ('Err' in mediaInit && mediaInit.Err !== 'Already initialized') throw new Error(mediaInit.Err);
const asset = ok(await media.register_asset(club, 'child_photo', 'image/png', 'checksum-domain', '/synthetic/domain.png', 'club', BigInt(Date.now() + 60_000)), 'asset registration');
check(asset.encrypted && asset.child_sensitive && !asset.deleted, 'child media protection metadata mismatch');
check((await media.get_asset(asset.id))?.id === asset.id, 'media owner cannot read asset metadata');
check((await outsiderMedia.get_asset(asset.id)) === null, 'media metadata leaked to outsider');
const capability = ok(await media.issue_capability(asset.id, 'download', 'child_photo_view', BigInt(Date.now() + 60_000)), 'media capability');
check(capability.asset_id === asset.id && capability.owner.toText() === governor.getPrincipal().toText() && capability.purpose === 'child_photo_view', 'media capability scope mismatch');
await err(outsiderMedia.issue_capability(asset.id, 'download', 'child_photo_view', BigInt(Date.now() + 60_000)), 'unauthorized media capability');
await err(media.issue_capability(asset.id, 'upload', 'child_photo_upload', 1n), 'expired media capability');
const deletedAsset = ok(await media.delete_asset(asset.id), 'media asset deletion');
check(deletedAsset.deleted && deletedAsset.retention_until_ms <= BigInt(Date.now() + 5_000), 'media deletion/retention mismatch');

const states = {
  events: ok(await events.export_state(), 'events export'),
  competition: ok(await competition.export_state(), 'competition export'),
  messaging: ok(await messaging.export_state(), 'messaging export'),
  media: ok(await media.export_state(), 'media export'),
};
check(states.events.events.some(item => item.id === event.id && item.club_id === club), 'event export mismatch');
check(states.events.duties.some(item => item.event_id === event.id && item.account_id === 'account-domain' && item.duty === 'coach'), 'event duty export mismatch');
check(states.events.roster.some(item => item.event_id === event.id && item.account_id === 'account-domain' && item.child_id?.[0] === 'child-domain'), 'event roster export mismatch');
check(states.events.recurrences.some(item => item.event_id === event.id && item.frequency === 'weekly'), 'event recurrence export mismatch');
check(states.competition.competitions.some(item => item.id === createdCompetition.id && item.club_id === club), 'competition export mismatch');
check(states.competition.seasons.some(item => item.competition_id === createdCompetition.id && item.name === 'Spring 2026'), 'competition season export mismatch');
check(states.competition.matches.some(item => item.id === scheduledMatch.id && item.home_team === team && item.away_team === awayTeam), 'competition match export mismatch');
check(states.messaging.messages.some(item => item.id === retainedMessage.id && item.body === 'retained message'), 'messaging export mismatch');
check(states.messaging.roles.some(item => item.user.toText() === member.toText() && item.role === 'team_admin' && item.club_id[0] === club && item.team_id[0] === team), 'messaging role export mismatch');
check(states.messaging.unread.some(item => item.conversation_id === conversation.id && item.user.toText() === member.toText()), 'messaging unread export mismatch');
check(states.media.assets.some(item => item.id === asset.id && item.deleted), 'media export mismatch');
console.log(JSON.stringify({ status: 'PASS', implementation: 'motoko', host, ids, checks: ['events motoko', 'competition motoko', 'messaging motoko', 'media metadata motoko', 'authorization', 'replay safety', 'bounded pagination', 'read receipts', 'capability security', 'durable exports'] }, null, 2));