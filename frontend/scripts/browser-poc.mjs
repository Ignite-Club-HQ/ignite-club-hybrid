import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
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
  await page.getByLabel('Data source').selectOption('icp');
  await expect(page.getByRole('button',{name:/^Add$/})).toBeVisible({timeout:30_000});
  const title = `Browser POC ${randomUUID()}`;
  await page.getByRole('button',{name:/^Add$/}).click();
  await page.getByLabel('Title',{exact:true}).fill(title);
  await page.getByLabel('Web address').fill('https://example.invalid/browser');
  await page.getByRole('button',{name:'Add link',exact:true}).click();
  await expect(page.getByText(title,{exact:true})).toHaveCount(2,{timeout:30_000});
  // Fresh browser session, fresh actor: data must come from the canister.
  await page.reload();
  await page.getByLabel('Data source').selectOption('icp');
  await expect(page.getByText(title,{exact:true})).toHaveCount(2,{timeout:30_000});
  const row = page.getByRole('listitem').filter({hasText:title});
  await row.getByRole('button',{name:'Edit link'}).click();
  await page.getByLabel('Title',{exact:true}).fill(`${title} edited`);
  await page.getByRole('button',{name:'Save changes'}).click();
  await expect(page.getByText(`${title} edited`,{exact:true})).toHaveCount(2,{timeout:30_000});
  await page.getByRole('listitem').filter({hasText:`${title} edited`}).getByRole('switch',{name:'Visible to members'}).click();
  await expect(page.getByText(`${title} edited`,{exact:true})).toHaveCount(1,{timeout:30_000});
  await page.getByLabel('Synthetic editor identity').selectOption('outsider');
  await expect(page.getByRole('alert').filter({hasText:'Forbidden'})).toBeVisible({timeout:30_000});
  await expect(page.getByText(`${title} edited`,{exact:true})).toHaveCount(0);
  await page.getByLabel('Synthetic editor identity').selectOption('excluded_admin');
  await expect(page.getByText(`${title} edited`,{exact:true})).toHaveCount(1,{timeout:30_000});
  await page.getByRole('listitem').filter({hasText:`${title} edited`}).getByRole('button',{name:'Remove link'}).click();
  await expect(page.getByText(`${title} edited`,{exact:true})).toHaveCount(0,{timeout:30_000});
  expect(external).toEqual([]); expect(errors).toEqual([]);
  console.log('PASS: real browser local-ICP CRUD, reload persistence, member filtering, identity-switch cache isolation, excluded administrator; no external browser requests.');
} finally { await browser.close(); }
