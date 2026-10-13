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

  it("reads settings via a dynamically-imported getLiveAppSetting inside withFeatureBackend", () => {
    expect(chatPhotoSource).toContain('withFeatureBackend("admin"');
    expect(chatPhotoSource).toContain('await import("@/live/features/appSettings")');
    expect(chatPhotoSource).toContain("getLiveAppSetting(ctx, SETTING_KEY)");
  });

  it("writes settings via a dynamically-imported setLiveAppSetting inside withFeatureBackend", () => {
    expect(chatPhotoSource).toContain("setLiveAppSetting(ctx, SETTING_KEY, form)");
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
