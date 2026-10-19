/** Live transfer adapter (inactive operator tooling). Connects the resumable
 * runner to real club_domain, events_domain, messaging_domain and vault_domain
 * canisters through governor-authenticated actors. Every club-scoped domain
 * is covered; secret_workload_identity is deployment-wide and never copied.
 * Snapshots are opaque Candid blobs — never decoded or decrypted here. */
import type { DomainDigest } from './groupTransfer';
import type { TransferAdapter } from './groupTransferRunner';
import { assertMediaTransferSafe, type MediaTransferInventory } from './mediaTransferSafety';

type R<T> = { Ok: T } | { Err: string };
const ok = <T>(r: R<T>): T => { if ('Err' in r) throw new Error(r.Err); return r.Ok; };
const bytes = (b: Uint8Array | number[]) => (b instanceof Uint8Array ? b : Uint8Array.from(b));

export type SnapshotActor = {
  export_club_snapshot(club: string): Promise<R<Uint8Array | number[]>>;
  import_club_snapshot(club: string, snap: Uint8Array): Promise<R<unknown>>;
  purge_club_snapshot(club: string): Promise<R<bigint>>;
};
export type FenceActor = { set_transfer_fence(club: string, on: boolean): Promise<R<null>> };
export type ClubActor = SnapshotActor & {
  freeze_club(club: string, rev: bigint): Promise<R<bigint>>;
  unfreeze_club(club: string, rev: bigint): Promise<R<null>>;
};
export type ChatActor = FenceActor & {
  export_club_snapshot_page(club: string, offset: bigint, limit: bigint): Promise<R<Uint8Array | number[]>>;
  import_club_snapshot_page(club: string, page: Uint8Array): Promise<R<bigint>>;
  purge_club_snapshot(club: string): Promise<R<bigint>>;
};
type Fenced = SnapshotActor & FenceActor;
export type InsightsActor = Fenced & { claim_legacy_sponsor_metrics(club: string, sponsors: string[]): Promise<R<null>> };
const SIMPLE = ['events_domain', 'vault_domain', 'club_points_domain', 'mini_league_domain', 'competition_domain', 'media_metadata',
  'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs'] as const;
export type GroupActors = { club_domain: ClubActor; messaging_domain: ChatActor } & { [K in Exclude<(typeof SIMPLE)[number], 'insights_domain'>]: Fenced } & { insights_domain: InsightsActor };
export const LIVE_DOMAINS = ['club_domain', 'messaging_domain', ...SIMPLE] as const;
const FENCE_DOMAINS = ['messaging_domain', ...SIMPLE] as const;
/** Deployment-wide services holding no club data (workload identities/secret audit): never copied, never purged. */
export const GLOBAL_DOMAINS = ['secret_workload_identity'] as const;
const CHAT_PAGE = 500n;

export async function sha256Hex(data: Uint8Array): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(h)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export type LiveAdapterDeps = {
  actors(group: string): GroupActors;
  /** Sponsor ids the club owns on the source group; their older sponsor-only counts are folded into the club before copying. */
  clubSponsorIds(group: string, clubId: string): Promise<string[]>;
  sameDeployment: TransferAdapter['sameDeployment'];
  readRegistryRevision: TransferAdapter['readRegistryRevision'];
  swapAssignment: TransferAdapter['swapAssignment'];
  save: TransferAdapter['save'];
  fenceRevision: bigint;
  /** Destination group of the club's persisted in-flight transfer — durable, so a restarted operator still unlocks it. */
  targetFor(clubId: string): Promise<string | null>;
  /** Authenticated complete inventory including chat/vault/article blobs and
   * pending operations; unavailable readers fail closed, including on resume. */
  mediaInventory?(fromGroup: string, toGroup: string, clubId: string): Promise<MediaTransferInventory>;
  /** Opt-in durable media preparation. Fence metadata domains before the
   * inventory callback scans blob stores. Failed checks retain all locks. */
  mediaPreparation?: { release(): Promise<void> };
  /** Opt-in operator hooks backed by durable key journals and authenticated
   * deployment/placement/provenance/fence readers. Not move permission. */
  mediaKeyRecovery?: {
    prepareCutover: NonNullable<TransferAdapter['prepareCutover']>;
    beforeAbortUnlock: NonNullable<TransferAdapter['beforeAbortUnlock']>;
    verifyReleased(t: import('./groupTransfer').Transfer): Promise<void>;
  };
};

