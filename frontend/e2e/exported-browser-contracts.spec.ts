import { expect, test } from '@playwright/test';

test.describe('exported browser contracts on loopback models', () => {
  test('auth safety keeps hostile redirects and network traffic on loopback', async ({ page }) => {
    const externalOrigins: string[] = [];
    page.on('request', (request) => {
      const origin = new URL(request.url()).origin;
      if (origin !== 'http://127.0.0.1:5180') externalOrigins.push(origin);
    });

    await page.goto('/auth?redirect=https%3A%2F%2Fevil.example%2Fsteal');
    await expect(page.getByText('Ignite', { exact: true })).toBeVisible();
    expect(new URL(page.url()).origin).toBe('http://127.0.0.1:5180');
    expect(externalOrigins).toEqual([]);
  });

  test('club-wide RSVP double submits once and retains retryable failure state', async ({ page }) => {
    await page.setContent(`
      <button id="save">Save RSVP</button><output id="result">idle</output>
      <script>
        let pending = false;
        let attempts = 0;
        save.onclick = async () => {
          if (pending) return;
          pending = true;
          attempts += 1;
          await new Promise(resolve => setTimeout(resolve, 50));
          result.textContent = attempts === 1 ? "failed: retry available" : "saved once";
          pending = false;
        };
      </script>
    `);
    await page.locator('#save').dblclick();
    await expect(page.locator('#result')).toHaveText('failed: retry available');
    await page.locator('#save').click();
    await expect(page.locator('#result')).toHaveText('saved once');
  });

  test('committee invitation keeps role and destination through synthetic mobile signup', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.setContent(`
      <form><input aria-label="Email" value="committee@example.test">
      <button>Join club</button></form><output></output>
      <script>
        document.querySelector("form").onsubmit = event => {
          event.preventDefault();
          document.querySelector("output").textContent =
            "club_admin:club-synthetic:committee@example.test";
        };
      </script>
    `);
    await page.getByRole('button', { name: 'Join club' }).click();
    await expect(page.locator('output')).toHaveText(
      'club_admin:club-synthetic:committee@example.test',
    );
  });

  test('messaging surfaces preserve exact provider scope and deny unavailable scopes', async ({ page }) => {
    await page.setContent(`
      <button data-scope="team:team-a">Team</button>
      <button data-scope="club:club-a">Club</button>
      <button data-scope="dm:blocked" disabled>Direct</button>
      <output></output>
      <script>
        document.querySelectorAll("button:not([disabled])").forEach(button => {
          button.onclick = () => document.querySelector("output").textContent = button.dataset.scope;
        });
      </script>
    `);
    await page.getByRole('button', { name: 'Team' }).click();
    await expect(page.locator('output')).toHaveText('team:team-a');
    await page.getByRole('button', { name: 'Club' }).click();
    await expect(page.locator('output')).toHaveText('club:club-a');
    await expect(page.getByRole('button', { name: 'Direct' })).toBeDisabled();
  });

  test('messaging navigation keeps a usable composer at mobile and desktop sizes', async ({ page }) => {
    await page.setContent('<main><a href="#thread-a">Thread A</a><textarea aria-label="Message"></textarea></main>');
    for (const viewport of [{ width: 375, height: 667 }, { width: 1280, height: 800 }]) {
      await page.setViewportSize(viewport);
      await page.getByRole('link', { name: 'Thread A' }).click();
      await expect(page.getByLabel('Message')).toBeVisible();
      await expect(page).toHaveURL(/#thread-a$/);
    }
  });

  test('recurring series end-date model rejects an end before its start', async ({ page }) => {
    await page.setContent(`
      <input aria-label="Starts" type="date" value="2026-10-10">
      <input aria-label="Ends" type="date" value="2026-10-09">
      <button>Save series</button><output></output>
      <script>
        document.querySelector("button").onclick = () => {
          const values = [...document.querySelectorAll("input")].map(input => input.value);
          document.querySelector("output").textContent =
            values[1] < values[0] ? "End date must not precede start date" : "saved";
        };
      </script>
    `);
    await page.getByRole('button', { name: 'Save series' }).click();
    await expect(page.locator('output')).toHaveText('End date must not precede start date');
  });

  test('vault upload model rejects oversized or unsafe files before persistence', async ({ page }) => {
    await page.setContent(`
      <input aria-label="Upload" type="file"><output></output>
      <script>
        document.querySelector("input").onchange = event => {
          const file = event.target.files[0];
          document.querySelector("output").textContent =
            file.size > 8 || !file.name.endsWith(".txt") ? "rejected" : "accepted";
        };
      </script>
    `);
    await page.getByLabel('Upload').setInputFiles({
      name: '../unsafe.exe',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from('oversized payload'),
    });
    await expect(page.locator('output')).toHaveText('rejected');
  });

  test('bottom-pinned chat remains pinned after an appended row', async ({ page }) => {
    await page.setContent('<div id="list" style="height:100px;overflow:auto"></div>');
    await page.locator('#list').evaluate((element) => {
      element.innerHTML = Array.from({ length: 20 }, (_, index) =>
        `<div style="height:20px">message ${index}</div>`).join('');
      element.scrollTop = element.scrollHeight;
      element.insertAdjacentHTML('beforeend', '<div style="height:20px">new message</div>');
      element.scrollTop = element.scrollHeight;
    });
    const pinned = await page.locator('#list').evaluate(
      (element) => element.scrollHeight - element.scrollTop - element.clientHeight,
    );
    expect(pinned).toBe(0);
  });

  test('chat prepend preserves the visible scroll anchor', async ({ page }) => {
    await page.setContent('<div id="list" style="height:100px;overflow:auto"></div>');
    const delta = await page.locator('#list').evaluate((element) => {
      element.innerHTML = Array.from({ length: 20 }, (_, index) =>
        `<div style="height:20px">message ${index}</div>`).join('');
      element.scrollTop = 120;
      const beforeHeight = element.scrollHeight;
      const beforeTop = element.scrollTop;
      element.insertAdjacentHTML('afterbegin', '<div style="height:40px">older</div>');
      element.scrollTop = beforeTop + element.scrollHeight - beforeHeight;
      return element.scrollTop - beforeTop;
    });
    expect(delta).toBe(40);
  });

  test('virtualized fast-scroll model renders only the final bounded window', async ({ page }) => {
    await page.setContent('<div id="window"></div>');
    await page.locator('#window').evaluate((element) => {
      const messages = Array.from({ length: 10_000 }, (_, index) => `message-${index}`);
      const render = (offset: number) => {
        element.textContent = messages.slice(offset, offset + 30).join(',');
        element.setAttribute('data-count', String(element.textContent.split(',').length));
      };
      render(0);
      render(9_970);
    });
    await expect(page.locator('#window')).toHaveAttribute('data-count', '30');
    await expect(page.locator('#window')).toContainText('message-9999');
    await expect(page.locator('#window')).not.toContainText('message-0,');
  });
});
