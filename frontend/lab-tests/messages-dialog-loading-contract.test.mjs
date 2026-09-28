import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

const page = readFileSync(resolve(process.cwd(), "src/pages/MessagesPage.tsx"), "utf8");

test("MessagesPage defers inbox dialogs until user interaction", () => {
  for (const component of [
    "GlobalChatRecapSheet",
    "NewMessageSheet",
    "StartDMDialog",
    "CreateGroupDialog",
  ]) {
    assert.match(page, new RegExp(`const ${component} = lazyWithRetry`));
  }

  assert.match(page, /\{showGlobalRecap && \(/);
  assert.match(page, /\{showNewMessageSheet && \(/);
  assert.match(page, /showDMDialog && \(/);
  assert.match(page, /showCustomGroupDialog && \(/);
  assert.match(page, /canCreateGroups && showGroupDialog && \(/);
});
