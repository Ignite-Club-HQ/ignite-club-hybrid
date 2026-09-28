// Canonical test-environment setup that shipped with the imported test
// suite (jest-dom matchers, TouchEvent polyfill, RAF/performance wiring for
// fake timers) but was never referenced by any vitest config until now.
import './src/test/setup.ts';

// Minimal jsdom shims needed by the imported legacy test suite.
// jsdom does not implement these browser APIs; several component tests call
// them incidentally (e.g. on mount/scroll/media-query) and only need a
// deterministic no-op, not real scrolling/animation/media-query behavior.
if (typeof window !== 'undefined') {
  if (!window.scrollTo || !('__legacyShim' in window.scrollTo)) {
    const scrollTo = () => {};
    scrollTo.__legacyShim = true;
    window.scrollTo = scrollTo;
  }
  if (typeof window.HTMLElement !== 'undefined' && !window.HTMLElement.prototype.scrollIntoView) {
    window.HTMLElement.prototype.scrollIntoView = () => {};
  }
  if (typeof window.matchMedia !== 'function') {
    window.matchMedia = (query) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    });
  }
  if (typeof window.ResizeObserver !== 'function') {
    window.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  }
  if (typeof window.IntersectionObserver !== 'function') {
    window.IntersectionObserver = class {
      root = null;
      rootMargin = '';
      thresholds = [];
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return [];
      }
    };
  }
}

// Hard network guard: nothing in this suite may reach a real backend.
// Every Supabase or ICP call must go through an explicit vi.mock/vi.doMock
// (see src/test/mockSupabaseClient.ts and src/test/mockLocalActor.ts). If a
// module slips through without mocking its transport, fail fast with a clear
// message instead of hanging on a real network attempt or a timeout.
if (typeof globalThis.fetch === 'function') {
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((...args) => {
    const url = typeof args[0] === 'string' ? args[0] : (args[0] as Request | URL)?.toString?.() ?? '';
    if (/^https?:\/\/(?!127\.0\.0\.1|localhost)/i.test(url)) {
      return Promise.reject(
        new Error(
          `Blocked real network fetch to "${url}" from a legacy test. ` +
            'Mock the Supabase client (src/test/mockSupabaseClient.ts) or the ' +
            'transport this module uses instead of hitting a live endpoint.',
        ),
      );
    }
    return realFetch(...(args as Parameters<typeof fetch>));
  }) as typeof fetch;
}
