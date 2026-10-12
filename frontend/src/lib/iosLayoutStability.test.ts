import { afterEach, describe, expect, it } from 'vitest';
import { readSafeAreaInsetTopPx } from './iosLayoutStability';

afterEach(() => document.documentElement.style.removeProperty('--safe-area-inset-top'));

describe('Android remaining top inset', () => {
  it('adds no extra space when Android already reserves the status bar', () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '0px');
    expect(readSafeAreaInsetTopPx()).toBe(0);
  });

  it('reserves the actual reported inset for an edge-to-edge WebView', () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '28px');
    expect(readSafeAreaInsetTopPx()).toBe(28);
  });
});