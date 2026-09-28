import { describe, it, expect } from "vitest";
import { withSignupIntent } from "@/lib/deepLinkHandler";

describe("withSignupIntent", () => {
  it("adds mode=signup to invite paths", () => {
    expect(withSignupIntent("/join/p/abc", "/join/p/abc")).toBe("/join/p/abc?mode=signup");
    expect(withSignupIntent("/join-club/x", "/join-club/x")).toBe("/join-club/x?mode=signup");
    expect(withSignupIntent("/i/abc", "/i/abc")).toBe("/i/abc?mode=signup");
  });

  it("preserves existing query params and hash", () => {
    expect(withSignupIntent("/join/p/abc", "/join/p/abc?ref=email#top")).toBe(
      "/join/p/abc?ref=email&mode=signup#top",
    );
  });

  it("never overrides an explicit mode", () => {
    expect(withSignupIntent("/auth", "/auth?mode=signin")).toBe("/auth?mode=signin");
  });

  it("leaves unrelated destinations untouched", () => {
    expect(withSignupIntent("/events/123", "/events/123?x=1")).toBe("/events/123?x=1");
  });
});