export function liveTransferAdapter(d: LiveAdapterDeps): TransferAdapter {
  const verifyMedia = async (from: string, to: string, club: string) => {
    if (!d.mediaInventory) throw new Error('Authenticated media inventory reader required; club move blocked');
    if (d.mediaPreparation) await fenceAll(from, club, true);
    assertMediaTransferSafe(await d.mediaInventory(from, to, club), club, from, to);
  };
  const live = (domain: string) => (LIVE_DOMAINS as readonly string[]).includes(domain);
  const global = (domain: string) => (GLOBAL_DOMAINS as readonly string[]).includes(domain);
  // Both sides are fenced: source blocks writes, target accepts imports only.
  const fenceAll = async (group: string, club: string, on: boolean) => {
    const a = d.actors(group);
    if (on) ok(await a.club_domain.freeze_club(club, d.fenceRevision)); else ok(await a.club_domain.unfreeze_club(club, d.fenceRevision));
    for (const dom of FENCE_DOMAINS) ok(await a[dom].set_transfer_fence(club, on));
  };
  const chatPages = async (group: string, club: string) => {
    const out: Uint8Array[] = []; let offset = 0n;
    for (let i = 0; i < 100_000; i++) {
      const page = bytes(ok(await d.actors(group).messaging_domain.export_club_snapshot_page(club, offset, CHAT_PAGE)));
      out.push(page); offset += CHAT_PAGE;
      if (!(await hasMore(group, club, offset))) return out;
    }
    throw new Error('Chat export exceeds page budget');
  };
  const hasMore = async (group: string, club: string, offset: bigint) => {
    // An empty page beyond the end decodes to the same bytes as the previous terminal page shape; probe one row.
    const probe = bytes(ok(await d.actors(group).messaging_domain.export_club_snapshot_page(club, offset, 1n)));
    const terminal = bytes(ok(await d.actors(group).messaging_domain.export_club_snapshot_page(club, 1n << 40n, 1n)));
    return !(probe.length === terminal.length && probe.every((b, i) => b === terminal[i]));
  };
  return {
    sameDeployment: d.sameDeployment,
    verifyMedia,
    async setFence(group, club, on) {
      if (on) await fenceAll(group, club, true);
      if (on) { // locked first, so no new sponsor-only count can land after the fold
        const sponsors = await d.clubSponsorIds(group, club);
        for (let i = 0; i < sponsors.length; i += 500)
          ok(await d.actors(group).insights_domain.claim_legacy_sponsor_metrics(club, sponsors.slice(i, i + 500)));
      }
      const target = on ? null : await d.targetFor(club);
      if (target && target !== group) { // abort before cutover: discard the partial target copy
        await fenceAll(target, club, true); // purge requires the lock; idempotent
        for (const dom of LIVE_DOMAINS) ok(await d.actors(target)[dom].purge_club_snapshot(club));
        await fenceAll(target, club, false);
      }
      if (!on) await fenceAll(group, club, false); // target cleanup precedes source unlock
    },
    async exportPage(group, club, domain, cursor) {
      if (global(domain)) return { rows: [], next: null };
      // Every club-data canister has move endpoints; anything unknown fails closed rather than being skipped.
      if (!live(domain)) throw new Error(`${domain} has no move endpoints; refusing to move the club`);
      const a = d.actors(group);
      if (domain === 'messaging_domain') {
        const offset = cursor === null ? 0n : BigInt(cursor);
        const page = bytes(ok(await a.messaging_domain.export_club_snapshot_page(club, offset, CHAT_PAGE)));
        const next = offset + CHAT_PAGE;
        return { rows: [page], next: (await hasMore(group, club, next)) ? next.toString() : null };
      }
      return { rows: [bytes(ok(await a[domain as 'club_domain'].export_club_snapshot(club)))], next: null };
    },
    async importPage(group, club, domain, rows, pageIndex) {
      if (!live(domain)) { if (rows.length) throw new Error(`${domain} has no move endpoints`); return; }
      if (pageIndex === 0) await fenceAll(group, club, true); // lock target for import (idempotent on resume)
      const a = d.actors(group);
      for (const row of rows) {
        if (domain === 'messaging_domain') ok(await a.messaging_domain.import_club_snapshot_page(club, row));
        else ok(await a[domain as 'club_domain'].import_club_snapshot(club, row));
      }
    },
    async digest(group, club, domain): Promise<DomainDigest> {
      if (global(domain)) return { domain, records: 0, digest: 'deployment-wide' };
      if (!live(domain)) throw new Error(`${domain} has no move endpoints; refusing to move the club`);
      const a = d.actors(group);
      const parts = domain === 'messaging_domain' ? await chatPages(group, club) : [bytes(ok(await a[domain as 'club_domain'].export_club_snapshot(club)))];
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return { domain, records: all.length, digest: await sha256Hex(all) };
    },
    readRegistryRevision: d.readRegistryRevision,
    swapAssignment: d.swapAssignment,
    async purgeSource(group, club) {
      const destination = await d.targetFor(club);
      if (!destination || destination === group) throw new Error('Persisted destination required before media-safe purge');
      await verifyMedia(group, destination, club);
      // Key-state proof must precede irreversible purge AND either group's
      // unlock, not merely the later terminal blob-fence release.
      await d.mediaKeyRecovery?.verifyReleased({ clubId: club, fromGroup: group, toGroup: destination,
        registryRevision: await d.readRegistryRevision(), phase: 'cutover', log: ['cutover'] });
      const a = d.actors(group);
      for (const dom of LIVE_DOMAINS) ok(await a[dom].purge_club_snapshot(club));
      await fenceAll(group, club, false);
      const target = await d.targetFor(club);
      if (target && target !== group) await fenceAll(target, club, false);
    },
    save: d.save,
    prepareCutover: d.mediaKeyRecovery?.prepareCutover,
    beforeAbortUnlock: d.mediaKeyRecovery?.beforeAbortUnlock,
    async cleanupTerminal(t) {
      if (t.phase !== 'released' && t.phase !== 'aborted') throw new Error('Durable terminal transfer required');
      if (t.phase === 'released') await d.mediaKeyRecovery?.verifyReleased(t);
      await d.mediaPreparation?.release();
    },
  };
}
