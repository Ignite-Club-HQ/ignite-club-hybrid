import { act, renderHook } from '@testing-library/react';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn(), write: vi.fn() }));
vi.mock('@/lib/sharedPitchBoard', () => ({ readSharedPitchBoard: mocks.read, writeSharedPitchBoard: mocks.write, sharedPitchSignature: (v: unknown) => JSON.stringify(v) }));
import { useIcpSharedPitchBoard } from './useIcpSharedPitchBoard';
const key = 'ignite-pitch-board-state-team-t';
async function tick() { await act(async () => { await vi.advanceTimersByTimeAsync(5000); }); }
beforeEach(() => { vi.useFakeTimers(); vi.clearAllMocks(); localStorage.clear(); mocks.read.mockResolvedValue({ revision: 9n, pitch: { players: ['remote'] } }); mocks.write.mockResolvedValue({ revision: 10n }); });
afterEach(() => { vi.useRealTimers(); });
describe('ICP shared pitch-board ownership', () => {
  it('hydrates first, writes the exact revision, and never writes as a spectator', async () => {
    const apply = vi.fn();
    const hook = renderHook(() => useIcpSharedPitchBoard({ teamId: 't', userId: 'u', enabled: true, readOnly: true, apply }));
    await act(async () => {});
    expect(apply).toHaveBeenCalledWith({ players: ['remote'], teamId: 't' });
    localStorage.setItem(key, JSON.stringify({ players: ['stale'] }));
    await tick();
    expect(mocks.write).not.toHaveBeenCalled();
    hook.unmount();
  });
  it('a newer peer revision wins instead of overwriting it with a local edit', async () => {
    const apply = vi.fn();
    const hook = renderHook(() => useIcpSharedPitchBoard({ teamId: 't', userId: 'u', enabled: true, readOnly: false, apply }));
    await act(async () => {});
    localStorage.setItem(key, JSON.stringify({ players: ['local'] }));
    mocks.read.mockResolvedValue({ revision: 10n, pitch: { players: ['peer'] } });
    await tick();
    expect(mocks.write).not.toHaveBeenCalled();
    expect(apply).toHaveBeenLastCalledWith({ players: ['peer'], teamId: 't' });
    hook.unmount();
  });
  it('uses CAS and reloads after an unknown write without replay', async () => {
    const hook = renderHook(() => useIcpSharedPitchBoard({ teamId: 't', userId: 'u', enabled: true, readOnly: false, apply: vi.fn() }));
    await act(async () => {});
    localStorage.setItem(key, JSON.stringify({ players: ['edit'] }));
    mocks.write.mockRejectedValueOnce(new Error('unknown transport outcome'));
    await tick();
    expect(mocks.write).toHaveBeenCalledWith('t', 9n, { players: ['edit'] }, expect.any(String));
    await tick();
    expect(mocks.write).toHaveBeenCalledTimes(1);
    hook.unmount();
  });
  it('ignores late results after switching accounts', async () => {
    let finish: (value: unknown) => void = () => {};
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const apply = vi.fn();
    const hook = renderHook(() => useIcpSharedPitchBoard({ teamId: 't', userId: 'u', enabled: true, readOnly: false, apply }));
    hook.unmount();
    await act(async () => { finish({ revision: 9n, pitch: { players: ['old-account'] } }); });
    expect(apply).not.toHaveBeenCalled();
    expect(localStorage.getItem(key)).toBeNull();
  });
  it('does not poll until auth and board initialization are ready', async () => {
    const hook = renderHook(() => useIcpSharedPitchBoard({ teamId: 't', enabled: false, readOnly: false, apply: vi.fn() }));
    await tick();
    expect(mocks.read).not.toHaveBeenCalled();
    hook.unmount();
  });
});