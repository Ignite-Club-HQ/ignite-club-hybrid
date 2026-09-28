import { describe, expect, it } from "vitest";
import {
  resolveInboxRevealPolicy,
  type InboxRevealPolicyInput,
  type InboxSortSourceState,
} from "./inboxRevealPolicy";

const settled: InboxSortSourceState = {
  isFetched: true,
  isFetching: false,
  isError: false,
};

const pending: InboxSortSourceState = {
  isFetched: false,
  isFetching: true,
  isError: false,
};

function input(overrides: Partial<InboxRevealPolicyInput> = {}): InboxRevealPolicyInput {
  return {
    isOnline: true,
    hasAnyDisplayData: false,
    hasCachedData: false,
    hasLoadingSource: true,
    sortSources: [settled, settled, settled, settled, settled],
    sortGateExpired: false,
    hasRevealedStableInbox: false,
    ...overrides,
  };
}

describe("resolveInboxRevealPolicy", () => {
  it("blocks a cold online reveal while any ordering source is in flight", () => {
    const policy = resolveInboxRevealPolicy(input({
      sortSources: [settled, pending, settled, settled, settled],
    }));
    expect(policy).toMatchObject({
      sortSourcesSettled: false,
      isLoadingFreshData: true,
      initialRevealBlocked: true,
      showSkeletonLoading: true,
    });
  });

  it("does not treat isFetched initial data as settled while it is refetching", () => {
    const policy = resolveInboxRevealPolicy(input({
      hasCachedData: true,
      sortSources: [{ isFetched: true, isFetching: true, isError: false }],
    }));
    expect(policy.isLoadingFreshData).toBe(false);
    expect(policy.sortSourcesSettled).toBe(false);
    expect(policy.showSkeletonLoading).toBe(true);
  });

  it("releases the first reveal after every ordering source settles", () => {
    const policy = resolveInboxRevealPolicy(input({ hasLoadingSource: false }));
    expect(policy.sortSourcesSettled).toBe(true);
    expect(policy.initialRevealBlocked).toBe(false);
    expect(policy.showSkeletonLoading).toBe(false);
  });

  it("treats a completed error as settled so connectivity failures cannot wedge the inbox", () => {
    const policy = resolveInboxRevealPolicy(input({
      hasLoadingSource: false,
      sortSources: [{ isFetched: false, isFetching: false, isError: true }],
    }));
    expect(policy.sortSourcesSettled).toBe(true);
    expect(policy.showSkeletonLoading).toBe(false);
  });

  it("releases cached conversations immediately while offline", () => {
    const policy = resolveInboxRevealPolicy(input({
      isOnline: false,
      hasCachedData: true,
      sortSources: [pending],
    }));
    expect(policy.freshSortDataReady).toBe(true);
    expect(policy.initialRevealBlocked).toBe(false);
    expect(policy.showSkeletonLoading).toBe(false);
  });

  it("releases the hard ceiling even when an online source remains in flight", () => {
    const policy = resolveInboxRevealPolicy(input({
      hasLoadingSource: false,
      sortSources: [pending],
      sortGateExpired: true,
    }));
    expect(policy.freshSortDataReady).toBe(true);
    expect(policy.showSkeletonLoading).toBe(false);
  });

  it("never restores the full-page skeleton after the stable reveal latch is set", () => {
    const policy = resolveInboxRevealPolicy(input({
      sortSources: [pending],
      hasRevealedStableInbox: true,
    }));
    expect(policy.initialRevealBlocked).toBe(true);
    expect(policy.showSkeletonLoading).toBe(false);
  });

  it("does not let stale cached ordering bypass the first online reveal gate", () => {
    const policy = resolveInboxRevealPolicy(input({
      hasCachedData: true,
      hasLoadingSource: false,
      sortSources: [pending],
    }));
    expect(policy.isLoadingFreshData).toBe(false);
    expect(policy.initialRevealBlocked).toBe(true);
    expect(policy.showSkeletonLoading).toBe(true);
  });
});
