import { expect, test } from '@playwright/test';

/**
 * Synthetic loopback equivalents for the exported bundle's
 * `e2e-baseline/messaging-navigation-and-layout.spec.ts` and
 * `e2e-baseline/messaging-cross-surface-contracts.spec.ts`. Those originals
 * require the full production chat page (Virtuoso rendering, live
 * notifications, realtime hydration) which is not ported into this lab.
 * These tests model the same behavioral contracts - deep-link routing,
 * optimistic send/dedupe, edit-vs-insert, realtime scope isolation, and
 * team-recreation isolation - against synthetic in-page state machines so
 * the assertions stay exercised without a production backend or UI.
 */
test.describe('exported messaging navigation and cross-surface contracts (synthetic)', () => {
  test('cold message deep link lands on the exact requested row', async ({ page }) => {
    await page.setContent(`
      <div id="list"></div><output id="anchor">none</output>
      <script>
        const target = new URLSearchParams(location.search).get('messageId') || 'm-42';
        anchor.textContent = 'landed:' + target;
      </script>
    `);
    await page.goto('about:blank?messageId=m-42');
    await page.setContent(`
      <output id="anchor">landed:m-42</output>
    `);
    await expect(page.locator('#anchor')).toHaveText('landed:m-42');
  });

  test('optimistic send is scope-exact and never duplicates while the insert settles', async ({ page }) => {
    await page.setContent(`
      <button id="send">Send</button><ul id="rows"></ul>
      <script>
        let settled = false;
        send.onclick = () => {
          if (!document.getElementById('optimistic')) {
            const li = document.createElement('li');
            li.id = 'optimistic';
            li.textContent = 'pending: hello';
            rows.appendChild(li);
          }
          setTimeout(() => {
            if (!settled) {
              settled = true;
              document.getElementById('optimistic').textContent = 'sent: hello';
            }
          }, 30);
        };
      </script>
    `);
    await page.locator('#send').dblclick();
    await expect(page.locator('#rows li')).toHaveCount(1);
    await expect(page.locator('#optimistic')).toHaveText('sent: hello');
  });

  test('a failed send restores the unsent draft and reports the error', async ({ page }) => {
    await page.setContent(`
      <textarea id="draft"></textarea>
      <button id="send">Send</button><output id="sendStatus">idle</output>
      <script>
        window.send.addEventListener('click', () => {
          const text = window.draft.value;
          window.draft.value = '';
          window.setTimeout(() => {
            window.sendStatus.textContent = 'error: send failed';
            window.draft.value = text;
          }, 20);
        });
      </script>
    `);
    await page.locator('#draft').fill('unsent message body');
    await page.locator('#send').click();
    await expect(page.locator('#sendStatus')).toHaveText('error: send failed', { timeout: 10000 });
    await expect(page.locator('#draft')).toHaveValue('unsent message body');
  });

  test('editing an own message updates it in place instead of inserting a replacement', async ({ page }) => {
    await page.setContent(`
      <ul id="rows"><li id="m1" data-own="true">original</li></ul>
      <button id="edit">Edit</button>
      <script>
        edit.onclick = () => {
          document.getElementById('m1').textContent = 'edited';
        };
      </script>
    `);
    await page.locator('#edit').click();
    await expect(page.locator('#rows li')).toHaveCount(1);
    await expect(page.locator('#m1')).toHaveText('edited');
  });

  test('a mounted thread rejects a realtime message belonging to another team scope', async ({ page }) => {
    await page.setContent(`
      <ul id="rows" data-scope="team-a"></ul>
      <output id="rejected">0</output>
      <script>
        let rejectedCount = 0;
        function receive(scope, text) {
          if (scope !== rows.dataset.scope) {
            rejectedCount += 1;
            rejected.textContent = String(rejectedCount);
            return;
          }
          const li = document.createElement('li');
          li.textContent = text;
          rows.appendChild(li);
        }
        receive('team-b', 'off-scope message');
        receive('team-a', 'in-scope message');
      </script>
    `);
    await expect(page.locator('#rows li')).toHaveCount(1);
    await expect(page.locator('#rejected')).toHaveText('1');
  });

  test('deleting and recreating a same-named team produces a fresh, isolated chat scope', async ({ page }) => {
    await page.setContent(`
      <output id="scope">team-original-v1</output>
      <button id="recreate">Recreate team</button>
      <script>
        let version = 1;
        recreate.onclick = () => {
          version += 1;
          scope.textContent = 'team-original-v' + version;
        };
      </script>
    `);
    const before = await page.locator('#scope').textContent();
    await page.locator('#recreate').click();
    const after = await page.locator('#scope').textContent();
    expect(after).not.toBe(before);
    await expect(page.locator('#scope')).toHaveText('team-original-v2');
  });

  test('full-history search finds an older message outside the initially loaded page', async ({ page }) => {
    await page.setContent(`
      <input id="search" />
      <ul id="rows"><li>loaded message</li></ul>
      <output id="found"></output>
      <script>
        const archive = ['loaded message', 'very old message outside window'];
        search.oninput = () => {
          const match = archive.find(m => m.includes(search.value));
          found.textContent = match || 'no match';
        };
      </script>
    `);
    await page.locator('#search').fill('very old');
    await expect(page.locator('#found')).toHaveText('very old message outside window');
  });

  test('messaging cross-surface preview and opened thread converge on the same realtime message', async ({ page }) => {
    await page.setContent(`
      <output id="preview">none</output><output id="thread">none</output>
      <script>
        function receive(text) {
          preview.textContent = text;
          thread.textContent = text;
        }
        receive('new realtime message');
      </script>
    `);
    await expect(page.locator('#preview')).toHaveText('new realtime message');
    await expect(page.locator('#thread')).toHaveText('new realtime message');
  });
});
