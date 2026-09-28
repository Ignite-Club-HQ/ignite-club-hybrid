import { describe, it, expect, vi, beforeEach } from "vitest";

const state = {
  refreshCalls: 0,
  session: { access_token: "new", user: { id: "u1" } } as any,
  refreshImpl: null as null | (() => Promise<any>),
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      refreshSession: async () => {
        state.refreshCalls += 1;
        if (state.refreshImpl) return state.refreshImpl();
        await new Promise((r) => setTimeout(r, 20));
        return { data: { session: state.session }, error: null };
      },
      getSession: async () => ({ data: { session: state.session }, error: null }),
    },
  },
}));

import { refreshSessionOnce, __resetRefreshSessionOnce, isStaleRefreshTokenError } from "./refreshSessionOnce";

describe("refreshSessionOnce", () => {
  beforeEach(() => {
    state.refreshCalls = 0;
    state.refreshImpl = null;
    state.session = { access_token: "new", user: { id: "u1" } };
    __resetRefreshSessionOnce();
  });

  it("fires exactly one refresh for concurrent callers and shares the result", async () => {
    const [a, b, c] = await Promise.all([
      refreshSessionOnce(),
      refreshSessionOnce(),
      refreshSessionOnce(),
    ]);
    expect(state.refreshCalls).toBe(1);
    expect(a.session?.access_token).toBe("new");
    expect(b.session?.access_token).toBe("new");
    expect(c.session?.access_token).toBe("new");
    expect([a.shared, b.shared, c.shared].filter(Boolean).length).toBe(2);
    expect(a.error).toBeNull();
  });

  it("treats a rotated-refresh-token failure as benign when a session exists", async () => {
    state.refreshImpl = async () => ({
      data: { session: null },
      error: { message: "Invalid Refresh Token: Already Used", code: "refresh_token_already_used" },
    });
    const res = await refreshSessionOnce();
    expect(res.error).toBeNull();
    expect(res.benign).toBe(true);
    expect(res.session?.access_token).toBe("new");
  });

  it("surfaces a genuine rejection when no session remains", async () => {
    state.session = null;
    state.refreshImpl = async () => ({
      data: { session: null },
      error: { message: "invalid grant", code: "invalid_grant" },
    });
    const res = await refreshSessionOnce();
    expect(res.session).toBeNull();
    expect(res.error).toBeTruthy();
    expect(res.benign).toBe(false);
  });

  it("allows a new refresh after the previous one settles", async () => {
    await refreshSessionOnce();
    await refreshSessionOnce();
    expect(state.refreshCalls).toBe(2);
  });

  it("classifies stale refresh token errors", () => {
    expect(isStaleRefreshTokenError({ code: "refresh_token_not_found" })).toBe(true);
    expect(isStaleRefreshTokenError({ message: "Refresh Token Not Found" })).toBe(true);
    expect(isStaleRefreshTokenError({ message: "boom" })).toBe(false);
  });
});
