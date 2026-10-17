import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Approved off-chain exceptions must hide cleanly in ICP mode: each page
 * shows a clear "unavailable" notice instead of a broken or half-working
 * feature. These are the features the coverage register marks "offchain"
 * (payments, passwords, ads) — the notice IS the correct behaviour.
 */
const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";

const offchainHides = [
  ["AdMob settings", "pages/AdMobSettingsPage.tsx", "AdMob settings are unavailable in ICP lab mode"],
  ["temporary passwords", "pages/AdminTempPasswordPage.tsx", "Temporary passwords are unavailable in ICP lab mode"],
  ["application payment configuration", "pages/AppStripeSettingsPage.tsx", "Application payment configuration is unavailable in ICP lab mode"],
  ["subscription management", "pages/ClubUpgradePage.tsx", "Subscription management is not yet available for Internet Identity accounts."],
  ["promo-code redemption", "pages/ClubUpgradePage.tsx", "Promo codes are not yet available for Internet Identity accounts."],
  ["fee payments", "pages/PayFeesPage.tsx", "Fee payments are unavailable in ICP lab mode"],
  ["password recovery", "pages/ResetPasswordPage.tsx", "Password recovery is unavailable in ICP lab mode"],
  ["reset-code verification", "pages/VerifyResetCodePage.tsx", "Reset-code verification is unavailable in ICP lab mode"],
  ["payment settings", "pages/StripeSettingsPage.tsx", "Payment settings are unavailable in ICP lab mode"],
] as const;

describe.runIf(icpMode)("ICP off-chain exceptions hide cleanly", () => {
  it.each(offchainHides)("ICP mode: %s shows a clear unavailable notice", (_feature, relativePath, notice) => {
    const source = readFileSync(resolve(process.cwd(), "src", relativePath), "utf8");
    expect(
      source.includes(notice),
      `${relativePath} no longer shows its ICP unavailable notice — either the feature went on-chain (update the coverage register) or the clean hide was removed`,
    ).toBe(true);
  });
});
