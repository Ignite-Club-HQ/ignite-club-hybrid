import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const forcedBackend = process.env.IGNITE_LAB_FORCED_BACKEND;

test.skip(!forcedBackend, 'This contract is exercised by a forced backend matrix run.');

test(`runs Club Links CRUD through the forced ${forcedBackend} backend`, async ({ page }) => {
  const externalOrigins: string[] = [];
  page.on('request', request => {
    const origin = new URL(request.url()).origin;
    if (origin !== 'http://127.0.0.1:5180') externalOrigins.push(origin);
  });

  await page.goto('/');
  await page.getByText('Connection and staging controls').click();
  const dataSource = page.getByLabel('Data source');
  await expect(dataSource).toHaveValue(forcedBackend!);
  await expect(dataSource).toBeDisabled();
  await expect(page.getByText(`Test backend is forced to ${forcedBackend}; changing data sources is disabled.`)).toBeVisible();
  if (forcedBackend === 'icp') {
    await expect(page.getByLabel('Synthetic editor identity')).toHaveValue('governor');
  }

  await expect(page.getByRole('button', { name: /^Add$/ })).toBeVisible({ timeout: 30_000 });
  const title = `Forced ${forcedBackend} ${randomUUID()}`;
  await page.getByRole('button', { name: /^Add$/ }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Web address').fill(`https://example.invalid/${forcedBackend}`);
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(2, { timeout: 30_000 });

  await page.getByRole('listitem').filter({ hasText: title }).getByRole('button', { name: 'Remove link' }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(0, { timeout: 30_000 });
  expect(externalOrigins).toEqual([]);
});
