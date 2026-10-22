import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { afterMembershipAcknowledgement, clearRoleGrantsMemo } from './roleGrantsMemo';
import { bindMembershipDiscovery, readMembershipDiscovery } from './membershipDiscoveryCache';

afterEach(() => clearRoleGrantsMemo());
describe('acknowledged membership changes', () => {
  it('refreshes independent inventories and page queries only after a successful receipt', async () => {
    const client = new QueryClient(); bindMembershipDiscovery(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const load = vi.fn(async () => ['club-1']);
    await readMembershipDiscovery('inventory', load);
    await expect(afterMembershipAcknowledgement(Promise.reject(new Error('Denied')))).rejects.toThrow('Denied');
    expect(await readMembershipDiscovery('inventory', load)).toEqual(['club-1']);
    expect(load).toHaveBeenCalledTimes(1);
    expect(invalidate).not.toHaveBeenCalled();
    expect(await afterMembershipAcknowledgement(Promise.resolve({ id: 'join-receipt' }))).toEqual({ id: 'join-receipt' });
    load.mockResolvedValue(['club-1', 'club-2']);
    expect(await readMembershipDiscovery('inventory', load)).toEqual(['club-1', 'club-2']);
    expect(load).toHaveBeenCalledTimes(2);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['removed-clubs'] });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['icp-my-mini-leagues'] });
    client.clear();
  });
});