import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useChatProfileWorkset } from './useChatProfileWorkset';

describe('mounted viewport scope', () => {
  it('moves names with viewport and never reuses another account or thread window', () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ id: `m${i}`, author_id: `p${i}` }));
    const hook = renderHook(({ chat, viewer }) => useChatProfileWorkset(rows, chat, viewer), { initialProps: { chat: 'a', viewer: 'v1' } });
    act(() => hook.result.current.onVisibleMessageIds(['m0']));
    expect(hook.result.current.ids).toEqual(['p0']);
    act(() => hook.result.current.onVisibleMessageIds(['m140']));
    expect(hook.result.current.ids).toEqual(['p140']);
    hook.rerender({ chat: 'b', viewer: 'v1' });
    expect(hook.result.current.ids).toEqual(rows.slice(-25).reverse().map(row => row.author_id));
    act(() => hook.result.current.onVisibleMessageIds(['m0']));
    hook.rerender({ chat: 'b', viewer: 'v2' });
    expect(hook.result.current.ids).not.toContain('p0');
  });
});