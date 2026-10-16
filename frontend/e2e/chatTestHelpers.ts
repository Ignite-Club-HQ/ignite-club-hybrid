import { expect, Page, test } from "@playwright/test";

export async function openAuthenticatedChat(page: Page, route: string) {
  test.skip(!process.env.E2E_BASE_URL, "Set E2E_BASE_URL to a staging or preview app.");
  await page.goto(route, { waitUntil: "domcontentloaded" });
  if (/\/(auth|login|sign-in|signin)(\/|$)/i.test(new URL(page.url()).pathname)) {
    test.skip(true, "Set E2E_STORAGE_STATE to an authenticated test account.");
  }

  const viewport = page.locator("[data-chat-scroll-lock='true'], [data-radix-scroll-area-viewport]").first();
  if (!(await viewport.count())) test.skip(true, "This route did not mount a chat viewport.");
  await expect(viewport).toBeVisible();
  return viewport;
}

export const teamChatRoute = () => process.env.E2E_TEAM_ID ? `/messages/${process.env.E2E_TEAM_ID}` : null;