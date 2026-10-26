import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useVisibleChatMessageIds } from './useVisibleChatMessageIds';

afterEach(() => { vi.useRealTimers(); document.body.replaceChildren(); });
describe('visible chat geometry', () => {
  it('excludes overscan, coalesces scrolling and disconnects on unmount', () => {
    vi.useFakeTimers();
    const root = document.createElement('div'); document.body.append(root);
    root.getBoundingClientRect = () => ({ top: 100, bottom: 500, width: 300, height: 400 }) as DOMRect;
    let tops = [-500, 120, 600];
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div'); row.dataset.messageId = `m${i}`;
      row.getBoundingClientRect = () => ({ top: tops[i], bottom: tops[i] + 60, height: 60 }) as DOMRect;
      root.append(row);
    }
    const callback = vi.fn();
    const hook = renderHook(() => useVisibleChatMessageIds({ current: root }, callback));
    act(() => vi.advanceTimersByTime(120));
    expect(callback).toHaveBeenLastCalledWith(['m1']);
    tops = [120, -500, 600];
    act(() => { root.dispatchEvent(new Event('scroll')); root.dispatchEvent(new Event('scroll')); vi.advanceTimersByTime(120); });
    expect(callback).toHaveBeenCalledTimes(2);
    expect(callback).toHaveBeenLastCalledWith(['m0']);
    act(() => root.dispatchEvent(new Event('scroll')));
    hook.unmount();
    act(() => vi.advanceTimersByTime(200));
    expect(callback).toHaveBeenCalledTimes(2);
  });
});