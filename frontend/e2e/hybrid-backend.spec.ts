import { expect, test } from '@playwright/test';

const forcedBackend = process.env.IGNITE_LAB_FORCED_BACKEND;

test.describe('hybrid backend browser coverage', () => {
  test('keeps the local ICP mode in a fail-closed state with no external browser traffic', async ({ page }) => {
    test.skip(forcedBackend !== undefined, 'This non-forced-mode contract selects its own backend.');
    const externalOrigins: string[] = [];

    page.on('request', request => {
      const origin = new URL(request.url()).origin;
      if (origin !== 'http://127.0.0.1:5180') {
        externalOrigins.push(origin);
      }
    });

    await page.goto('/');
    await page.getByText('Connection and staging controls').click();
    await page.getByLabel('Data source').selectOption('icp');

    await expect(page.getByText('Local ICP is not configured. Start and deploy the local canisters. No fallback was used.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText('Connection and staging controls')).toBeVisible();
    expect(externalOrigins).toEqual([]);
  });

  test('supports the hybrid mode flow and keeps the app in a lab-safe routing model', async ({ page }) => {
    test.skip(forcedBackend !== undefined, 'This non-forced-mode contract selects its own backend.');
    const externalOrigins: string[] = [];

    page.on('request', request => {
      const origin = new URL(request.url()).origin;
      if (origin !== 'http://127.0.0.1:5180') {
        externalOrigins.push(origin);
      }
    });

    await page.goto('/');
    await page.getByText('Connection and staging controls').click();
    await page.getByLabel('Data source').selectOption('hybrid');

    await expect(page.getByText('Placement selects synthetic Supabase or the local ICP canister. No fallback is used.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Club placement')).toBeVisible();
    await page.getByLabel('Club placement').selectOption({ label: 'Australia · synthetic Supabase' });
    await expect(page.getByLabel('Club placement')).toHaveValue('hybrid-au');

    expect(externalOrigins).toEqual([]);
  });
});
