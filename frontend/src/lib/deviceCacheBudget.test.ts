// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { clearDeviceReadCacheStorage, LOCAL_READ_CACHE_BYTES, pruneDeviceReadCaches,
  storedTextBytes, writeBoundedReadCache } from './deviceCacheBudget';
beforeEach(() => { localStorage.clear(); pruneDeviceReadCaches(); });
describe('bounded disposable device copies', () => {
  it('evicts oldest copies to keep the combined local budget at 2 MiB', () => {
    for (let i = 0; i < 12; i++) writeBoundedReadCache(`ignite_event_detail_${i}`,
      JSON.stringify({ timestamp: Date.now(), data: 'x'.repeat(150000) }));
    let total = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i); if (key) total += storedTextBytes(key, localStorage.getItem(key) ?? '');
    }
    expect(total).toBeLessThanOrEqual(LOCAL_READ_CACHE_BYTES);
    expect(localStorage.getItem('ignite_event_detail_0')).toBeNull();
    expect(localStorage.getItem('ignite_event_detail_11')).not.toBeNull();
  });
  it('refuses an oversized list instead of filling storage', () => {
    expect(writeBoundedReadCache('messages-page-cache-v2', 'x'.repeat(300000))).toBe(false);
    expect(localStorage.getItem('messages-page-cache-v2')).toBeNull();
  });
  it('prunes expired copies on launch', () => {
    localStorage.setItem('ignite_event_detail_old', JSON.stringify({ timestamp: Date.now() - 8 * 86400000, data: 'old' }));
    pruneDeviceReadCaches();
    expect(localStorage.getItem('ignite_event_detail_old')).toBeNull();
  });
  it('clears only disposable copies, retaining sign-in, keys, drafts and recovery', () => {
    const preserved = ['ignite_icp_internet_identity_session', 'ignite.clubkey.v1:a', 'ignite_vault_upload_intent', 'ignite_chat_draft', 'sb-auth', 'app-theme'];
    for (const key of preserved) localStorage.setItem(key, 'keep');
    writeBoundedReadCache('ignite_event_detail_1', JSON.stringify({ data: 'copy' }));
    clearDeviceReadCacheStorage();
    for (const key of preserved) expect(localStorage.getItem(key)).toBe('keep');
    expect(localStorage.getItem('ignite_event_detail_1')).toBeNull();
  });
});