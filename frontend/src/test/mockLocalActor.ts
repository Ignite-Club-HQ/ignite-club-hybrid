/**
 * Shared ICP test double.
 *
 * No test in this repo may connect to a real local replica (dfx/PocketIC).
 * The lab's hybrid services are already built around an injectable
 * `BackendProviders<T>` seam (see src/lab/hybridClubLinksService.ts and the
 * imported-*-baseline.test.tsx files) - the ICP "provider" is just an async
 * function the test supplies, so it never has to touch a canister. This
 * helper standardises that pattern instead of every test re-inventing it,
 * and provides a fake transport for the rarer case where a test needs to go
 * through `createLocalAgent`/`createLocalActor` (src/lab/localActor.ts)
 * directly.
 *
 * Usage (preferred - provider-level, matches existing baseline tests):
 *
 *   import { createFakeBackendProviders } from "@/test/mockLocalActor";
 *   const providers = createFakeBackendProviders<MyServiceType>({
 *     icp: () => myFakeIcpService,
 *     supabase: () => myFakeSupabaseService,
 *   });
 *
 * Usage (lower-level - only if a test must exercise createLocalAgent itself):
 *
 *   import { createFakeIcpTransport } from "@/test/mockLocalActor";
 *   const transport = createFakeIcpTransport({ onRequest: () => new Response(...) });
 *   const agent = await createLocalAgent(config, "persona", origin, transport);
 */
import { vi } from "vitest";
import type { Principal } from "@icp-sdk/core/principal";

export type FakeBackendProviders<T> = {
  supabase: (environment: string) => Promise<T>;
  icp: (canister: Principal) => Promise<T>;
};

/** Builds a `BackendProviders<T>`-shaped object backed entirely by in-memory
 * factories - no network, no real canister, no real Supabase project. */
export function createFakeBackendProviders<T>(factories: {
  icp: (canister: Principal) => T | Promise<T>;
  supabase: (environment: string) => T | Promise<T>;
}): FakeBackendProviders<T> {
  return {
    icp: vi.fn(async (canister: Principal) => factories.icp(canister)),
    supabase: vi.fn(async (environment: string) => factories.supabase(environment)),
  };
}

/**
 * A `transport: typeof fetch` replacement for `createLocalAgent`/
 * `createLocalActor` that never performs real I/O. By default every request
 * rejects (fail-closed, matching "missing ICP implementation never falls
 * back"); pass `onRequest` to return canned responses for specific tests.
 */
export function createFakeIcpTransport(options?: {
  onRequest?: (input: RequestInfo | URL, init?: RequestInit) => Response | Promise<Response>;
}): typeof fetch {
  const handler = options?.onRequest;
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    if (handler) return handler(input, init);
    throw new Error(
      "Fake ICP transport received a request with no onRequest handler configured - " +
        "local canister calls must never reach a real replica in tests.",
    );
  }) as unknown as typeof fetch;
}
