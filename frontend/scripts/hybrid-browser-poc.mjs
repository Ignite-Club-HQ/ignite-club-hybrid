import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';

const localIcpClub = '00000000-0000-4000-8000-000000000001';

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
  await page.getByLabel('Data source').selectOption('hybrid');
  await expect(page.getByRole('button', { name: /^Add$/ })).toBeVisible();
  const australia = `Hybrid AU ${randomUUID()}`;
  await page.getByRole('button', { name: /^Add$/ }).click();
  await page.getByLabel('Title', { exact: true }).fill(australia);
  await page.getByLabel('Web address').fill('https://example.invalid/au');
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(page.getByText(australia, { exact: true })).toHaveCount(2);
  await page.getByLabel('Club placement').selectOption(localIcpClub);
  await expect(page.getByText(australia, { exact: true })).toHaveCount(0);
  const usa = `Hybrid US ${randomUUID()}`;
  await page.getByRole('button', { name: /^Add$/ }).click();
  await page.getByLabel('Title', { exact: true }).fill(usa);
  await page.getByLabel('Web address').fill('https://example.invalid/us');
  await page.getByRole('button', { name: 'Add link', exact: true }).click();
  await expect(page.getByText(usa, { exact: true })).toHaveCount(2);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
  console.log('PASS: hybrid browser routing isolates AU/Supabase and local ICP placements with no external requests.');
} finally { await browser.close(); }
