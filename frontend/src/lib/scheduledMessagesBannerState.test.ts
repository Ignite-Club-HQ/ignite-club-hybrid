import { describe, it, expect } from "vitest";
import {
  classifyScheduledBanner,
  shouldShowInlineRefreshWarning,
  type ScheduledBannerInput,
} from "./scheduledMessagesBannerState";

const base: ScheduledBannerInput = {
  hasRows: false,
  isError: false,
  isFetching: false,
  isOnline: true,
};

describe("classifyScheduledBanner", () => {
  it("renders nothing when there is nothing to say", () => {
    expect(classifyScheduledBanner(base)).toBe("hidden");
  });

  it("renders the list whenever rows are known", () => {
    expect(classifyScheduledBanner({ ...base, hasRows: true })).toBe("list");
    expect(classifyScheduledBanner({ ...base, hasRows: true, isError: true })).toBe("list");
  });

  it("stays quiet while a retry is in flight", () => {
    expect(classifyScheduledBanner({ ...base, isError: true, isFetching: true })).toBe("hidden");
  });

  it("shows the offline notice instead of a failure when the device is offline", () => {
    expect(classifyScheduledBanner({ ...base, isError: true, isOnline: false })).toBe("offline");
  });

  it("shows the real warning only when online and retries are exhausted", () => {
    expect(classifyScheduledBanner({ ...base, isError: true })).toBe("error");
  });
});

describe("shouldShowInlineRefreshWarning", () => {
  it("only warns about a failed refresh when rows are visible and we are online", () => {
    expect(shouldShowInlineRefreshWarning({ ...base, hasRows: true, isError: true })).toBe(true);
    expect(
      shouldShowInlineRefreshWarning({ ...base, hasRows: true, isError: true, isOnline: false }),
    ).toBe(false);
    expect(
      shouldShowInlineRefreshWarning({ ...base, hasRows: true, isError: true, isFetching: true }),
    ).toBe(false);
    expect(shouldShowInlineRefreshWarning({ ...base, hasRows: true })).toBe(false);
  });
});
