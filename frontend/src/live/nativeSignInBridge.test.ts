import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { isNativeIiCallback, readNativeIiReply } from './nativeInternetIdentity';

const script = readFileSync('public/native-sign-in.js', 'utf8');
const popup = { postMessage: vi.fn(), close: vi.fn(), closed: false };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = '<h1 id="title"></h1><p id="msg"></p><button id="go"></button><a id="back" hidden></a>';
  window.location.hash = '#pk=' + 'ab'.repeat(44) + '&n=testnonce123&cb=com.igniteclubhq.app%3A%2F%2Fii-callback';
  popup.closed = false;
  vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('native browser bridge', () => {
  it('opens the provider by itself, without an extra tap', () => {
    window.eval(script);
    expect(window.open).toHaveBeenCalledWith('https://id.ai/authorize', 'ii-signin', 'width=500,height=720');
  });

  it('shows one Continue button when the browser blocks the automatic window', () => {
    vi.mocked(window.open).mockReturnValueOnce(null);
    window.eval(script);
    const go = document.getElementById('go') as HTMLButtonElement;
    expect(go.hidden).toBe(false);
    expect(go.disabled).toBe(false);
    expect(document.getElementById('msg')?.className).not.toBe('err');
  });

  it('opens the current provider and accepts its ready message', () => {
    const listeners: EventListener[] = [];
    const original = window.addEventListener.bind(window);
    vi.spyOn(window, 'addEventListener').mockImplementation((type, listener, options) => {
      if (type === 'message' && typeof listener === 'function') listeners.push(listener as EventListener);
      else original(type, listener, options);
    });
    window.eval(script);
    expect(window.open).toHaveBeenCalledWith('https://id.ai/authorize', 'ii-signin', 'width=500,height=720');
    const ready = new MessageEvent('message', { origin: 'https://id.ai', source: popup as unknown as Window, data: { kind: 'authorize-ready' } });
    listeners.forEach(fn => fn(ready));
    expect(popup.postMessage).toHaveBeenCalledWith(expect.objectContaining({ kind: 'authorize-client', sessionPublicKey: expect.any(Uint8Array) }), 'https://id.ai');
    popup.postMessage.mockClear();
    listeners.forEach(fn => fn(new MessageEvent('message', { origin: 'https://evil.example', source: popup as unknown as Window, data: { kind: 'authorize-ready' } })));
    expect(popup.postMessage).not.toHaveBeenCalled();
  });

  it('provides a real nonce-scoped cancellation return before signing in', () => {
    window.eval(script);
    expect(document.getElementById('back')?.getAttribute('href')).toBe('com.igniteclubhq.app://ii-callback?n=testnonce123&cancel=1');
    expect(document.getElementById('back')?.hidden).toBe(false);
  });

  it('releases Continue after the authorization window closes', () => {
    window.eval(script);
    popup.closed = true;
    vi.advanceTimersByTime(500);
    expect((document.getElementById('go') as HTMLButtonElement).disabled).toBe(false);
  });

  it('accepts only the exact native callback destination', () => {
    expect(isNativeIiCallback('com.igniteclubhq.app://ii-callback#n=test')).toBe(true);
    expect(isNativeIiCallback('com.igniteclubhq.app://ii-callback.evil#n=test')).toBe(false);
    expect(isNativeIiCallback('com.igniteclubhq.app://ii-callback/other')).toBe(false);
    expect(isNativeIiCallback('com.igniteclubhq.app://ii-callback?n=test&d=abc')).toBe(true);
  });

  it('reads the reply from the query (Android) or the hash (older bridge)', () => {
    expect(readNativeIiReply('com.igniteclubhq.app://ii-callback?n=abc&d=xyz').get('d')).toBe('xyz');
    expect(readNativeIiReply('com.igniteclubhq.app://ii-callback#n=abc&cancel=1').get('cancel')).toBe('1');
  });
});