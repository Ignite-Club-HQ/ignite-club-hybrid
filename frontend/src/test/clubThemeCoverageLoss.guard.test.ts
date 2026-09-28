/**
 * Regression: after a coverage drop the club theme selector vanished, the theme
 * reverted to Ignite, and neither returned when the network came back.
 *
 * Two independent causes are locked down here:
 *  1. `useAuth`'s resume recovery treated a network-failed refreshSession() as an
 *     unrecoverable session and wiped the local user + query cache.
 *  2. Club/theme list queries accepted a 200-with-zero-rows response under a
 *     degraded session as truth, permanently replacing the cached club list.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { onlineManager } from "@tanstack/react-query";

let sessionResponse: any = {
  data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } },
  error: null,
};

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: async () => sessionResponse },
  },
}));

import { isTransientAuthFailure } from "@/lib/authRecoveryClassification";
import {
  guardClubListResult,
  resetClubListEmptyGuard,
  TransientEmptyClubListError,
} from "@/lib/clubListEmptyGuard";

describe("coverage-loss resilience for club theme", () => {
  beforeEach(() => {
    resetClubListEmptyGuard();
    onlineManager.setOnline(true);
    sessionResponse = {
      data: { session: { expires_at: Math.floor(Date.now() / 1000) + 3600 } },
      error: null,
    };
  });

  it("classifies network auth failures as transient (never a sign-out)", () => {
    expect(isTransientAuthFailure({ name: "AuthRetryableFetchError", status: 0 })).toBe(true);
    expect(isTransientAuthFailure(new TypeError("Failed to fetch"))).toBe(true);
    expect(isTransientAuthFailure({ message: "Network request failed" })).toBe(true);
    expect(isTransientAuthFailure({ code: "refresh_token_not_found", message: "Refresh Token Not Found", status: 400 })).toBe(false);
  });

  it("treats any failure as transient while offline", () => {
    onlineManager.setOnline(false);
    expect(isTransientAuthFailure({ code: "refresh_token_not_found" })).toBe(true);
    onlineManager.setOnline(true);
  });

  it("accepts empty club list when nothing was cached before", async () => {
    await expect(guardClubListResult("club-themes:u1", [])).resolves.toEqual([]);
  });

  it("rejects an empty club list after real data, while offline", async () => {
    await guardClubListResult("club-themes:u1", [{ clubId: "a" }]);
    onlineManager.setOnline(false);
    await expect(guardClubListResult("club-themes:u1", [])).rejects.toBeInstanceOf(TransientEmptyClubListError);
    onlineManager.setOnline(true);
  });

  it("rejects an empty club list when the session is missing or expired", async () => {
    await guardClubListResult("club-themes:u1", [{ clubId: "a" }]);

    sessionResponse = { data: { session: null }, error: null };
    await expect(guardClubListResult("club-themes:u1", [])).rejects.toBeInstanceOf(TransientEmptyClubListError);

    sessionResponse = {
      data: { session: { expires_at: Math.floor(Date.now() / 1000) - 10 } },
      error: null,
    };
    await expect(guardClubListResult("club-themes:u1", [])).rejects.toBeInstanceOf(TransientEmptyClubListError);
  });

  it("accepts a genuine empty list under a healthy online session", async () => {
    await guardClubListResult("club-themes:u1", [{ clubId: "a" }]);
    await expect(guardClubListResult("club-themes:u1", [])).resolves.toEqual([]);
  });
});
