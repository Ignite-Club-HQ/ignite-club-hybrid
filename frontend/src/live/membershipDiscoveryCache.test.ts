import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { bindMembershipDiscovery, clearMembershipDiscovery, MEMBERSHIP_RECONCILE_MS, readMembershipDiscovery, reconcileMembershipDiscovery } from './membershipDiscoveryCache';

beforeEach(() => { clearMembershipDiscovery(); vi.useFakeTimers(); vi.setSystemTime(1000); });
afterEach(() => { clearMembershipDiscovery(); vi.useRealTimers(); });
describe('shared membership discovery', () => {
  it('retires a suspended discovery so the next read can recover and late replies cannot replace it', async () => {
    let release: ((rows: string[]) => void) | undefined;
    const first = readMembershipDiscovery('resume', () => new Promise<string[]>(resolve => { release = resolve; }));
    const refused = expect(first).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(60_001);
    await refused;
    expect(await readMembershipDiscovery('resume', async () => ['restored-team'])).toEqual(['restored-team']);
    release?.(['old-team']);
    await vi.advanceTimersByTimeAsync(0);
    expect(await readMembershipDiscovery('resume', async () => ['wrong'])).toEqual(['restored-team']);
  });
  it('records bounded query data and invalidates visible membership pages after an external join', async () => {
    const client = new QueryClient();
    bindMembershipDiscovery(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const load = vi.fn(async () => ['club-g1']);
    await readMembershipDiscovery('account-target', load);
    expect(client.getQueryData(['icp-membership-discovery', 'account-target'])).toEqual({ value: ['club-g1'], checkedAt: 1000 });
    load.mockResolvedValue(['club-g1', 'club-g2']);
    vi.setSystemTime(1000 + MEMBERSHIP_RECONCILE_MS);
    reconcileMembershipDiscovery();
    await vi.advanceTimersByTimeAsync(0);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['my-chat-groups-with-messages'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['user-memberships-for-events'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['icp-schedule-fixtures'] });
    clearMembershipDiscovery();
    expect(client.getQueryData(['icp-membership-discovery', 'account-target'])).toBeUndefined();
    client.clear();
  });
  it('never reconciles a suspended app', async () => {
    const load = vi.fn(async () => ['club-g1']);
    await readMembershipDiscovery('a', load);
    vi.setSystemTime(1000 + MEMBERSHIP_RECONCILE_MS);
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    reconcileMembershipDiscovery();
    expect(load).toHaveBeenCalledTimes(1);
    visibility.mockRestore();
  });
  it('coalesces pages and does not rediscover after the old 30 second memo expiry', async () => {
    const load = vi.fn(async () => ['club-g1']);
    expect(await Promise.all([readMembershipDiscovery('account-target', load), readMembershipDiscovery('account-target', load)])).toEqual([['club-g1'], ['club-g1']]);
    vi.setSystemTime(61_000);
    for (const _page of ['Home', 'Clubs', 'Events', 'Messages', 'Media']) expect(await readMembershipDiscovery('account-target', load)).toEqual(['club-g1']);
    expect(load).toHaveBeenCalledTimes(1);
  });
  it('reconciles external joins at 15 minutes without blocking content reads', async () => {
    const load = vi.fn(async () => ['club-g1']);
    await readMembershipDiscovery('a', load);
    let complete: ((value: string[]) => void) | undefined;
    load.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    vi.setSystemTime(1000 + MEMBERSHIP_RECONCILE_MS);
    reconcileMembershipDiscovery();
    expect(await readMembershipDiscovery('a', load)).toEqual(['club-g1']);
    expect(load).toHaveBeenCalledTimes(2);
    complete?.(['club-g1', 'club-g2']);
    await vi.advanceTimersByTimeAsync(0);
    expect(await readMembershipDiscovery('a', load)).toEqual(['club-g1', 'club-g2']);
  });
  it('retains the complete snapshot when background discovery fails', async () => {
    const load = vi.fn(async () => ['club-g1']);
    await readMembershipDiscovery('a', load);
    load.mockRejectedValue(new Error('Group 2 unavailable'));
    vi.setSystemTime(1000 + MEMBERSHIP_RECONCILE_MS);
    reconcileMembershipDiscovery();
    await vi.advanceTimersByTimeAsync(0);
    expect(await readMembershipDiscovery('a', load)).toEqual(['club-g1']);
  });
  it('isolates accounts and targets and cannot restore a cleared generation', async () => {
    let complete: ((value: string[]) => void) | undefined;
    const pending = readMembershipDiscovery('old', () => new Promise<string[]>(resolve => { complete = resolve; }));
    await Promise.resolve();
    clearMembershipDiscovery();
    complete?.(['old-club']);
    await expect(pending).rejects.toThrow('changed');
    expect(await readMembershipDiscovery('new', async () => ['new-club'])).toEqual(['new-club']);
    expect(await readMembershipDiscovery('new-other-target', async () => ['other-club'])).toEqual(['other-club']);
  });
});