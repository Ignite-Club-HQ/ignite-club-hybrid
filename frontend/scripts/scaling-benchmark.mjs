#!/usr/bin/env node

// Synthetic topology benchmark. It measures deterministic routing and workload
// shape only; it does not claim to measure ICP replica latency or throughput.

const DEFAULT_SCENARIOS = [
  { name: 'small', clubs: 1_000, activeRatio: 0.5, averageUsers: 40, messagesPerActiveClub: 20, hotClubMessages: 5_000 },
  { name: 'medium', clubs: 10_000, activeRatio: 0.35, averageUsers: 55, messagesPerActiveClub: 35, hotClubMessages: 20_000 },
  { name: 'large', clubs: 100_000, activeRatio: 0.2, averageUsers: 70, messagesPerActiveClub: 50, hotClubMessages: 100_000 },
];

function hashClub(clubNumber) {
  // A stable integer hash keeps the benchmark reproducible without allocating
  // 100K UUID strings or depending on a random seed.
  let x = (clubNumber + 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return (x ^ (x >>> 16)) >>> 0;
}

function shardFor(clubNumber, shardCount) {
  return hashClub(clubNumber) % shardCount;
}

function percentile(values, p) {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))] ?? 0;
}

function scenarioResult(scenario, shardCount) {
  const activeClubs = Math.floor(scenario.clubs * scenario.activeRatio);
  const shardClubs = Array(shardCount).fill(0);
  const shardWork = Array(shardCount).fill(0);
  const shardMessages = Array(shardCount).fill(0);
  const shardFanout = Array(shardCount).fill(0);

  for (let club = 0; club < scenario.clubs; club += 1) {
    const shard = shardFor(club, shardCount);
    shardClubs[shard] += 1;

    // A club read/write mix: membership, event, permission and notification
    // index work. This is a relative workload unit, not an ICP instruction count.
    const users = scenario.averageUsers + (hashClub(club ^ 0xabc) % 11) - 5;
    const clubWork = 20 + Math.max(1, Math.floor(users / 2));
    shardWork[shard] += clubWork;

    if (club < activeClubs) {
      const messages = scenario.messagesPerActiveClub + (hashClub(club ^ 0xdef) % 7);
      shardMessages[shard] += messages;
      // Group fanout is intentionally bounded to model async delivery queues.
      shardFanout[shard] += messages * Math.min(users, 50);
    }
  }

  const hotShard = shardFor(0, shardCount);
  shardMessages[hotShard] += scenario.hotClubMessages;
  shardFanout[hotShard] += scenario.hotClubMessages * Math.min(scenario.averageUsers * 8, 2_000);
  // Fanout is asynchronous work, but it still consumes capacity on the hot
  // shard. Keep it as a relative unit so the benchmark exposes concentration.
  shardWork[hotShard] += scenario.hotClubMessages + Math.floor(shardFanout[hotShard] / 10);

  const totalMessages = shardMessages.reduce((a, b) => a + b, 0);
  const totalFanout = shardFanout.reduce((a, b) => a + b, 0);
  const totalWork = shardWork.reduce((a, b) => a + b, 0);
  const meanWork = totalWork / shardCount;
  const workSkew = Math.max(...shardWork) / Math.max(1, meanWork);

  return {
    scenario: scenario.name,
    clubs: scenario.clubs,
    activeClubs,
    shards: shardCount,
    totalWorkUnits: totalWork,
    totalMessageWrites: totalMessages,
    totalFanoutDeliveries: totalFanout,
    clubCount: {
      min: Math.min(...shardClubs),
      p50: percentile(shardClubs, 0.5),
      p95: percentile(shardClubs, 0.95),
      max: Math.max(...shardClubs),
    },
    workUnitsPerShard: {
      p50: percentile(shardWork, 0.5),
      p95: percentile(shardWork, 0.95),
      max: Math.max(...shardWork),
      maxToMean: Number(workSkew.toFixed(3)),
    },
    messageWritesPerShard: {
      p50: percentile(shardMessages, 0.5),
      p95: percentile(shardMessages, 0.95),
      max: Math.max(...shardMessages),
    },
    hotClubShard: hotShard,
    hotClubMessageWrites: scenario.hotClubMessages,
    interpretation: workSkew > 2
      ? 'hot-tenant skew requires isolation or adaptive repartitioning'
      : 'routing distribution is suitable for a first shard load test',
  };
}

function parseArgs(argv) {
  const options = { json: false, scenarios: DEFAULT_SCENARIOS, shardCounts: [1, 16, 64] };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    if (arg.startsWith('--shards=')) {
      options.shardCounts = arg.slice(9).split(',').map(Number).filter((n) => Number.isInteger(n) && n > 0);
    }
  }
  if (!options.shardCounts.length) throw new Error('--shards must contain a positive integer');
  return options;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const results = options.scenarios.flatMap((scenario) => options.shardCounts.map((count) => scenarioResult(scenario, count)));
  if (options.json) {
    console.log(JSON.stringify({ kind: 'synthetic-routing-workload', results }, null, 2));
    return;
  }
  console.log('Synthetic routing workload benchmark (not ICP throughput)');
  console.log('scenario  clubs  shards  msg writes  fanout deliveries  max/mean work  result');
  for (const row of results) {
    console.log(`${row.scenario.padEnd(8)} ${String(row.clubs).padStart(6)} ${String(row.shards).padStart(6)} ${String(row.totalMessageWrites).padStart(11)} ${String(row.totalFanoutDeliveries).padStart(18)} ${row.workUnitsPerShard.maxToMean.toFixed(3).padStart(14)}  ${row.interpretation}`);
  }
  console.log('\nUse --json for machine-readable output. Run a real local-canister load test before making capacity claims.');
}

main();

export { hashClub, scenarioResult };
