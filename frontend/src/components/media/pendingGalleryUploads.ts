import { useSyncExternalStore } from 'react';
import type { QueryClient } from '@tanstack/react-query';

export interface PendingGalleryUpload {
  id: string;
  batchId: string;
  src: string;
  clubId: string;
  teamId: string | null;
  competitionId: string | null;
  clubName: string;
  scopeName: string | null;
  assetId?: string;
  isVideo: boolean;
  settled?: boolean;
  publication?: {
    albumId: string | null;
    miniLeagueId: string | null;
    eventId: string | null;
    caption: string | null;
    createdAtMs: number;
  };
}
const empty: readonly PendingGalleryUpload[] = [];
type Store = { rows: readonly PendingGalleryUpload[]; listeners: Set<() => void> };
const stores = new WeakMap<QueryClient, Map<string, Store>>();
function storeFor(client: QueryClient, principal: string): Store {
  let accounts = stores.get(client);
  if (!accounts) { accounts = new Map(); stores.set(client, accounts); }
  let store = accounts.get(principal);
  if (!store) { store = { rows: empty, listeners: new Set() }; accounts.set(principal, store); }
  return store;
}
function update(client: QueryClient, principal: string, edit: (rows: readonly PendingGalleryUpload[]) => readonly PendingGalleryUpload[]) {
  const store = storeFor(client, principal);
  store.rows = edit(store.rows);
  store.listeners.forEach(listener => listener());
}
export function beginGalleryUpload(client: QueryClient, principal: string, rows: PendingGalleryUpload[]) {
  update(client, principal, old => [...old, ...rows]);
}
export function acknowledgeGalleryUpload(client: QueryClient, principal: string, id: string, assetId: string, publication?: PendingGalleryUpload['publication']) {
  update(client, principal, rows => rows.map(row => row.id === id ? { ...row, assetId, ...(publication ? { publication, settled: true } : {}) } : row));
}
export async function finishGalleryUpload(client: QueryClient, principal: string, batchId: string) {
  update(client, principal, rows => rows.flatMap(row => row.batchId !== batchId ? [row]
    : row.assetId ? [{ ...row, settled: true }] : []));
  // Invalidates inactive feeds too; completion never depends on an old page's callback.
  await client.invalidateQueries({ queryKey: ['icp-media-feed', principal], exact: true });
}
export function reconcileGalleryUploads(client: QueryClient, principal: string, assetIds: readonly string[]) {
  const known = new Set(assetIds);
  const store = storeFor(client, principal);
  if (store.rows.some(row => row.assetId && known.has(row.assetId))) {
    update(client, principal, rows => rows.filter(row => !row.assetId || !known.has(row.assetId)));
  }
}
export function usePendingGalleryUploads(client: QueryClient, principal: string | undefined) {
  return useSyncExternalStore(listener => {
    if (!principal) return () => {};
    const store = storeFor(client, principal);
    store.listeners.add(listener);
    return () => { store.listeners.delete(listener); };
  }, () => principal ? storeFor(client, principal).rows : empty, () => empty);
}