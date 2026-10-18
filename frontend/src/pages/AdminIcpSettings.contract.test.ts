import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const chatPhotoSource = readFileSync(
  resolve(process.cwd(), "src/pages/AdminChatPhotoRemindersPage.tsx"),
  "utf8",
);
const aiCatchUpSource = readFileSync(
  resolve(process.cwd(), "src/pages/AdminAICatchUpPage.tsx"),
  "utf8",
);

describe("AdminChatPhotoRemindersPage ICP wiring", () => {
  it("no longer gates the page behind IcpUnavailablePage", () => {
    expect(chatPhotoSource).not.toContain("IcpUnavailablePage");
    expect(chatPhotoSource).not.toContain("isFeatureRoutedToIcp");
  });

  it("reads the scheduler-owned settings instead of an unrelated settings store", () => {
    expect(chatPhotoSource).toContain('withFeatureBackend("messaging"');
    expect(chatPhotoSource).toContain('await import("@/live/features/messaging")');
    expect(chatPhotoSource).toContain("getLiveChatPhotoReminderSettings(ctx)");
  });

  it("writes the scheduler-owned settings", () => {
    expect(chatPhotoSource).toContain("setLiveChatPhotoReminderSettings(ctx, form)");
  });
});

describe("AdminAICatchUpPage ICP wiring", () => {
  it("no longer gates the page behind IcpUnavailablePage", () => {
    expect(aiCatchUpSource).not.toContain("IcpUnavailablePage");
  });

  it("reads/writes its rollout setting via getLiveAppSetting/setLiveAppSetting inside withFeatureBackend", () => {
    expect(aiCatchUpSource).toContain('withFeatureBackend("admin"');
    expect(aiCatchUpSource).toContain('await import("@/live/features/appSettings")');
    expect(aiCatchUpSource).toContain("getLiveAppSetting(ctx, ICP_SETTING_KEY)");
    expect(aiCatchUpSource).toContain("setLiveAppSetting(ctx, ICP_SETTING_KEY, value)");
  });

  it("still renders the Supabase pro-club rollout UI when not ICP-routed", () => {
    expect(aiCatchUpSource).toContain("SupabaseAdminAICatchUpPage");
    expect(aiCatchUpSource).toContain("app_admin_enable_ai_catch_up_for_pro_clubs");
  });
});
