import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards for two cold-start defects:
 *  1. Login screen flashed during a notification cold start because the route
 *     guard redirected to /auth while the stored session was still restoring.
 *  2. The inbox painted cached (stale) ordering and then re-sorted, because
 *     React Query reports `isFetched` immediately when `initialData` is set.
 */
const auth = readFileSync(join(__dirname, "../hooks/useAuth.tsx"), "utf8");
const layout = readFileSync(join(__dirname, "../components/layout/AppLayout.tsx"), "utf8");
const messages = readFileSync(join(__dirname, "../pages/MessagesPage.tsx"), "utf8");

describe("cold-start auth flash guard", () => {
  it("auth exposes an explicit session-restoration state", () => {
    expect(auth).toMatch(/sessionRestoration: "restoring" \| "authenticated" \| "signed_out"/);
    expect(auth).toMatch(/setSessionRestoration\("authenticated"\)/);
    expect(auth).toMatch(/setSessionRestoration\("signed_out"\)/);
  });

  it("layout blocks the /auth redirect while the session is restoring", () => {
    expect(layout).toMatch(/isRestoringSession/);
    expect(layout).toMatch(/!user && isRestoringSession/);
    expect(layout).toMatch(/Checking authentication\.\.\./);
  });

  it("the restoring state cannot trap the user forever", () => {
    expect(layout).toMatch(/authRestoreExpired/);
  });
});

describe("inbox first-paint ordering guard", () => {
  it("waits for in-flight fetches, not just isFetched, before revealing rows", () => {
    expect(messages).toMatch(/sortSourcesSettled/);
    expect(messages).toMatch(/!teamsFetching/);
    expect(messages).toMatch(/!memberClubsFetching/);
    expect(messages).toMatch(/!chatGroupsFetching/);
    expect(messages).toMatch(/!latestBroadcastFetching/);
    expect(messages).toMatch(/!dmFetching/);
  });

  it("keeps a hard ceiling so the skeleton always releases", () => {
    expect(messages).toMatch(/sortGateExpired/);
  });

  it("still bypasses the gate entirely when offline", () => {
    expect(messages).toMatch(/const freshSortDataReady = !isOnline \|\|/);
  });
});
