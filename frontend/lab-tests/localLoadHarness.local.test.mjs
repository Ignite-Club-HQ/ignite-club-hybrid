import assert from 'node:assert/strict';
import test from 'node:test';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1']);

const profiles = Object.freeze({
  smoke: { virtualUsers: 5, durationSeconds: 15, activeClubs: 2, usersPerClub: 5, totalClubCardinality: 25 },
  baseline: { virtualUsers: 50, durationSeconds: 60, activeClubs: 10, usersPerClub: 20, totalClubCardinality: 100 },
  gameday: { virtualUsers: 200, durationSeconds: 120, activeClubs: 25, usersPerClub: 20, totalClubCardinality: 500, authShare: 0.01 },
  authstorm: { virtualUsers: 200, durationSeconds: 120, activeClubs: 25, usersPerClub: 20, totalClubCardinality: 500, authShare: 0.05 },
  scale: { virtualUsers: 500, durationSeconds: 180, activeClubs: 50, usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0.01, rampSeconds: 120 },
  realistic500: { virtualUsers: 500, durationSeconds: 300, activeClubs: 50, usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0, rampSeconds: 180, thinkTimeMinMs: 3_000, thinkTimeMaxMs: 10_000 },
  realistic1000: { virtualUsers: 1_000, durationSeconds: 300, activeClubs: 50, usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0, rampSeconds: 180, thinkTimeMinMs: 3_000, thinkTimeMaxMs: 10_000 },
  realtime500: { mode: 'realtime', virtualUsers: 500, durationSeconds: 120, activeClubs: 50, usersPerClub: 20, totalClubCardinality: 1_000, authShare: 0, rampSeconds: 60, fanoutWaves: 10, fanoutIntervalMs: 3_000 },
});

const anonKey = `sb_publishable_${'a'.repeat(24)}`;
const serviceKey = `sb_secret_${'b'.repeat(24)}`;

function requireKey(value, prefix) {
  const valid = typeof value === 'string'
    && (value.split('.').length === 3 || (value.startsWith(prefix) && value.length > prefix.length + 16));
  if (!valid) throw new Error('generated local API keys are required');
  return value;
}

function assertLocalLoadEnvironment(source) {
  let url;
  try {
    url = new URL(source.LOCAL_SUPABASE_URL);
  } catch {
    url = null;
  }
  if (
    !url
    || url.protocol !== 'http:'
    || !LOOPBACK.has(url.hostname)
    || url.port !== '54321'
    || url.pathname !== '/'
    || url.username
    || url.password
  ) {
    throw new Error('target must be local HTTP on port 54321');
  }
  return { url: url.origin, anonKey: requireKey(source.LOCAL_SUPABASE_ANON_KEY, 'sb_publishable_'), serviceKey: requireKey(source.LOCAL_SUPABASE_SERVICE_ROLE_KEY, 'sb_secret_') };
}

function resolveLocalLoadProfile(args) {
  const name = args.find((arg) => arg.startsWith('--profile='))?.split('=')[1] ?? 'smoke';
  const profile = profiles[name];
  if (!profile) throw new Error(`Unknown load profile "${name}"`);
  return { name, profile };
}

function workerStartDelayMs(workerIndex, profile) {
  if (!Number.isInteger(workerIndex) || workerIndex < 0 || workerIndex >= profile.virtualUsers) {
    throw new Error('worker index is outside the selected profile');
  }
  const rampSeconds = profile.rampSeconds ?? 0;
  if (rampSeconds <= 0 || profile.virtualUsers <= 1) return 0;
  return Math.round((workerIndex / (profile.virtualUsers - 1)) * rampSeconds * 1_000);
}

function workerUserIndex(workerIndex, virtualUsers, availableUsers) {
  if (
    !Number.isInteger(workerIndex)
    || !Number.isInteger(virtualUsers)
    || !Number.isInteger(availableUsers)
    || workerIndex < 0
    || virtualUsers < 1
    || availableUsers < 1
    || workerIndex >= virtualUsers
  ) {
    throw new Error('invalid worker-to-user distribution');
  }
  return Math.floor((workerIndex * availableUsers) / virtualUsers) % availableUsers;
}

function thinkTimeMs(profile, randomValue) {
  const minimum = profile.thinkTimeMinMs ?? 100;
  const maximum = profile.thinkTimeMaxMs ?? 300;
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum < minimum || randomValue < 0 || randomValue > 1) {
    throw new Error('invalid local load pacing configuration');
  }
  return minimum + randomValue * (maximum - minimum);
}

function failureReason(error) {
  const values = [];
  for (let current = error, depth = 0; current && depth < 4; depth += 1, current = current.cause) {
    for (const value of [current.code, current.status, current.name, current.message, current.details, current.hint]) {
      if (value !== undefined && value !== null && String(value).trim()) values.push(String(value));
    }
  }
  return [...new Set(values)].join(':').slice(0, 180) || 'unknown';
}

function isExpectedLoadNetworkNoise(values) {
  const text = values.map((value) => (value instanceof Error ? failureReason(value) : String(value))).join(' ');
  return /fetch failed|UND_ERR_SOCKET|ECONNRESET|other side closed/i.test(text);
}

