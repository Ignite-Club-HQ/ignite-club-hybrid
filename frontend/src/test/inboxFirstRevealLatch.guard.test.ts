/**
 * Guards the Messages inbox first-reveal latch.
 *
 * The initial ordering gate (which depends on `isFetching`) must apply only
 * before the first settled reveal. After the inbox has painted, ordinary
 * background/Realtime refetches must never bring the full-page skeleton back
 * or unmount conversation rows.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const messages = readFileSync(
  path.resolve(__dirname, "../pages/MessagesPage.tsx"),
  "utf8",
);

describe("inbox first-reveal latch", () => {
  it("declares an explicit per-mount reveal latch", () => {
    expect(messages).toMatch(/hasRevealedStableInboxRef/);
    expect(messages).toMatch(/hasRevealedStableInbox/);
  });

  it("gates the skeleton on the latch, not on raw fetching state", () => {
    expect(messages).toMatch(
      /const showSkeletonLoading = isOnline && !hasRevealedStableInboxRef\.current && initialRevealBlocked/,
    );
  });

  it("keeps ordering readiness separate from the permanent render decision", () => {
    expect(messages).toMatch(/const freshSortDataReady = !isOnline \|\|/);
    expect(messages).toMatch(/const initialRevealBlocked =\s*\n?\s*isOnline &&/);
    expect(messages).toMatch(/loading: isLoadingFreshData, orderReady: freshSortDataReady/);
  });

  it("keeps the session latch and passes scoped cached rows to the ICP reveal policy", () => {
    expect(messages).toMatch(/let sessionRevealedInboxUserId: string \| null = null;/);
    // ICP can reveal saved rows on first entry; Supabase ordering is retained
    // by the separately tested reveal policy.
    const gate = messages.slice(
      messages.indexOf("const initialRevealBlocked ="),
      messages.indexOf("useEffect(() => {\n    if (hasRevealedStableInboxRef.current) return;"),
    );
    expect(gate).toMatch(/shouldBlockInboxReveal/);
    expect(gate).toMatch(/icp: useIcpLab/);
    expect(gate).toMatch(/hasRows: !!hasCachedData \|\| hasAnyDisplayData/);
    // The cache is still consulted for the *loading* half of the gate, so a
    // cached inbox never waits on query loading state.
    expect(messages).toMatch(
      /const isLoadingFreshData = !hasAnyDisplayData && !hasCachedData &&/,
    );
  });


  it("latches once and only resets on an identity change", () => {
    expect(messages).toMatch(/revealLatchIdentityRef/);
    expect(messages).toMatch(/hasRevealedStableInboxRef\.current = true/);
  });

  it("still shows the offline cached inbox immediately", () => {
    expect(messages).toMatch(/const showSkeletonLoading = isOnline &&/);
  });
});
