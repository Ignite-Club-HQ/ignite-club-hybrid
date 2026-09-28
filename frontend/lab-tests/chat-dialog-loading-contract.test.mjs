import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const pages = ["DirectMessagePage.tsx", "ScheduledMessagesPage.tsx"];
const source = name => fs.readFileSync(new URL(`../src/pages/${name}`, import.meta.url), "utf8");

test("scheduling dialogs remain interaction-only route dependencies", () => {
  for (const page of pages) {
    const text = source(page);
    assert.doesNotMatch(
      text,
      /import\s*\{\s*ScheduleMessageDialog\s*\}\s*from\s*["']@\/components\/chat\/ScheduleMessageDialog["']/,
      `${page} must not eagerly import the scheduling dialog`,
    );
    assert.match(text, /lazyWithRetry/, `${page} must use retry-safe lazy loading`);
    assert.match(text, /<Suspense fallback=\{null\}>/, `${page} must provide a local suspense boundary`);
  }
});
