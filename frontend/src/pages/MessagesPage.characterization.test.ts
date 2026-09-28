import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const pagesDirectory = dirname(fileURLToPath(import.meta.url));
const messagesPageSource = readFileSync(join(pagesDirectory, "MessagesPage.tsx"), "utf8");
const messageInboxSource = existsSync(join(pagesDirectory, "MessagesInboxSections.tsx"))
  ? readFileSync(join(pagesDirectory, "MessagesInboxSections.tsx"), "utf8")
  : "";
const dialogsSource = existsSync(join(pagesDirectory, "../components/chat/MessagesPageDialogs.tsx"))
  ? readFileSync(join(pagesDirectory, "../components/chat/MessagesPageDialogs.tsx"), "utf8")
  : "";
const messageFilterSource = existsSync(join(pagesDirectory, "../features/messaging/inbox/inboxFiltering.ts"))
  ? readFileSync(join(pagesDirectory, "../features/messaging/inbox/inboxFiltering.ts"), "utf8")
  : "";
const readModelSource = readFileSync(join(pagesDirectory, "../features/messaging/inbox/inboxReadModel.ts"), "utf8");
const source = `${messagesPageSource}\n${messageInboxSource}\n${dialogsSource}\n${messageFilterSource}\n${readModelSource}`;

describe("MessagesPage self-duplication characterization", () => {
  it("keeps message-source semantics distinct while sharing inbox list shells", () => {
    expect(source).toContain("club: 'Club'");
    expect(source).toContain("team: 'Team'");
    expect(source).toContain("group: 'Group'");
    expect(source).toContain("admin_group: 'Admin'");
    expect(source).toContain("league: 'League'");
    expect(source).toContain("dm: 'DM'");
    expect(source).toMatch(/(?:c|conversation)\.type === ["']broadcast["']/);
    expect(source).toMatch(/(?:c|conversation)\.type === ["']support["']/);
    expect(source).toContain("buildUnifiedInboxConversations");
    expect(source).toContain("Unread");
    expect(source).toContain("Recent");
    expect(source).toContain("Admin Groups");
    expect(source).toContain("Announcements");
    expect(source).toContain("Custom Groups");
  });

  it("preserves loading, empty, error, and offline states", () => {
    expect(source).toContain("showSkeletonLoading");
    expect(source).toContain("MessageSkeleton");
    expect(source).toContain("Couldn't load chats. Tap to retry.");
    expect(source).toContain("No messages match");
    expect(source).toContain("No messages available");
    expect(source).toContain("You're offline and no saved conversations are available yet");
    expect(source).toContain("You're offline — showing saved conversations.");
  });

  it("preserves filter, ordering, and stale operational group disclosure rules", () => {
    expect(source).toMatch(/typeFilter === ["']all["']/);
    expect(source).toMatch(/case ["']teams["']/);
    expect(source).toMatch(/case ["']groups["']/);
    expect(source).toMatch(/case ["']dms["']/);
    expect(source).toMatch(/sortByActivityDesc|sortInboxByActivityDesc/);
    expect(source).toContain("unreadCount > 0");
    expect(source).toContain("unreadCount === 0");
    expect(source).toContain("staleAfterDays ?? 30");
    expect(source).toContain("Show {hiddenOps.length} more inactive group");
  });

  it("preserves dialog orchestration gates and lazy boundaries", () => {
    expect(dialogsSource).toMatch(/lazyWithRetry\(\(\) =>\s*import\("@\/components\/chat\/NewMessageSheet"\)/);
    expect(dialogsSource).toMatch(/lazyWithRetry\(\(\) =>\s*import\("@\/components\/chat\/StartDMDialog"\)/);
    expect(dialogsSource).toMatch(/lazyWithRetry\(\(\) =>\s*import\("@\/components\/chat\/CreateGroupDialog"\)/);
    expect(source).toContain("canCreateGroups={!!canCreateGroups}");
    expect(source).toContain("canCreateCustomGroup={!!(hasAnyProAccess || isAppAdmin)}");
    expect(source).toContain("hasPro={effectiveClubFilter ? scopedClubIsPro === true : !!hasAnyProAccess}");
    expect(source).toContain("mode=\"dm\"");
    expect(source).toContain("mode=\"custom-group\"");
    expect(source).toContain("allowCategory={canCreateGroups}");
    expect(source).toContain("groupType={groupDialogType}");
  });
});
