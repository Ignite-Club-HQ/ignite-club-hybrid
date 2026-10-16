import { expect, test } from "@playwright/test";
import { openAuthenticatedChat, teamChatRoute } from "./chatTestHelpers";

test.describe("WebKit chat scroll stability", () => {
test.skip(!process.env.E2E_BASE_URL || !process.env.E2E_TEAM_ID, "Set E2E_BASE_URL and E2E_TEAM_ID to run the staging journey.");

test("team chat stays still after a fast scroll settles", async ({ page }) => {
  const route = teamChatRoute();
  test.skip(!route, "Set E2E_TEAM_ID to a team with chat history.");
  await page.addInitScript(() => localStorage.setItem("ff:chat-virtualization", "1"));
  const viewport = await openAuthenticatedChat(page, route!);
  await expect.poll(() => viewport.evaluate((element) => element.scrollHeight > element.clientHeight + 100)).toBe(true);

  await viewport.evaluate((element) => {
    element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) / 2);
    element.dispatchEvent(new Event("scroll", { bubbles: true }));
  });
  await page.waitForTimeout(350);
  const samples: number[] = [];
  for (let index = 0; index < 10; index += 1) {
    samples.push(await viewport.evaluate((element) => element.scrollTop));
    await page.waitForTimeout(50);
  }
  expect(Math.max(...samples.slice(-6)) - Math.min(...samples.slice(-6))).toBeLessThanOrEqual(8);
});
});