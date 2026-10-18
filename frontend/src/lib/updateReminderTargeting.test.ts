import { describe, expect, it } from "vitest";
import { targetUpdateRecipients, type UpdateDevice } from "./updateReminderTargeting";
const devices: UpdateDevice[] = [
  { user: "ios-user", platform: "ios", app_version: ["1.2.0"], build_number: ["40"] },
  { user: "android-user", platform: "android", app_version: ["1.2.0"], build_number: ["41"] },
  { user: "outsider", platform: "ios", app_version: ["1.2.0"], build_number: [] },
];
describe("update reminder device targeting", () => {
  it("targets iOS by installed version without adding outsiders", () => expect(targetUpdateRecipients(["ios-user", "android-user"], devices, "ios", "1.2.0")).toEqual(["ios-user"]));
  it("targets Android by build rather than semantic version", () => expect(targetUpdateRecipients(["ios-user", "android-user"], devices, "android", "41")).toEqual(["android-user"]));
  it("does not silently include unknown devices in a filtered audience", () => expect(targetUpdateRecipients(["unknown"], [], "ios", "")).toEqual([]));
  it("preserves deduplicated whole-club sends", () => expect(targetUpdateRecipients(["unknown", "unknown"], [], "all", "")).toEqual(["unknown"]));
});