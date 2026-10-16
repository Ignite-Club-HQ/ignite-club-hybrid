import { expect, test } from "@playwright/test";
import { openAuthenticatedChat } from "./chatTestHelpers";

const routes = [
  { name: "messages inbox", path: process.env.E2E_BASE_URL ? "/messages" : null },
  { name: "team chat", path: process.env.E2E_BASE_URL && process.env.E2E_TEAM_ID ? `/messages/${process.env.E2E_TEAM_ID}` : null },
  { name: "club chat", path: process.env.E2E_BASE_URL && process.env.E2E_CLUB_ID ? `/messages/club/${process.env.E2E_CLUB_ID}` : null },
  { name: "group chat", path: process.env.E2E_BASE_URL && process.env.E2E_GROUP_ID ? `/groups/${process.env.E2E_GROUP_ID}` : null },
  { name: "direct message", path: process.env.E2E_BASE_URL && process.env.E2E_DM_CONVERSATION_ID ? `/messages/dm/${process.env.E2E_DM_CONVERSATION_ID}` : null },
  { name: "club admin chat", path: process.env.E2E_BASE_URL && process.env.E2E_CLUB_ADMIN_ID ? `/messages/club-admin/${process.env.E2E_CLUB_ADMIN_ID}` : null },
];

test.describe.configure({ mode: "parallel", retries: 1 });

test.describe("WebKit chat bottom pin", () => {
  test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL to run browser journeys against staging.");
  for (const route of routes) {
    test(`${route.name} opens at the bottom after images settle`, async ({ page }) => {
      test.skip(!route.path, `Set the fixture ID for ${route.name}.`);
      const viewport = await openAuthenticatedChat(page, route.path!);
      await page.waitForFunction(() => {
        const element = document.querySelector<HTMLElement>("[data-chat-scroll-lock='true'], [data-radix-scroll-area-viewport]");
        return !!element && element.scrollHeight > element.clientHeight;
      });

      await Promise.race([
        viewport.locator("img").evaluateAll((images) => Promise.all(images.map((image) => {
          const candidate = image as HTMLImageElement;
          return candidate.decode().catch(() => undefined);
        }))),
        page.waitForTimeout(2_000),
      ]);

      const distanceFromBottom = await viewport.evaluate((element) =>
        Math.max(0, element.scrollHeight - element.clientHeight - element.scrollTop),
      );
      expect(distanceFromBottom).toBeLessThanOrEqual(3);
    });
  }
});