import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { keepComposerFocusedThroughSend } from "@/lib/chatComposerFocus";

/**
 * Guard: sending a chat message must never blur the composer.
 *
 * On Android a `blur()` → `focus()` round-trip (even on the next tick)
 * reaches the IME as a real keyboard hide + show. Capacitor then fires
 * keyboardWillHide/keyboardWillShow, the keyboard-height hooks collapse and
 * restore the chat viewport, and the whole thread visibly jumps up and back
 * after every send. Composer state already mirrors IME composition updates,
 * so no blur-to-flush is needed.
 */
const SEND_SURFACES = [
  "TeamChatPage.tsx",
  "DirectMessagePage.tsx",
  "GroupChatPage.tsx",
  "ClubChatPage.tsx",
  "ClubAdminChatPage.tsx",
  "BroadcastChatPage.tsx",
];

const root = join(__dirname, "..");
const read = (rel: string) => readFileSync(join(root, rel), "utf8");

describe("chat send keeps the keyboard stable", () => {
  for (const file of SEND_SURFACES) {
    describe(file, () => {
      const src = read(join("pages", file));

      it("does not blur the composer to flush the IME", () => {
        expect(src).not.toMatch(/imeFlushed/);
        expect(src).not.toMatch(/ae\.blur\(\)/);
        // No `.blur()` followed by a deferred handleSend anywhere in the file.
        expect(src).not.toMatch(/\.blur\(\);\s*setTimeout\(\(\) => \{\s*handleSend/);
      });

      if (file !== "BroadcastChatPage.tsx") {
        it("hands focus back to the composer if the send button stole it", () => {
          expect(src).toContain("keepComposerFocusedThroughSend(composerRef.current)");
        });
      }
    });
  }

  describe("ChatSendButton", () => {
    const src = read("components/chat/ChatSendButton.tsx");

    it("prevents the button from taking focus on pointerdown", () => {
      const start = src.indexOf("const startLongPress = (e: React.PointerEvent) => {");
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, start + 700);
      expect(body).toContain("e.preventDefault();");
    });

    it("prevents the compat mousedown focus change", () => {
      expect(src).toMatch(/onMouseDown=\{preventFocusSteal\}/);
    });
  });

  describe("useNativeAndroidKeyboardState", () => {
    const src = read("hooks/useNativeAndroidKeyboardState.ts");

    it("holds keyboard hide for a grace window that a show can cancel", () => {
      expect(src).toContain("HIDE_GRACE_MS");
      const show = src.indexOf("const handleShow = ");
      const hide = src.indexOf("const handleHide = ");
      expect(src.slice(show, hide)).toContain("clearTimeout(hideTimer)");
      expect(src.slice(hide, hide + 500)).toContain("window.setTimeout(");
    });
  });
});

describe("keepComposerFocusedThroughSend", () => {
  const mount = () => {
    document.body.innerHTML = `
      <div id="composer" data-chat-composer="true">
        <textarea id="ta" data-chat-composer="true"></textarea>
        <button id="send" data-chat-send-button="true" type="button"></button>
      </div>
      <button id="other" type="button"></button>
    `;
    return {
      composer: document.getElementById("composer") as HTMLElement,
      ta: document.getElementById("ta") as HTMLTextAreaElement,
      send: document.getElementById("send") as HTMLButtonElement,
      other: document.getElementById("other") as HTMLButtonElement,
    };
  };

  it("returns focus to the textarea when the send button took it", () => {
    const { composer, ta, send } = mount();
    send.focus();
    expect(document.activeElement).toBe(send);
    keepComposerFocusedThroughSend(composer);
    expect(document.activeElement).toBe(ta);
  });

  it("leaves focus alone when the textarea is already focused", () => {
    const { composer, ta } = mount();
    ta.focus();
    keepComposerFocusedThroughSend(composer);
    expect(document.activeElement).toBe(ta);
  });

  it("does not summon the keyboard when focus is elsewhere (not the send button)", () => {
    const { composer, other } = mount();
    other.focus();
    keepComposerFocusedThroughSend(composer);
    expect(document.activeElement).toBe(other);
  });

  it("falls back to the nearest composer when no root is passed", () => {
    const { ta, send } = mount();
    send.focus();
    keepComposerFocusedThroughSend();
    expect(document.activeElement).toBe(ta);
  });
});
