import { expect, test } from "@playwright/test";
import { openAuthenticatedChat, teamChatRoute } from "./chatTestHelpers";

test.describe("WebKit virtualized chat integrity", () => {
test.skip(!process.env.E2E_BASE_URL || !process.env.E2E_TEAM_ID, "Set E2E_BASE_URL and E2E_TEAM_ID to run the staging journey.");

test("virtualized chat keeps unique, ordered message rows after fast scrolls", async ({ page }) => {
  const route = teamChatRoute();
  test.skip(!route, "Set E2E_TEAM_ID to a team with at least five chat messages.");
  await page.addInitScript(() => localStorage.setItem("ff:chat-virtualization", "1"));
  await openAuthenticatedChat(page, route!);
  const scroller = page.locator("[data-chat-virtualized='true'] [data-chat-scroll-lock='true']").first();
  await expect.poll(() => scroller.locator("[data-chat-row='true']").count()).toBeGreaterThan(4);

  for (let index = 0; index < 12; index += 1) await page.mouse.wheel(0, index % 2 === 0 ? -260 : 260);
  await page.waitForTimeout(250);

  const rows = await scroller.locator("[data-chat-row='true']").evaluateAll((elements) => elements.map((element) => {
    const row = element as HTMLElement;
    return { id: row.dataset.messageId ?? row.getAttribute("data-message-id"), top: row.getBoundingClientRect().top };
  }).filter((row) => row.id));
  const ids = rows.map((row) => row.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (let index = 1; index < rows.length; index += 1) {
    expect(rows[index].top).toBeGreaterThanOrEqual(rows[index - 1].top - 1);
  }
});
});