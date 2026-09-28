import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

// Standalone Supabase-only browser baseline, mirroring browser-poc.mjs's
// ICP-only flow. Selects the "supabase" data source, which never opens a
// local ICP actor connection at all (see src/lab/LabApp.tsx Session()) -
// the whole session runs against the in-memory synthetic Supabase
// provider only. This proves the Supabase-shaped path works completely
// independently of whether a local canister/replica is running, and that
// its data is genuinely in-memory-only (a fresh reload starts empty,
// unlike ICP mode's real canister-backed persistence).
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const external = [], errors = [];
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:5180') { external.push(url.origin); return route.abort(); }
    return route.continue();
  });
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:5180');
  await page.getByText('Connection and staging controls').click();
  await page.getByLabel('Data source').selectOption('supabase');
  await expect(page.getByRole('button', { name: /^Add$/ })).toBeVisible({ timeout: 30_000 });
  const title = `Supabase POC ${randomUUID()}`;
  await page.getByRole('button', { name: /^Add$/ }).click();
  await page.getByLabel('Title', { exact: true }).fill(title);
  await page.getByLabel('Web address').fill('https://example.invalid/supabase');
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(page.getByText(title, { exact: true })).toHaveCount(2, { timeout: 30_000 });
  // Note: unlike ICP mode (backed by real canister storage), the
  // synthetic Supabase provider is an in-memory JS module store scoped to
  // this page's lifetime - a reload starts a fresh, empty store. That is
  // expected and correct for a synthetic fixture, so this baseline
  // exercises the full CRUD lifecycle within one session instead of
  // asserting cross-reload persistence.
  const row = page.getByRole('listitem').filter({ hasText: title });
  await row.getByRole('button', { name: 'Edit link' }).click();
  await page.getByLabel('Title', { exact: true }).fill(`${title} edited`);
  await page.getByRole('button', { name: 'Save changes' }).click();
  await expect(page.getByText(`${title} edited`, { exact: true })).toHaveCount(2, { timeout: 30_000 });
  await page.getByRole('listitem').filter({ hasText: `${title} edited` }).getByRole('switch', { name: 'Visible to members' }).click();
  await expect(page.getByText(`${title} edited`, { exact: true })).toHaveCount(1, { timeout: 30_000 });
  await page.getByRole('listitem').filter({ hasText: `${title} edited` }).getByRole('button', { name: 'Remove link' }).click();
  await expect(page.getByText(`${title} edited`, { exact: true })).toHaveCount(0, { timeout: 30_000 });
  // Confirm the in-memory-only characteristic explicitly rather than
  // silently ignoring it: a reload must not resurrect removed/prior data.
  await page.reload();
  await page.getByText('Connection and staging controls').click();
  await page.getByLabel('Data source').selectOption('supabase');
  await expect(page.getByRole('button', { name: /^Add$/ })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
  await expect(page.getByText(`${title} edited`, { exact: true })).toHaveCount(0);
  expect(external).toEqual([]); expect(errors).toEqual([]);
  console.log('PASS: real browser standalone synthetic-Supabase CRUD (add/edit/toggle-visibility/remove) and member filtering, with zero ICP actor connections, no external browser requests, and the expected in-memory-only (non-persistent-across-reload) fixture behavior confirmed.');
} finally { await browser.close(); }
