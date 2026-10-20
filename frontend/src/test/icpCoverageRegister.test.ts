import { describe, expect, it } from "vitest";

/**
 * ICP coverage register — every feature the Codespaces ICP sentinel flagged
 * must be either built on-chain ("onchain"), intentionally off-chain with an
 * approved reason ("offchain"), or explicitly blocked ("blocked").
 * "todo" entries are open work from the 2026-10-16 coverage plan and show as
 * todo tests until a behaviour-level ICP test replaces them.
 */
type Status = "onchain" | "offchain" | "blocked" | "todo";
const REGISTER: Record<string, { status: Status; reason?: string }> = {
  "AdMob settings": { status: "offchain", reason: "ads config is not user data; approved exception" },
  "AI catch-up administration": { status: "onchain", reason: "AdminAICatchUpPage.test.tsx verifies admin gates, rollout saves, Pro eligibility and rejected operations; settings coverage does not prove AI execution" },
  "Photo-reminder administration": { status: "onchain", reason: "AdminChatPhotoRemindersPage.test.tsx covers on-chain settings, Run now, denial and errors; automatic cadence remains to verify" },
  "LLM testing": { status: "blocked", reason: "static app cannot hold the AI key" },
  "Temporary passwords": { status: "offchain", reason: "Internet Identity has no passwords" },
  "Application payment configuration": { status: "offchain", reason: "payments stay off-chain" },
  "Club editing": { status: "onchain", reason: "club_domain profile/settings/general-settings saves via withFeatureBackend" },
  "Team editing": { status: "onchain", reason: "club_domain save_team via withFeatureBackend" },
  "Personal team creation": { status: "onchain", reason: "club_domain save_team with empty club_id via CreateTeamPage __personal__ flow" },
  "External fixture import": { status: "onchain", reason: "PlayHQ team fixtures on events_domain; association imports off-chain" },
  "Backup administration": { status: "onchain", reason: "IcpManageBackupsPage.test.tsx covers admin gating, snapshot lifecycle, media-aware restore, metadata/domain exports and failures; vaultBackupRestore.test.ts covers restored media bytes" },
  "Promo-code management and redemption": { status: "onchain", reason: "club_domain promo codes (migration 20261021/22)" },
  "Subscription management": { status: "offchain", reason: "payments; native IAP only in ICP" },
  "Schedule broadcasts": { status: "onchain", reason: "ClubScheduleToolsSection tests verify live writes; scheduleAccess Motoko tests enforce manager/recipient scope; deployed delivery remains separate" },
  "Fee payments": { status: "offchain", reason: "payments stay off-chain" },
  "Public competition pages": { status: "onchain", reason: "anonymous competition_domain get_public_competition_page; ladder computed on-device (PublicCompetitionPage.ladder.test.ts); needs competition_domain redeploy" },
  "Realtime health monitoring": { status: "onchain", reason: "IcpRealtimeHealthPanel.test.tsx verifies canister reachability and failure; ICP polling replaces Supabase websocket metrics" },
  "Password recovery and reset-code verification": { status: "offchain", reason: "Internet Identity has no passwords" },
  "Scheduled messages": { status: "onchain", reason: "ScheduledMessagesPage.icp tests plus schedulePatch/calendar/access executable tests; live timer read-back remains separate" },
  "Update reminders": { status: "onchain", reason: "AdminUpdateRemindersPage and notification_queue tests cover version audiences, self-only send and denied fan-out" },
  "Short invite resolution": { status: "onchain", reason: "Anonymous club_domain resolution; ShortInviteRedirect.test.tsx verifies success, rejection and missing results without Supabase" },
  "Payment settings": { status: "offchain", reason: "payments stay off-chain" },
  "Administrative video guides": { status: "onchain", reason: "VideoGuideDownloadPage.test.tsx verifies sign-in/admin gates and local text/PDF downloads; static guide needs no external storage" },
  "Account deletion": { status: "onchain", reason: "AccountPage.test.tsx covers success, missing identity and denial; accountData.erase.test.ts verifies caller resolution, club-role revocation and personal-data purges" },
  "Chat vault pinning": { status: "onchain", reason: "ICP saved-pin query enabled; read/save/remove behavior tested in useChatPinnedVault.test.tsx; writes validate club scope on vault_domain" },
  "Chat-image gallery publication": { status: "onchain", reason: "publishChatImageToGallery.icp tests verify decrypted copy, registration and failure cleanup; real recipient unlock remains separate" },
  "Pitch-board event-link notifications": { status: "onchain", reason: "livePitchRecipients resolves flags and match Subs Manager/group duties; hook verifies fan-out and linked-event reads" },
  "Pitch-board formation notifications": { status: "onchain", reason: "livePitchRecipients includes author, staff and match Subs Manager; hook verifies club-scoped alerts without child PII" },
  "Team-admin email invitations": { status: "offchain", reason: "email delivery off-chain; join links on-chain" },
};

describe("ICP coverage register", () => {
  it("lists all 29 flagged features", () => {
    expect(Object.keys(REGISTER)).toHaveLength(29);
  });
  it("every off-chain or blocked feature states a reason", () => {
    for (const [name, e] of Object.entries(REGISTER)) {
      if (e.status === "offchain" || e.status === "blocked") expect(e.reason, name).toBeTruthy();
    }
  });
  for (const [name, e] of Object.entries(REGISTER)) {
    if (e.status === "todo") it.todo(`ICP path: ${name}`);
  }
});
