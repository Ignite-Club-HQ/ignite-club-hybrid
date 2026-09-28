import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

test.describe('backend switching browser coverage', () => {
  test('switches from standalone Supabase to local ICP without fallback or data bleed', async ({ page }) => {
    test.skip(
      process.env.IGNITE_LAB_BACKEND_SWITCH_E2E !== '1',
      'Run through npm run test:backend:switch so a disposable local ICP deployment is available.',
    );

    const externalOrigins: string[] = [];
    page.on('request', request => {
      const origin = new URL(request.url()).origin;
      if (origin !== 'http://127.0.0.1:5180') externalOrigins.push(origin);
    });

    await page.goto('/');
    await page.getByText('Connection and staging controls').click();

    await page.getByLabel('Data source').selectOption('supabase');
    await expect(page.getByText('Standalone synthetic Supabase provider only. No ICP actor connection is ever opened, and there is no production Supabase fallback.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole('button', { name: /^Add$/ })).toBeVisible({ timeout: 30_000 });

    const supabaseTitle = `Switch Supabase ${randomUUID()}`;
    await page.getByRole('button', { name: /^Add$/ }).click();
    await page.getByLabel('Title', { exact: true }).fill(supabaseTitle);
    await page.getByLabel('Web address').fill('https://example.invalid/switch-supabase');
    await page.getByRole('button', { name: 'Add link', exact: true }).click();
    await expect(page.getByText(supabaseTitle, { exact: true })).toHaveCount(2, { timeout: 30_000 });

    await page.getByLabel('Data source').selectOption('icp');
    await expect(page.getByText('Changes persist in the local canister. The member view uses a separate synthetic identity.')).toBeVisible({ timeout: 30_000 });
    await expect(page.getByLabel('Synthetic editor identity')).toHaveValue('club_admin');
    await expect(page.getByText(supabaseTitle, { exact: true })).toHaveCount(0, { timeout: 30_000 });
    await expect(page.getByRole('button', { name: /^Add$/ })).toBeVisible({ timeout: 30_000 });

    const icpTitle = `Switch ICP ${randomUUID()}`;
    await page.getByRole('button', { name: /^Add$/ }).click();
    await page.getByLabel('Title', { exact: true }).fill(icpTitle);
    await page.getByLabel('Web address').fill('https://example.invalid/switch-icp');
    await page.getByRole('button', { name: 'Add link', exact: true }).click();
    await expect(page.getByText(icpTitle, { exact: true })).toHaveCount(2, { timeout: 30_000 });

    expect(externalOrigins).toEqual([]);
  });
});
