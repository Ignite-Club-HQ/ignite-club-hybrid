import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const root = resolve(process.cwd(), "src");
const source = (relative) => readFileSync(resolve(root, relative), "utf8");

test("chat attachment pickers defer all three dialogs until opened", () => {
  const pickers = source("components/chat/ChatAttachmentPickers.tsx");
  for (const component of ["EventPickerSheet", "NewsPickerSheet", "BoardPickerSheet"]) {
    assert.match(pickers, new RegExp(`const ${component} = lazyWithRetry`));
  }
  assert.match(pickers, /\{eventPickerOpen && \(/);
  assert.match(pickers, /\{newsPickerOpen && \(/);
  assert.match(pickers, /\{boardPickerOpen && \(/);
});

test("the four attachment-capable chat pages use the shared picker orchestration", () => {
  for (const page of [
    "pages/TeamChatPage.tsx",
    "pages/ClubChatPage.tsx",
    "pages/GroupChatPage.tsx",
    "pages/DirectMessagePage.tsx",
  ]) {
    const text = source(page);
    assert.match(text, /<ChatAttachmentPickers/);
    assert.doesNotMatch(text, /<EventPickerSheet/);
    assert.doesNotMatch(text, /<NewsPickerSheet/);
    assert.doesNotMatch(text, /<BoardPickerSheet/);
  }
});
