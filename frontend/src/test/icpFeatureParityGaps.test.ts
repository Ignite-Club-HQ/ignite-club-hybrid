import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const icpMode = process.env.IGNITE_TEST_BACKEND_MODE === "icp";

const parityGaps = [
  ["AdMob settings", "pages/AdMobSettingsPage.tsx", "AdMob settings are unavailable in ICP lab mode"],
  ["AI catch-up administration", "pages/AdminAICatchUpPage.tsx", "AI catch-up administration is unavailable in ICP lab mode"],
  ["photo-reminder administration", "pages/AdminChatPhotoRemindersPage.tsx", "Photo-reminder administration is unavailable in ICP lab mode"],
  ["LLM testing", "pages/AdminIcpLlmTestPage.tsx", "LLM testing is unavailable in ICP lab mode"],
  ["temporary passwords", "pages/AdminTempPasswordPage.tsx", "Temporary passwords are unavailable in ICP lab mode"],
  ["application payment configuration", "pages/AppStripeSettingsPage.tsx", "Application payment configuration is unavailable in ICP lab mode"],
  ["club editing", "pages/EditClubPage.tsx", "Club editing is unavailable in ICP lab mode"],
  ["team editing", "pages/EditTeamPage.tsx", "Team editing is unavailable in ICP lab mode"],
  ["personal team creation", "pages/StartTeamPage.tsx", "Personal team creation is unavailable in ICP lab mode"],
  ["external fixture import", "pages/ImportFixturesPage.tsx", "Fixture import is unavailable in ICP lab mode"],
  ["backup administration", "pages/ManageBackupsPage.tsx", "Backup administration is unavailable in ICP lab mode"],
  ["promo-code management", "pages/ManagePromoCodesPage.tsx", "Promo codes remain part of the disabled external billing boundary."],
  ["subscription management", "pages/ClubUpgradePage.tsx", "Subscription management is not yet available for Internet Identity accounts."],
  ["promo-code redemption", "pages/ClubUpgradePage.tsx", "Promo codes are not yet available for Internet Identity accounts."],
  ["schedule broadcasts", "pages/ClubDetailPage.tsx", "Schedule broadcasts are unavailable in ICP lab mode"],
  ["fee payments", "pages/PayFeesPage.tsx", "Fee payments are unavailable in ICP lab mode"],
  ["public competition pages", "pages/PublicCompetitionPage.tsx", "Public competitions are unavailable in ICP lab mode"],
  ["realtime health monitoring", "pages/RealtimeHealthPage.tsx", "Realtime health monitoring is unavailable in ICP lab mode"],
  ["password recovery", "pages/ResetPasswordPage.tsx", "Password recovery is unavailable in ICP lab mode"],
  ["reset-code verification", "pages/VerifyResetCodePage.tsx", "Reset-code verification is unavailable in ICP lab mode"],
  ["scheduled messages", "pages/ScheduledMessagesPage.tsx", "Scheduled messages are unavailable in ICP lab mode"],
  ["update reminders", "pages/SendUpdateReminderPage.tsx", "Update reminders are unavailable in ICP lab mode"],
  ["short invite resolution", "pages/ShortInviteRedirect.tsx", "Short invite links are unavailable in ICP lab mode"],
  ["payment settings", "pages/StripeSettingsPage.tsx", "Payment settings are unavailable in ICP lab mode"],
  ["administrative video guides", "pages/VideoGuideDownloadPage.tsx", "Administrative video guides are unavailable in ICP lab mode"],
  ["account deletion", "pages/ManageUsersPage.tsx", "Account deletion is not yet available for Internet Identity accounts."],
  ["vault pinning from chat", "hooks/useChatPinnedVault.ts", "Pinning a vault is not yet available for Internet Identity accounts."],
  ["gallery publication from chat", "components/chat/MessageActionSheet.tsx", '!isFeatureRoutedToIcp("media")'],
  ["pitch-board event-link notifications", "components/pitch/hooks/usePitchBoardEventLink.ts", 'if (resolveAuthBackend() === "icp") return;'],
  ["pitch-board formation notifications", "components/pitch/hooks/usePitchBoardFormationNotifications.ts", 'if (resolveAuthBackend() === "icp") return;'],
  ["team-admin email invitations", "pages/CreateTeamPage.tsx", "Email invites for team admins aren't available for Internet Identity accounts yet."],
] as const;

describe.runIf(icpMode)("ICP feature parity gap sentinels", () => {
  it.each(parityGaps)("ICP parity: %s must have a live implementation", (_feature, relativePath, gapMarker) => {
    const source = readFileSync(resolve(process.cwd(), "src", relativePath), "utf8");
    expect(
      !source.includes(gapMarker),
      `${relativePath} still contains ICP gap marker: ${gapMarker}`,
    ).toBe(true);
  });
});