function summarizeRealtimeDelivery(waves) {
  const expectedDeliveries = waves.reduce((sum, wave) => sum + wave.expected, 0);
  const receivedDeliveries = waves.reduce((sum, wave) => sum + Math.min(wave.deliveries, wave.expected), 0);
  const duplicateDeliveries = waves.reduce((sum, wave) => sum + Math.max(0, wave.deliveries - wave.expected), 0);
  return {
    expectedDeliveries,
    receivedDeliveries,
    missingDeliveries: Math.max(0, expectedDeliveries - receivedDeliveries),
    duplicateDeliveries,
    deliveryRate: expectedDeliveries ? receivedDeliveries / expectedDeliveries : 0,
  };
}

test('rejects hosted Supabase load target', () => {
  assert.throws(() => assertLocalLoadEnvironment({ LOCAL_SUPABASE_URL: 'https://project.supabase.co', LOCAL_SUPABASE_ANON_KEY: anonKey, LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey }));
});

test('rejects loopback on the wrong port', () => {
  assert.throws(() => assertLocalLoadEnvironment({ LOCAL_SUPABASE_URL: 'http://127.0.0.1:54322', LOCAL_SUPABASE_ANON_KEY: anonKey, LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey }));
});

test('rejects malformed masked load target', () => {
  assert.throws(() => assertLocalLoadEnvironment({ LOCAL_SUPABASE_URL: '******127.0.0.1:54321', LOCAL_SUPABASE_ANON_KEY: anonKey, LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey }));
});

test('accepts only the isolated local gateway', () => {
  assert.deepEqual(assertLocalLoadEnvironment({ LOCAL_SUPABASE_URL: 'http://127.0.0.1:54321', LOCAL_SUPABASE_ANON_KEY: anonKey, LOCAL_SUPABASE_SERVICE_ROLE_KEY: serviceKey }), { url: 'http://127.0.0.1:54321', anonKey, serviceKey });
});

test('defaults to the bounded smoke profile and rejects arbitrary profiles', () => {
  assert.equal(resolveLocalLoadProfile([]).name, 'smoke');
  assert.throws(() => resolveLocalLoadProfile(['--profile=production']), /Unknown load profile/);
});

test('keeps every declared profile within the local safety ceiling', () => {
  for (const profile of Object.values(profiles)) {
    assert.ok(profile.virtualUsers <= 1_000);
    assert.ok(profile.durationSeconds <= 300);
    assert.ok(profile.totalClubCardinality <= 1_000);
    assert.ok(profile.activeClubs * profile.usersPerClub <= 1_000);
    if (profile.authShare !== undefined) assert.ok(profile.authShare >= 0 && profile.authShare <= 0.05);
  }
});

test('keeps game-day traffic distinct from the authentication storm', () => {
  assert.equal(profiles.gameday.authShare, 0.01);
  assert.equal(profiles.authstorm.authShare, 0.05);
  assert.equal(profiles.gameday.virtualUsers, profiles.authstorm.virtualUsers);
});

test('ramps the scale profile progressively while retaining a full-load hold', () => {
  assert.equal(workerStartDelayMs(0, profiles.scale), 0);
  assert.ok(workerStartDelayMs(250, profiles.scale) > 60_000);
  assert.equal(workerStartDelayMs(499, profiles.scale), 120_000);
  assert.ok(profiles.scale.durationSeconds - profiles.scale.rampSeconds >= 60);
});

test('rejects invalid worker indexes', () => {
  assert.throws(() => workerStartDelayMs(-1, profiles.scale));
  assert.throws(() => workerStartDelayMs(500, profiles.scale));
});

test('extracts nested transport errors and suppresses only known network noise', () => {
  const error = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) });
  assert.match(failureReason(error), /UND_ERR_SOCKET/);
  assert.equal(isExpectedLoadNetworkNoise([error]), true);
  assert.equal(isExpectedLoadNetworkNoise(['unexpected application defect']), false);
});

test('models 500 established sessions with realistic human pacing', () => {
  assert.equal(profiles.realistic500.virtualUsers, 500);
  assert.equal(workerStartDelayMs(499, profiles.realistic500), 180_000);
  assert.equal(thinkTimeMs(profiles.realistic500, 0), 3_000);
  assert.equal(thinkTimeMs(profiles.realistic500, 1), 10_000);
});

test('bounds the 1000-session profile to the existing synthetic accounts', () => {
  assert.equal(profiles.realistic1000.virtualUsers, 1_000);
  assert.equal(profiles.realistic1000.activeClubs * profiles.realistic1000.usersPerClub, 1_000);
  assert.equal(workerStartDelayMs(999, profiles.realistic1000), 180_000);
});

test('bounds Realtime fan-out to 500 connections across every active club', () => {
  assert.equal(profiles.realtime500.mode, 'realtime');
  assert.equal(profiles.realtime500.virtualUsers, 500);
  assert.equal(profiles.realtime500.activeClubs, 50);
  assert.equal(profiles.realtime500.fanoutWaves, 10);
  assert.ok(profiles.realtime500.fanoutIntervalMs >= 3_000);
});

test('does not let duplicate Realtime messages hide missing deliveries', () => {
  assert.deepEqual(summarizeRealtimeDelivery([{ expected: 100, deliveries: 98 }, { expected: 100, deliveries: 102 }]), {
    expectedDeliveries: 200,
    receivedDeliveries: 198,
    missingDeliveries: 2,
    duplicateDeliveries: 2,
    deliveryRate: 0.99,
  });
});

test('distributes virtual users evenly across all synthetic active clubs', () => {
  assert.equal(workerUserIndex(0, 500, 1_000), 0);
  assert.equal(workerUserIndex(250, 500, 1_000), 500);
  assert.equal(workerUserIndex(499, 500, 1_000), 998);
  assert.throws(() => workerUserIndex(500, 500, 1_000));
});
