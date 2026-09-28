/**
 * Regression tests for the three passkey defects:
 *  1. `getStoredPasskeyAccounts` must sanitize localStorage payloads
 *     (reject non-arrays, filter malformed records).
 *  2. `authenticateWithPasskey` must NEVER return `{ success: true }` unless
 *     a real Supabase session was established via `setSession`.
 *  3. `usePasskey` must reject concurrent register/authenticate calls
 *     synchronously — no Edge Function invocation, no WebAuthn prompt.
 */
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';

// ---- supabase mock ---------------------------------------------------------
const invokeMock: any = vi.fn();
const setSessionMock: any = vi.fn();
const getSessionMock: any = vi.fn(async () => ({
  data: { session: { user: { id: 'u1', email: 'a@b.c', user_metadata: {} } } },
}));
const signInWithPasswordMock: any = vi.fn(async () => ({ error: null }));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    functions: { invoke: (fn: any, opts: any) => invokeMock(fn, opts) },
    auth: {
      getSession: () => getSessionMock(),
      setSession: (args: any) => setSessionMock(args),
      signInWithPassword: (args: any) => signInWithPasswordMock(args),
    },
    from: () => ({ select: () => ({ eq: () => ({ data: [], error: null }) }) }),
  },
}));

// ---- Capacitor mock (default: web) ----------------------------------------
const isNativeMock = vi.fn(() => false);
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: () => isNativeMock() },
}));

// SUT — imported after mocks
import {
  usePasskey,
  getStoredPasskeyAccounts,
  PASSKEY_IN_PROGRESS_ERROR,
} from './usePasskey';

const KEY = 'ignite_passkey_accounts';

// WebAuthn credential mock
const fakeCredential = () => ({
  id: 'cred-1',
  rawId: new ArrayBuffer(4),
  type: 'public-key',
  response: {
    clientDataJSON: new ArrayBuffer(4),
    authenticatorData: new ArrayBuffer(4),
    signature: new ArrayBuffer(4),
    userHandle: null,
    attestationObject: new ArrayBuffer(4),
  },
});

beforeEach(() => {
  localStorage.clear();
  invokeMock.mockReset();
  setSessionMock.mockReset();
  setSessionMock.mockResolvedValue({ error: null });
  isNativeMock.mockReturnValue(false);

  // navigator.credentials
  (globalThis as any).navigator = (globalThis as any).navigator || {};
  (navigator as any).credentials = {
    get: vi.fn(async () => fakeCredential()),
    create: vi.fn(async () => fakeCredential()),
  };
  (window as any).PublicKeyCredential = class {
    static isUserVerifyingPlatformAuthenticatorAvailable = async () => true;
  };
});

