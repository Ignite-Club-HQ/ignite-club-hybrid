import { describe, it, expect } from "vitest";
import {
  buildAuthPathWithIntent,
  readAuthIntent,
  readRedirectParam,
} from "@/lib/authRedirectStorage";

describe("invite signup hand-off carries intent in the URL", () => {
  it("builds /auth with mode, next and invite", () => {
    const path = buildAuthPathWithIntent({
      next: "/join/p/abc123",
      mode: "signup",
      invite: "abc123",
    });
    const intent = readAuthIntent(path.slice(path.indexOf("?")));
    expect(intent).toEqual({ mode: "signup", next: "/join/p/abc123", invite: "abc123" });
  });

  it("keeps the legacy redirect param readable", () => {
    const path = buildAuthPathWithIntent({ next: "/join/p/abc", mode: "signup" });
    expect(readRedirectParam(path.slice(path.indexOf("?")))).toBe("/join/p/abc");
  });

  it("refuses off-origin destinations", () => {
    const path = buildAuthPathWithIntent({ next: "https://reference.invalid", mode: "signup" });
    expect(readAuthIntent(path.slice(path.indexOf("?"))).next).toBeNull();
    expect(buildAuthPathWithIntent({ next: "//evil.example" })).toBe("/auth");
  });

  it("ignores an unknown mode value", () => {
    expect(readAuthIntent("?mode=bogus&next=%2Fjoin%2Fp%2Fx").mode).toBeNull();
  });
});
