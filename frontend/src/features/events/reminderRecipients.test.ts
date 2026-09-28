import { describe, it, expect } from "vitest";
import {
  resolveReminderRecipients,
  applyReminderCooldown,
  normalizeRecipientIds,
  REMINDER_LOOKUP_ERROR_MESSAGE,
} from "./reminderRecipients";

describe("resolveReminderRecipients", () => {
  it("includes primary parent plus additional guardians once each", () => {
    const res = resolveReminderRecipients({
      child: { parent_id: "p1" },
      guardians: [{ guardian_id: "g1" }, { guardian_id: "g2" }],
    });
    expect(res).toEqual({ status: "ok", recipientIds: ["p1", "g1", "g2"] });
  });

  it("deduplicates duplicate guardian identities", () => {
    const res = resolveReminderRecipients({
      userId: "p1",
      child: { parent_id: "p1" },
      guardians: [{ guardian_id: "p1" }, { guardian_id: "g1" }, { guardian_id: "g1" }],
    });
    expect(res).toEqual({ status: "ok", recipientIds: ["p1", "g1"] });
  });

  it("works with a missing primary parent", () => {
    const res = resolveReminderRecipients({
      child: { parent_id: null },
      guardians: [{ guardian_id: "g1" }],
    });
    expect(res).toEqual({ status: "ok", recipientIds: ["g1"] });
  });

  it("returns an empty list when the child genuinely has no guardians", () => {
    const res = resolveReminderRecipients({ child: { parent_id: null }, guardians: [] });
    expect(res).toEqual({ status: "ok", recipientIds: [] });
  });

  it("fails closed when child_guardians read fails", () => {
    const res = resolveReminderRecipients({
      guardiansError: { message: "boom" },
      child: { parent_id: "p1" },
      guardians: null,
    });
    expect(res).toEqual({ status: "error", message: REMINDER_LOOKUP_ERROR_MESSAGE });
  });

  it("fails closed when children.parent_id read fails", () => {
    const res = resolveReminderRecipients({
      guardians: [{ guardian_id: "g1" }],
      childError: { message: "boom" },
    });
    expect(res.status).toBe("error");
  });

  it("strips null and empty guardian ids", () => {
    const res = resolveReminderRecipients({
      guardians: [{ guardian_id: null }, { guardian_id: "  " as unknown as string }, { guardian_id: "g1" }],
      child: null,
    });
    expect(res).toEqual({ status: "ok", recipientIds: ["g1"] });
  });
});

describe("applyReminderCooldown", () => {
  it("excludes recently reminded guardians", () => {
    const res = applyReminderCooldown({
      recipientIds: ["a", "b"],
      recentlyRemindedRows: [{ user_id: "a" }],
    });
    expect(res).toEqual({ status: "ok", recipientIds: ["b"] });
  });

  it("returns an empty list when everyone is within cooldown", () => {
    const res = applyReminderCooldown({
      recipientIds: ["a", "b"],
      recentlyRemindedRows: [{ user_id: "a" }, { user_id: "b" }],
    });
    expect(res).toEqual({ status: "ok", recipientIds: [] });
  });

  it("fails closed when the cooldown read fails", () => {
    const res = applyReminderCooldown({
      recipientIds: ["a"],
      cooldownError: { message: "boom" },
    });
    expect(res).toEqual({ status: "error", message: REMINDER_LOOKUP_ERROR_MESSAGE });
  });
});

describe("normalizeRecipientIds", () => {
  it("removes nulls, blanks and duplicates preserving order", () => {
    expect(normalizeRecipientIds(["b", null, "a", "b", undefined, ""])).toEqual(["b", "a"]);
  });
});
