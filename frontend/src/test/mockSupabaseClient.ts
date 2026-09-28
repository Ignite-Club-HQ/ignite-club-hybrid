/**
 * Shared Supabase test double.
 *
 * Every test in this repo must be able to run without a real Supabase
 * project - there is none, and `src/integrations/supabase/client.ts` is a
 * fail-closed stub for exactly that reason. Individual test files still
 * need to control specific return values/errors for their scenario, so this
 * helper gives them a consistent, fully-typed vi.fn() surface instead of
 * each file hand-rolling a slightly different shape.
 *
 * Usage:
 *
 *   import { createMockSupabaseClient } from "@/test/mockSupabaseClient";
 *   const mockSupabase = createMockSupabaseClient();
 *   vi.mock("@/integrations/supabase/client", () => ({ supabase: mockSupabase }));
 *   // ...
 *   mockSupabase.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });
 *
 * Nothing returned by this factory ever performs network I/O - every method
 * is a vi.fn() that resolves to a safe default until a test overrides it.
 */
import { vi } from "vitest";

export interface MockSupabaseAuth {
  getSession: ReturnType<typeof vi.fn>;
  getUser: ReturnType<typeof vi.fn>;
  signUp: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
  signInWithPassword: ReturnType<typeof vi.fn>;
  signInWithOAuth: ReturnType<typeof vi.fn>;
  resetPasswordForEmail: ReturnType<typeof vi.fn>;
  exchangeCodeForSession: ReturnType<typeof vi.fn>;
  updateUser: ReturnType<typeof vi.fn>;
  verifyOtp: ReturnType<typeof vi.fn>;
  onAuthStateChange: ReturnType<typeof vi.fn>;
}

export interface MockSupabaseQueryBuilder {
  select: ReturnType<typeof vi.fn>;
  insert: ReturnType<typeof vi.fn>;
  update: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  upsert: ReturnType<typeof vi.fn>;
  eq: ReturnType<typeof vi.fn>;
  neq: ReturnType<typeof vi.fn>;
  in: ReturnType<typeof vi.fn>;
  is: ReturnType<typeof vi.fn>;
  not: ReturnType<typeof vi.fn>;
  gte: ReturnType<typeof vi.fn>;
  lte: ReturnType<typeof vi.fn>;
  order: ReturnType<typeof vi.fn>;
  limit: ReturnType<typeof vi.fn>;
  single: ReturnType<typeof vi.fn>;
  maybeSingle: ReturnType<typeof vi.fn>;
  then: (resolve: (value: { data: unknown; error: unknown }) => void) => void;
}

export interface MockSupabaseClient {
  auth: MockSupabaseAuth;
  from: ReturnType<typeof vi.fn>;
  rpc: ReturnType<typeof vi.fn>;
  channel: ReturnType<typeof vi.fn>;
  removeChannel: ReturnType<typeof vi.fn>;
  storage: {
    from: ReturnType<typeof vi.fn>;
  };
}

/** A chainable query builder stub. Every chain method returns `this`, and the
 * builder resolves (via `.single()`/`.maybeSingle()`/await) to the supplied
 * `result` - override it per test with `.mockResolvedValueOnce` style calls
 * by re-assigning `builder.single`/`builder.then`, or just read `result`. */
function createMockQueryBuilder(
  result: { data: unknown; error: unknown } = { data: null, error: null },
): MockSupabaseQueryBuilder {
  const builder: Partial<MockSupabaseQueryBuilder> = {};
  const chain = () => builder as MockSupabaseQueryBuilder;
  builder.select = vi.fn(chain);
  builder.insert = vi.fn(chain);
  builder.update = vi.fn(chain);
  builder.delete = vi.fn(chain);
  builder.upsert = vi.fn(chain);
  builder.eq = vi.fn(chain);
  builder.neq = vi.fn(chain);
  builder.in = vi.fn(chain);
  builder.is = vi.fn(chain);
  builder.not = vi.fn(chain);
  builder.gte = vi.fn(chain);
  builder.lte = vi.fn(chain);
  builder.order = vi.fn(chain);
  builder.limit = vi.fn(chain);
  builder.single = vi.fn(async () => result);
  builder.maybeSingle = vi.fn(async () => result);
  builder.then = (resolve) => resolve(result);
  return builder as MockSupabaseQueryBuilder;
}

export function createMockSupabaseClient(): MockSupabaseClient {
  const auth: MockSupabaseAuth = {
    getSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    getUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    signUp: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signOut: vi.fn(async () => ({ error: null })),
    signInWithPassword: vi.fn(async () => ({ data: { user: null, session: null }, error: null })),
    signInWithOAuth: vi.fn(async () => ({ data: { provider: null, url: null }, error: null })),
    resetPasswordForEmail: vi.fn(async () => ({ data: {}, error: null })),
    exchangeCodeForSession: vi.fn(async () => ({ data: { session: null }, error: null })),
    updateUser: vi.fn(async () => ({ data: { user: null }, error: null })),
    verifyOtp: vi.fn(async () => ({ data: { session: null, user: null }, error: null })),
    onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe() {} } } })),
  };

  const channelStub = {
    on: vi.fn(function (this: unknown) {
      return this;
    }),
    subscribe: vi.fn(function (this: unknown) {
      return this;
    }),
    unsubscribe: vi.fn(async () => "ok"),
  };

  return {
    auth,
    from: vi.fn(() => createMockQueryBuilder()),
    rpc: vi.fn(async () => ({ data: null, error: null })),
    channel: vi.fn(() => channelStub),
    removeChannel: vi.fn(),
    storage: {
      from: vi.fn(() => ({
        upload: vi.fn(async () => ({ data: null, error: null })),
        download: vi.fn(async () => ({ data: null, error: null })),
        remove: vi.fn(async () => ({ data: null, error: null })),
        createSignedUrl: vi.fn(async () => ({ data: { signedUrl: "https://reference.invalid/signed" }, error: null })),
        getPublicUrl: vi.fn(() => ({ data: { publicUrl: "https://reference.invalid/public" } })),
      })),
    },
  };
}

export { createMockQueryBuilder };
