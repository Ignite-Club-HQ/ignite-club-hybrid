import { describe, expect, it } from "vitest";
import { getIcpNotificationRoute } from "./icpNotificationRoute";
import type { FeatureBackendContext } from "@/live/featureRouter";
describe("chat photo reminder navigation", () => {
  it("opens the reminder's team gallery upload sheet", async () => {
    await expect(getIcpNotificationRoute({} as FeatureBackendContext, { kind: "media_chat_photo_reminder", relatedId: "team-1", club: "club-1", messageId: null })).resolves.toBe("/messages/team-1?gallery=1");
  });
});