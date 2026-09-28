/**
 * Keeps the chat composer focused (and therefore the soft keyboard open and
 * at a stable height) across a Send tap.
 *
 * Why this exists: the send handlers used to `blur()` the textarea to flush
 * the IME composition and re-`focus()` it on the next tick. On Android that
 * blur → refocus round-trip reaches the InputMethodManager as a real
 * hide + show, so Capacitor fires `keyboardWillHide` followed by
 * `keyboardWillShow`. Our keyboard-height hooks dutifully collapsed the
 * chat viewport to full height (composer drops to the bottom nav, thread
 * grows) and then restored it a few frames later — the "thread jumps up and
 * back" seen after sending. The composer's React state already mirrors every
 * IME composition update (see mem://features/chat/composer-ime-composition-gate),
 * so no flush is needed: we send exactly what the user sees.
 *
 * The only remaining way focus can leave the textarea during a send is the
 * send `<button>` itself stealing it (Chrome/Android focuses buttons on tap).
 * `ChatSendButton` prevents that at the pointer level; this helper is the
 * belt-and-braces fallback that hands focus straight back in the same task,
 * before the WebView has a chance to tell the IME anything changed.
 */
export function keepComposerFocusedThroughSend(composerRoot?: HTMLElement | null) {
  if (typeof document === "undefined") return;
  const active = document.activeElement as HTMLElement | null;
  if (!active) return;
  // Textarea/input still focused — nothing to do.
  if (active.tagName === "TEXTAREA" || active.tagName === "INPUT") return;
  // Only intervene when the send control took focus. If nothing editable was
  // focused before the tap (e.g. sending via a hardware keyboard shortcut or
  // a picker flow), we must not summon the keyboard.
  if (!active.closest?.("[data-chat-send-button]")) return;

  const root = composerRoot ?? (active.closest?.('[data-chat-composer="true"]') as HTMLElement | null) ?? document;
  const textarea = root.querySelector?.<HTMLTextAreaElement | HTMLInputElement>(
    'textarea[data-chat-composer="true"], textarea, input[data-chat-composer="true"]',
  );
  if (!textarea) return;
  try {
    textarea.focus({ preventScroll: true } as FocusOptions);
  } catch {
    /* noop */
  }
}
