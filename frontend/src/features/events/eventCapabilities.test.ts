import { describe, expect, it } from "vitest";
import { resolveEventCapabilities } from "@/features/events/eventCapabilities";

describe("event capability policy", () => {
  it.each([
    ["scoped event manager", { isEventManager: true }, true, true],
    ["app-admin override", { isAppAdmin: true }, true, true],
    ["exact-event Subs Manager", { isSubsManagerForEvent: true }, false, true],
    ["ordinary attendee", {}, false, false],
  ] as const)("resolves %s", (_label, input, canManageEvent, canOperateMatch) => {
    expect(resolveEventCapabilities(input)).toEqual({ canManageEvent, canOperateMatch });
  });

  it("does not give a Subs Manager full event administration", () => {
    const result = resolveEventCapabilities({ isSubsManagerForEvent: true });
    expect(result.canOperateMatch).toBe(true);
    expect(result.canManageEvent).toBe(false);
  });

  it("fails closed while role queries remain unresolved", () => {
    expect(resolveEventCapabilities({
      isEventManager: undefined,
      isAppAdmin: null,
      isSubsManagerForEvent: undefined,
    })).toEqual({ canManageEvent: false, canOperateMatch: false });
  });

  describe("EventDetailPage extraction parity", () => {
    // EventDetailPage.tsx previously repeated `isAdmin || isAppAdmin` (~20
    // call sites) and `isAdmin || isAppAdmin || isSubsManagerForEvent`
    // (match-score/pitch-board gating) inline instead of calling this
    // module. This exhaustively proves resolveEventCapabilities({
    // isEventManager: isAdmin, isAppAdmin, isSubsManagerForEvent }) yields
    // identical canManageEvent/canOperateMatch values to those two inline
    // formulas for every boolean/null/undefined combination, so wiring the
    // page to the shared helper changes no rendered/query-enablement
    // behavior.
    const tri = [undefined, null, false, true] as const;

    it("matches the page's prior inline isAdmin/isAppAdmin/isSubsManagerForEvent formulas for every combination", () => {
      for (const isAdmin of tri) {
        for (const isAppAdmin of tri) {
          for (const isSubsManagerForEvent of tri) {
            const expectedCanManageEvent = !!(isAdmin || isAppAdmin);
            const expectedCanOperateMatch = !!(isAdmin || isAppAdmin || isSubsManagerForEvent);

            expect(
              resolveEventCapabilities({ isEventManager: isAdmin, isAppAdmin, isSubsManagerForEvent }),
            ).toEqual({ canManageEvent: expectedCanManageEvent, canOperateMatch: expectedCanOperateMatch });
          }
        }
      }
    });
  });
});
