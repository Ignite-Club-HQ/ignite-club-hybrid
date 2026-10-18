/** Live transfer adapter (inactive operator tooling). Connects the resumable
 * runner to real club_domain, events_domain, messaging_domain and vault_domain
 * canisters through governor-authenticated actors. Every club-scoped domain
 * is covered; secret_workload_identity is deployment-wide and never copied.
 * Snapshots are opaque Candid blobs — never decoded or decrypted here. */
import type { DomainDigest } from './groupTransfer';
import type { TransferAdapter } from './groupTransferRunner';

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
const SIMPLE = ['events_domain', 'vault_domain', 'club_points_domain', 'mini_league_domain', 'competition_domain', 'media_metadata',
  'insights_domain', 'notification_queue', 'pii_access_control', 'timer_jobs'] as const;
export type GroupActors = { club_domain: ClubActor; messaging_domain: ChatActor } & { [K in (typeof SIMPLE)[number]]: Fenced };
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
  /** Called with a cursor of null when the domain has no move endpoints: must prove the club is empty there. */
  assertDomainEmpty(group: string, clubId: string, domain: string): Promise<void>;
  sameDeployment: TransferAdapter['sameDeployment'];
  readRegistryRevision: TransferAdapter['readRegistryRevision'];
  swapAssignment: TransferAdapter['swapAssignment'];
  save: TransferAdapter['save'];
  fenceRevision: bigint;
  /** Destination group of the club's persisted in-flight transfer — durable, so a restarted operator still unlocks it. */
  targetFor(clubId: string): Promise<string | null>;
};

export function liveTransferAdapter(d: LiveAdapterDeps): TransferAdapter {
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
    async setFence(group, club, on) {
      await fenceAll(group, club, on);
      const target = on ? null : await d.targetFor(club);
      if (target && target !== group) { // abort before cutover: discard the partial target copy
        await fenceAll(target, club, true); // purge requires the lock; idempotent
        for (const dom of LIVE_DOMAINS) ok(await d.actors(target)[dom].purge_club_snapshot(club));
        await fenceAll(target, club, false);
      }
    },
    async exportPage(group, club, domain, cursor) {
      if (global(domain)) return { rows: [], next: null };
      if (!live(domain)) { await d.assertDomainEmpty(group, club, domain); return { rows: [], next: null }; }
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
      if (!live(domain)) return { domain, records: 0, digest: 'empty' };
      const a = d.actors(group);
      const parts = domain === 'messaging_domain' ? await chatPages(group, club) : [bytes(ok(await a[domain as 'club_domain'].export_club_snapshot(club)))];
      const all = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let o = 0;
      for (const p of parts) { all.set(p, o); o += p.length; }
      return { domain, records: all.length, digest: await sha256Hex(all) };
    },
    readRegistryRevision: d.readRegistryRevision,
    swapAssignment: d.swapAssignment,
    async purgeSource(group, club) {
      const a = d.actors(group);
      for (const dom of LIVE_DOMAINS) ok(await a[dom].purge_club_snapshot(club));
      await fenceAll(group, club, false);
      const target = await d.targetFor(club);
      if (target && target !== group) await fenceAll(target, club, false);
    },
    save: d.save,
  };
}
