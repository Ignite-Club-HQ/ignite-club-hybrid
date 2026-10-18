/** Local integration only. Authenticated transport and exclusive controller
 * fencing must be supplied externally. Polls cannot prove no other controller
 * restarted a participant between observations. Raw bytes are not ledger exports.
 */
import { readSnapshotBytes, equalSnapshotBytes } from './media-snapshot-reader.mjs';
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const fail = () => { throw new Error('Incomplete or mismatched recovery snapshot evidence'); };

export function createRecoverySnapshotVerification(expected, placement, adapter, transport, options = {}) {
  const inv = structuredClone(expected);
  const pinned = structuredClone(placement);
  if (!Array.isArray(inv.stores)) fail();
  const ids = [...inv.stores, inv.authority];
  if (!inv.deploymentId || ids.length < 2 || ids.length > 65 || new Set(ids).size !== ids.length ||
      ids.some(id => typeof id !== 'string' || !id) || pinned.deploymentId !== inv.deploymentId ||
      ['host', 'network', 'registryRevision'].some(k => typeof pinned[k] !== 'string' || !pinned[k]) ||
      !pinned.subnets || !same(Object.keys(pinned.subnets).sort(), [...ids].sort()) ||
      Object.values(pinned.subnets).some(x => typeof x !== 'string' || !x) ||
      typeof adapter.verifyRecoveryPlacement !== 'function') fail();
  const origin = new URL(pinned.host);
  if (origin.protocol !== 'https:' || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') fail();
  const requestFor = (canisterId, snapshotId) => ({ canisterId, snapshotId,
    deploymentId: inv.deploymentId, host: pinned.host, network: pinned.network,
    registryRevision: pinned.registryRevision, subnetId: pinned.subnets[canisterId] });
  const validateCheckpoint = checkpoint => {
    if (checkpoint?.version !== 1 || checkpoint.inventory?.deploymentId !== inv.deploymentId ||
        checkpoint.inventory.authority !== inv.authority || !Array.isArray(checkpoint.inventory.stores) ||
        !same([...checkpoint.inventory.stores].sort(), [...inv.stores].sort()) ||
        !Array.isArray(checkpoint.snapshots) || checkpoint.snapshots.length !== ids.length ||
        !same(checkpoint.snapshots.map(s => s.canisterId).sort(), [...ids].sort()) ||
        checkpoint.snapshots.some(s => typeof s.snapshotId !== 'string' || !/^(?:[a-f0-9]{2})+$/.test(s.snapshotId))) fail();
  };
  const validateBaseline = (checkpoint, evidence) => {
    validateCheckpoint(checkpoint);
    if (evidence?.version !== 1 || !same(evidence.placement, pinned) ||
        !Array.isArray(evidence.participants) || evidence.participants.length !== ids.length ||
        !same(evidence.participants.map(e => e?.request?.canisterId).sort(), [...ids].sort())) fail();
    for (const entry of evidence.participants) {
      const saved = checkpoint.snapshots.find(s => s.canisterId === entry.request.canisterId);
      if (!saved || !same(entry.request, requestFor(saved.canisterId, saved.snapshotId)) || !equalSnapshotBytes(entry, entry)) fail();
    }
  };
  const fence = async () => {
    const actual = await adapter.readInventory();
    if (actual?.deploymentId !== inv.deploymentId || actual.authority !== inv.authority ||
        !Array.isArray(actual.stores) || !same([...actual.stores].sort(), [...inv.stores].sort()) ||
        await adapter.verifyRecoveryPlacement(structuredClone(pinned)) !== true) fail();
    for (const id of ids) if (await adapter.status(id) !== 'stopped') fail();
  };
  return {
    validateBaseline,
    async capture(checkpoint, observation, record) {
      validateCheckpoint(checkpoint);
      const participants = [];
      const guarded = { ...transport, verifyStoppedPlacement: async request => {
        await fence();
        return await transport.verifyStoppedPlacement(request) === true;
      } };
      await fence();
      for (const saved of checkpoint.snapshots) {
        let snapshotId = saved.snapshotId;
        if (observation) {
          await fence();
          snapshotId = await record('takeObservationSnapshot', saved.canisterId,
            () => adapter.takeSnapshot(saved.canisterId));
        }
        const result = await record('readSnapshotBytes', saved.canisterId,
          () => readSnapshotBytes(requestFor(saved.canisterId, snapshotId), guarded, options), snapshotId);
        participants.push(result);
      }
      await fence();
      return { version: 1, placement: structuredClone(pinned), participants };
    },
    compare(checkpoint, baseline, observed) {
      try {
        validateBaseline(checkpoint, baseline);
        if (observed?.version !== 1 || !same(observed.placement, pinned) ||
            !Array.isArray(observed.participants) || observed.participants.length !== ids.length ||
            !same(observed.participants.map(e => e?.request?.canisterId).sort(), [...ids].sort())) return false;
        return baseline.participants.every(saved => equalSnapshotBytes(saved,
          observed.participants.find(e => e.request.canisterId === saved.request.canisterId)));
      } catch { return false; }
    },
  };
}