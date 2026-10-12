import { beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  backdrop: vi.fn().mockResolvedValue(undefined),
  show: vi.fn().mockResolvedValue(undefined),
  overlay: vi.fn().mockResolvedValue(undefined),
  color: vi.fn().mockResolvedValue(undefined),
  style: vi.fn().mockResolvedValue(undefined),
  systemStyle: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => true, getPlatform: () => 'android' },
  registerPlugin: () => ({ setBackgroundColor: native.backdrop }),
  SystemBars: { setStyle: native.systemStyle },
  SystemBarsStyle: { Dark: 'DARK', Light: 'LIGHT' },
  SystemBarType: { StatusBar: 'StatusBar' },
}));
vi.mock('@capacitor/status-bar', () => ({
  StatusBar: { show: native.show, setOverlaysWebView: native.overlay, setBackgroundColor: native.color, setStyle: native.style },
  Style: { Dark: 'DARK', Light: 'LIGHT' },
}));

describe('Android transparent system-bar backdrop', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('paints the native light backdrop and applies readable dark icons', async () => {
    const { applyStatusBar } = await import('./statusBarControl');
    applyStatusBar('light', true);
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalledWith({ bar: 'StatusBar', style: 'LIGHT' }));
    expect(native.backdrop).toHaveBeenCalledWith({ color: '#f5f7f6' });
    expect(native.backdrop.mock.invocationCallOrder.at(-1)).toBeGreaterThan(native.systemStyle.mock.invocationCallOrder.at(-1) ?? 0);
  });

  it('restores the dark backdrop and light icons after a viewer', async () => {
    const { applyStatusBar, applyStatusBarForViewer } = await import('./statusBarControl');
    applyStatusBarForViewer();
    applyStatusBar('dark', true);
    await vi.waitFor(() => expect(native.backdrop).toHaveBeenLastCalledWith({ color: '#0f1512' }));
    await vi.waitFor(() => expect(native.systemStyle).toHaveBeenCalledTimes(2));
    expect(native.backdrop).toHaveBeenNthCalledWith(1, { color: '#000000' });
    expect(native.systemStyle).toHaveBeenLastCalledWith({ bar: 'StatusBar', style: 'DARK' });
    expect(native.backdrop.mock.invocationCallOrder.at(-1)).toBeGreaterThan(native.systemStyle.mock.invocationCallOrder.at(-1) ?? 0);
  });
});