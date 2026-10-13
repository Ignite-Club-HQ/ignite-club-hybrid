import { readFileSync } from 'node:fs';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { isNativeIiCallback, readNativeIiReply } from './nativeInternetIdentity';

const script = readFileSync('public/native-sign-in.js', 'utf8');
const PK = 'ab'.repeat(44);
type BridgeWindow = Window & { __igniteBridgeNavigate?: (u: string) => void; __igniteBridgeOpenApp?: (u: string) => void };
const w = window as BridgeWindow;
const b64 = (hex: string) => btoa(String.fromCharCode(...hex.match(/../g)!.map((h) => parseInt(h, 16))));

let navigated: string[];
let opened: string[];

function firstLeg(): URLSearchParams {
  window.location.hash = '#pk=' + PK + '&n=testnonce123&cb=com.igniteclubhq.app%3A%2F%2Fii-callback';
  window.eval(script);
  return new URLSearchParams(navigated[0].split('#')[1]);
}

beforeEach(() => {
  document.body.innerHTML = '<h1 id="title"></h1><p id="msg"></p><button id="go" hidden></button><a id="back" hidden></a>';
  sessionStorage.clear();
  navigated = [];
  opened = [];
  w.__igniteBridgeNavigate = (u) => navigated.push(u);
  w.__igniteBridgeOpenApp = (u) => opened.push(u);
  vi.spyOn(window, 'open');
});
afterEach(() => { vi.restoreAllMocks(); delete w.__igniteBridgeNavigate; delete w.__igniteBridgeOpenApp; });

describe('native browser bridge', () => {
  it('goes straight to Internet Identity in the same tab, with no pop-up', () => {
    const fragment = firstLeg();
    expect(window.open).not.toHaveBeenCalled();
    expect(navigated[0].startsWith('https://id.ai/authorize#')).toBe(true);
    const request = JSON.parse(fragment.get('message')!);
    expect(request.method).toBe('icrc34_delegation');
    expect(request.params.publicKey).toBe(b64(PK));
    expect(fragment.get('callback')).toBe(window.location.origin + window.location.pathname);
  });

  it('hands the delegation back to the app on return', () => {
    const fragment = firstLeg();
    const state = fragment.get('state')!;
    const reply = { jsonrpc: '2.0', id: state, result: { publicKey: b64('cd'.repeat(20)), signerDelegation: [{ delegation: { pubkey: b64(PK), expiration: '1700000000000000000' }, signature: b64('ef'.repeat(32)) }] } };
    document.body.innerHTML = '<h1 id="title"></h1><p id="msg"></p><button id="go" hidden></button><a id="back" hidden></a>';
    window.location.hash = '#' + new URLSearchParams({ message: JSON.stringify(reply), state }).toString();
    window.eval(script);
    expect(opened).toHaveLength(1);
    const params = readNativeIiReply(opened[0]);
    expect(params.get('n')).toBe('testnonce123');
    expect(params.get('d')).toBeTruthy();
    expect(window.location.hash).toBe('');
  });

  it('refuses a delegation to a different key', () => {
    const state = firstLeg().get('state')!;
    const reply = { jsonrpc: '2.0', id: state, result: { publicKey: b64('cd'.repeat(20)), signerDelegation: [{ delegation: { pubkey: b64('11'.repeat(44)), expiration: '1700000000000000000' }, signature: b64('ef'.repeat(32)) }] } };
    window.location.hash = '#' + new URLSearchParams({ message: JSON.stringify(reply), state }).toString();
    window.eval(script);
    expect(opened).toHaveLength(0);
    expect(document.getElementById('msg')?.className).toBe('err');
  });

  it('provides a real nonce-scoped cancellation return', () => {
    firstLeg();
    expect(document.getElementById('back')?.getAttribute('href')).toBe('com.igniteclubhq.app://ii-callback?n=testnonce123&cancel=1');
    expect(document.getElementById('back')?.hidden).toBe(false);
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