afterEach(() => {
  vi.clearAllMocks();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. getStoredPasskeyAccounts — payload sanitization
// ═══════════════════════════════════════════════════════════════════════════
describe('getStoredPasskeyAccounts (defect #1)', () => {
  it('returns [] when localStorage is empty', () => {
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('returns [] when JSON is invalid', () => {
    localStorage.setItem(KEY, '{not-json');
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('returns [] when payload is a JSON object (not array)', () => {
    localStorage.setItem(KEY, JSON.stringify({ email: 'x@y.z' }));
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('returns [] when payload is a JSON string', () => {
    localStorage.setItem(KEY, JSON.stringify('nope'));
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('returns [] when payload is a JSON number', () => {
    localStorage.setItem(KEY, JSON.stringify(42));
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('filters out entries missing email', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { addedAt: '2025-01-01' },
      { email: 'ok@x.y', addedAt: '2025-01-01' },
    ]));
    expect(getStoredPasskeyAccounts()).toEqual([{ email: 'ok@x.y', addedAt: '2025-01-01' }]);
  });

  it('filters out entries with empty email string', () => {
    localStorage.setItem(KEY, JSON.stringify([{ email: '', addedAt: '2025-01-01' }]));
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('filters out entries missing addedAt', () => {
    localStorage.setItem(KEY, JSON.stringify([{ email: 'x@y.z' }]));
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('filters out entries where email is not a string', () => {
    localStorage.setItem(KEY, JSON.stringify([{ email: 123, addedAt: '2025' }]));
    expect(getStoredPasskeyAccounts()).toEqual([]);
  });

  it('filters out null / non-object entries', () => {
    localStorage.setItem(KEY, JSON.stringify([null, 'a', 5, { email: 'ok@x.y', addedAt: 't' }]));
    expect(getStoredPasskeyAccounts()).toEqual([{ email: 'ok@x.y', addedAt: 't' }]);
  });

  it('rejects displayName with wrong type but keeps other records', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { email: 'a@x.y', addedAt: 't', displayName: 42 },
      { email: 'b@x.y', addedAt: 't' },
    ]));
    expect(getStoredPasskeyAccounts()).toEqual([{ email: 'b@x.y', addedAt: 't' }]);
  });

  it('preserves valid displayName', () => {
    localStorage.setItem(KEY, JSON.stringify([
      { email: 'a@x.y', addedAt: 't', displayName: 'Alice' },
    ]));
    expect(getStoredPasskeyAccounts()).toEqual([
      { email: 'a@x.y', addedAt: 't', displayName: 'Alice' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. authenticateWithPasskey — session establishment
// ═══════════════════════════════════════════════════════════════════════════
describe('authenticateWithPasskey session guarantees (defect #2)', () => {
  const setupVerify = (verifyResp: any) => {
    invokeMock.mockImplementation((_fn: string, { body }: any) => {
      if (body.action === 'get-options') {
        return Promise.resolve({
          data: {
            options: { challenge: 'AAAA', rpId: 'x', allowCredentials: [], timeout: 60000 },
            discoverable: false,
          },
          error: null,
        });
      }
      return Promise.resolve({ data: verifyResp, error: null });
    });
  };

  it('returns success only when a full session is returned AND setSession succeeds', async () => {
    setupVerify({
      success: true,
      userEmail: 'u@x.y',
      session: { access_token: 'a', refresh_token: 'r' },
    });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(true);
    expect(setSessionMock).toHaveBeenCalledWith({ access_token: 'a', refresh_token: 'r' });
  });

  it('fails when backend returns success=true but NO session object', async () => {
    setupVerify({ success: true, userEmail: 'u@x.y' });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(false);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('fails when session lacks access_token', async () => {
    setupVerify({ success: true, session: { refresh_token: 'r' } });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(false);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('fails when session lacks refresh_token', async () => {
    setupVerify({ success: true, session: { access_token: 'a' } });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(false);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('fails when tokens are empty strings', async () => {
    setupVerify({ success: true, session: { access_token: '', refresh_token: '' } });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(false);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('fails when tokens are non-string types', async () => {
    setupVerify({ success: true, session: { access_token: 123, refresh_token: null } });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(false);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('fails when setSession itself returns an error', async () => {
    setupVerify({ success: true, session: { access_token: 'a', refresh_token: 'r' } });
    setSessionMock.mockResolvedValueOnce({ error: { message: 'bad' } });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(false);
  });

  it('surfaces backend failure without invoking setSession', async () => {
    setupVerify({ success: false, error: 'bad sig' });
    const { result } = renderHook(() => usePasskey());
    let res: any;
    await act(async () => { res = await result.current.authenticateWithPasskey('u@x.y'); });
    expect(res.success).toBe(false);
    expect(setSessionMock).not.toHaveBeenCalled();
  });

  it('re-enables the loading flag after failure so the button can retry', async () => {
    setupVerify({ success: true }); // missing session
    const { result } = renderHook(() => usePasskey());
    await act(async () => { await result.current.authenticateWithPasskey('u@x.y'); });
    await waitFor(() => expect(result.current.loading).toBe(false));
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. Concurrent-operation guard
// ═══════════════════════════════════════════════════════════════════════════
describe('concurrent passkey operations (defect #3)', () => {
  it('rejects a second authenticate call while the first is in-flight (no Edge invoke)', async () => {
    let releaseVerify: (v: any) => void = () => {};
    invokeMock.mockImplementation((_fn: string, { body }: any) => {
      if (body.action === 'get-options') {
        return Promise.resolve({
          data: { options: { challenge: 'AA', rpId: 'x', allowCredentials: [] } },
          error: null,
        });
      }
      return new Promise((r) => { releaseVerify = r; });
    });
    const { result } = renderHook(() => usePasskey());

    let firstDone: any = null;
    await act(async () => {
      const p1 = result.current.authenticateWithPasskey('u@x.y').then((v) => (firstDone = v));
      // Yield so the first call reaches the pending verify invoke.
      await new Promise((r) => setTimeout(r, 0));
      const callsBefore = invokeMock.mock.calls.length;
      const p2 = await result.current.authenticateWithPasskey('u@x.y');
      expect(p2).toEqual({ success: false, error: PASSKEY_IN_PROGRESS_ERROR });
      expect(invokeMock.mock.calls.length).toBe(callsBefore); // no new backend calls
      releaseVerify({
        data: { success: true, session: { access_token: 'a', refresh_token: 'r' } },
        error: null,
      });
      await p1;
    });
    expect(firstDone.success).toBe(true);
  });

  it('rejects a second register call while the first is in-flight', async () => {
    let release: (v: any) => void = () => {};
    invokeMock.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = renderHook(() => usePasskey());

    await act(async () => {
      const p1 = result.current.registerPasskey();
      const p2 = await result.current.registerPasskey();
      expect(p2).toEqual({ success: false, error: PASSKEY_IN_PROGRESS_ERROR });
      release({
        data: { success: true },
        error: null,
      });
      await p1;
    });
  });

  it('releases the guard after failure so the next call can proceed', async () => {
    invokeMock.mockResolvedValueOnce({ data: null, error: { message: 'boom' } });
    const { result } = renderHook(() => usePasskey());
    await act(async () => {
      const r1 = await result.current.authenticateWithPasskey('u@x.y');
      expect(r1.success).toBe(false);
    });
    // Now a second call should reach the backend
    invokeMock.mockImplementation((_fn: string, { body }: any) =>
      body.action === 'get-options'
        ? Promise.resolve({ data: { options: { challenge: 'AA', rpId: 'x', allowCredentials: [] } }, error: null })
        : Promise.resolve({ data: { success: true, session: { access_token: 'a', refresh_token: 'r' } }, error: null })
    );
    await act(async () => {
      const r2 = await result.current.authenticateWithPasskey('u@x.y');
      expect(r2.success).toBe(true);
    });
  });

  it('releases the guard after success so a follow-up call can proceed', async () => {
    invokeMock.mockImplementation((_fn: string, { body }: any) =>
      body.action === 'get-options'
        ? Promise.resolve({ data: { options: { challenge: 'AA', rpId: 'x', allowCredentials: [] } }, error: null })
        : Promise.resolve({ data: { success: true, session: { access_token: 'a', refresh_token: 'r' } }, error: null })
    );
    const { result } = renderHook(() => usePasskey());
    await act(async () => {
      await result.current.authenticateWithPasskey('u@x.y');
      const r2 = await result.current.authenticateWithPasskey('u@x.y');
      expect(r2.success).toBe(true);
    });
  });

  it('does NOT open WebAuthn prompt when a call is rejected by the guard', async () => {
    let release: (v: any) => void = () => {};
    invokeMock.mockImplementation(() => new Promise((r) => { release = r; }));
    const credGet = navigator.credentials.get as any;
    const { result } = renderHook(() => usePasskey());
    await act(async () => {
      const p1 = result.current.authenticateWithPasskey('u@x.y');
      const before = credGet.mock.calls.length;
      const p2 = await result.current.authenticateWithPasskey('u@x.y');
      expect(p2.success).toBe(false);
      expect(credGet.mock.calls.length).toBe(before);
      release({
        data: { success: true, session: { access_token: 'a', refresh_token: 'r' } },
        error: null,
      });
      await p1;
    });
  });

  it('blocks register while authenticate is in-flight (shared guard)', async () => {
    let release: (v: any) => void = () => {};
    invokeMock.mockImplementation(() => new Promise((r) => { release = r; }));
    const { result } = renderHook(() => usePasskey());
    await act(async () => {
      const p1 = result.current.authenticateWithPasskey('u@x.y');
      const r = await result.current.registerPasskey();
      expect(r).toEqual({ success: false, error: PASSKEY_IN_PROGRESS_ERROR });
      release({
        data: { success: true, session: { access_token: 'a', refresh_token: 'r' } },
        error: null,
      });
      await p1;
    });
  });
});
