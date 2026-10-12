import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useLocation: () => ({ pathname: '/' }) }));
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
}));
vi.mock('@capacitor/app', () => ({ App: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));
vi.mock('@capacitor/keyboard', () => ({ Keyboard: { addListener: vi.fn().mockResolvedValue({ remove: vi.fn() }) } }));
vi.mock('@/lib/statusBarControl', () => ({ applyStatusBar: vi.fn(), refreshStatusBar: vi.fn() }));

import { StatusBarManager } from './StatusBarManager';

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
});

describe('Android header inset ownership', () => {
  it('does not force an extra 24px gap when Android reserves the top inset', async () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '0px');
    render(<StatusBarManager />);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--safe-area-top')).toBe('0px'));
  });

  it('keeps the reported top inset when Android passes it to the WebView', async () => {
    document.documentElement.style.setProperty('--safe-area-inset-top', '28px');
    render(<StatusBarManager />);
    await waitFor(() => expect(document.documentElement.style.getPropertyValue('--safe-area-top')).toBe('28px'));
  });
});