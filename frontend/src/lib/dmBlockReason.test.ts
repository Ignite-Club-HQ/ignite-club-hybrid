import { describe, it, expect } from "vitest";
import { dmBlockMessage, DM_BLOCK_FALLBACK } from "./dmBlockReason";

describe("dmBlockMessage", () => {
  it("role_not_allowed explains admin-only", () => {
    expect(dmBlockMessage("role_not_allowed")).toBe(
      "This club only lets admins send private messages. Ask a club admin to allow your role.",
    );
  });
  it("no_shared_pro_club mentions Pro", () => {
    expect(dmBlockMessage("no_shared_pro_club")).toBe(
      "Private messages need a Pro club you both belong to.",
    );
  });
  it("dms_disabled says turned off", () => {
    expect(dmBlockMessage("dms_disabled")).toBe("Private messages are turned off for this club.");
  });
  it("no_shared_club", () => {
    expect(dmBlockMessage("no_shared_club")).toBe("You can only message people in a club you share.");
  });
  it("falls back when reason unknown", () => {
    expect(dmBlockMessage(null)).toBe(DM_BLOCK_FALLBACK);
  });
});
