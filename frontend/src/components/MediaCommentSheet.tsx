import { useState, useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { Send, X, ChevronLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { PhotoComment } from "@/components/PhotoComment";
import { CommentRepliesThread } from "@/components/CommentRepliesThread";
import { EmojiPicker } from "@/components/chat/EmojiPicker";
import { useIOSOverlayScrollLock } from "@/hooks/useIOSOverlayScrollLock";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";
import { useSignedPhotoUrl } from "@/hooks/useSignedPhotoUrl";
import { usePhotoMentionSuggestions, type MentionUser } from "@/hooks/usePhotoMentionSuggestions";

interface CommentData {
  id: string;
  text: string;
  user_id: string;
  reply_to_id?: string | null;
  created_at: string;
  profiles?: {
    display_name?: string | null;
    avatar_url?: string | null;
  };
}

interface MediaCommentSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  photoUrl: string;
  uploaderName: string | null;
  uploaderAvatar?: string | null;
  teamName?: string | null;
  /** Audience scope of the post — restricts who can be @mentioned. */
  teamId?: string | null;
  clubId?: string | null;
  miniLeagueId?: string | null;
  comments: CommentData[];
  commentInput: string;
  onCommentInputChange: (value: string) => void;
  onSubmitComment: () => void;
  isPending?: boolean;
  replyingTo?: { id: string; name: string } | null;
  onSetReplyingTo: (reply: { id: string; name: string } | undefined) => void;
  currentUserId?: string;
}

export function MediaCommentSheet({
  open,
  onOpenChange,
  photoUrl,
  uploaderName,
  uploaderAvatar,
  teamName,
  teamId,
  clubId,
  miniLeagueId,
  comments,
  commentInput,
  onCommentInputChange,
  onSubmitComment,
  isPending,
  replyingTo,
  onSetReplyingTo,
  currentUserId,
}: MediaCommentSheetProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const [isCommentInteracting, setIsCommentInteracting] = useState(false);
  const [isReactionGestureActive, setIsReactionGestureActive] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [browserKbInset, setBrowserKbInset] = useState(0);
  const [webViewportHeight, setWebViewportHeight] = useState<number | null>(null);
  const [androidVisibleHeight, setAndroidVisibleHeight] = useState<number | null>(null);
  const [androidKeyboardActive, setAndroidKeyboardActive] = useState(false);
  const capacitorPlatform = Capacitor.getPlatform();
  const isNative = Capacitor.isNativePlatform();
  const isNativeIOS = isNative && capacitorPlatform === "ios";
  const isNativeAndroid = isNative && capacitorPlatform === "android";
  const isIOS = (() => {
    if (typeof navigator === "undefined") return isNativeIOS;
    const ua = navigator.userAgent;
    const isIOSDevice = /iPad|iPhone|iPod/.test(ua);
    const isIpadDesktop = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return isNativeIOS || isIOSDevice || isIpadDesktop;
  })();
  const nativeKeyboardHeight = useNativeKeyboardHeight();
  const { signedUrl: resolvedPhotoUrl } = useSignedPhotoUrl(photoUrl);
  const previewPhotoUrl = resolvedPhotoUrl || photoUrl;

  useIOSOverlayScrollLock(open);

  useEffect(() => {
    if (!open || typeof document === "undefined") return;
    const root = document.documentElement;
    const previousValue = root.getAttribute("data-media-comments-open");
    root.setAttribute("data-media-comments-open", "true");
    return () => {
      if (previousValue === null) root.removeAttribute("data-media-comments-open");
      else root.setAttribute("data-media-comments-open", previousValue);
    };
  }, [open]);

  useEffect(() => {
    setImgError(false);
  }, [previewPhotoUrl]);

  // Disable native iOS keyboard scroll (prevents the WebView shifting the whole viewport)
  useEffect(() => {
    if (!isNativeIOS) return;
    Keyboard.setScroll({ isDisabled: open }).catch(() => {});
    return () => {
      Keyboard.setScroll({ isDisabled: false }).catch(() => {});
    };
  }, [isNativeIOS, open]);

  // Web fallback: derive keyboard inset from visualViewport (covers Android mobile web)
  useEffect(() => {
    if (!open || isNative) {
      setBrowserKbInset(0);
      setWebViewportHeight(null);
      return;
    }
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    if (!vv) {
      setWebViewportHeight(typeof window !== "undefined" ? window.innerHeight : null);
      return;
    }

    let baseline = vv.height;
    const update = () => {
      if (vv.height > baseline) baseline = vv.height;
      const overlap = Math.max(0, baseline - vv.height - vv.offsetTop);
      setWebViewportHeight(Math.round(vv.height));
      setBrowserKbInset(overlap > 80 ? Math.round(overlap) : 0);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [open, isNative]);

  // Native Android comment sheets should size to the visible area above the IME
  // instead of keeping a full-height sheet and pushing the composer with a large
  // padding value. Some OEM WebViews report a partially/fully resized viewport;
  // others only report the Capacitor keyboard height. Measuring both keeps the
  // text input visible without reintroducing the old blank-gap double offset.
  useLayoutEffect(() => {
    if (!open || !isNativeAndroid || typeof window === "undefined" || typeof document === "undefined") {
      setAndroidVisibleHeight(null);
      setAndroidKeyboardActive(false);
      return;
    }

    const readRootPx = (name: string) => {
      const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const sync = () => {
      const lockedHeight = readRootPx("--visual-vh") || window.innerHeight || 0;
      const layoutHeight = window.innerHeight || lockedHeight;
      const visualViewport = window.visualViewport;
      const visualHeight = visualViewport?.height ? Math.round(visualViewport.height) : 0;
      const viewportShrank = lockedHeight > 0 && visualHeight > 0 && lockedHeight - visualHeight > 24;
      const pluginVisibleHeight = nativeKeyboardHeight > 24 && lockedHeight > 0
        ? lockedHeight - nativeKeyboardHeight
        : 0;

      let nextHeight = lockedHeight || layoutHeight || visualHeight || null;
      let keyboardIsActive = false;

      if (viewportShrank) {
        nextHeight = visualHeight;
        keyboardIsActive = true;
      } else if (pluginVisibleHeight > 0) {
        nextHeight = Math.min(nextHeight || pluginVisibleHeight, pluginVisibleHeight);
        keyboardIsActive = true;
      } else if (layoutHeight > 0 && lockedHeight > 0 && lockedHeight - layoutHeight > 24) {
        nextHeight = layoutHeight;
        keyboardIsActive = true;
      }

      if (nextHeight && lockedHeight > 0) {
        nextHeight = Math.min(lockedHeight, nextHeight);
      }

      const roundedHeight = nextHeight ? Math.round(nextHeight) : null;
      setAndroidVisibleHeight((current) => (current === roundedHeight ? current : roundedHeight));
      setAndroidKeyboardActive((current) => (current === keyboardIsActive ? current : keyboardIsActive));
    };

    sync();
    const raf = window.requestAnimationFrame(sync);
    const t = window.setTimeout(sync, 120);
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearTimeout(t);
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
    };
  }, [open, isNativeAndroid, nativeKeyboardHeight]);

  const keyboardInset = isNativeAndroid ? 0 : isNative ? nativeKeyboardHeight : browserKbInset;
  const isKeyboardActive = isNativeAndroid ? androidKeyboardActive : keyboardInset > 0;
  // Native Android: --visual-vh is monotonic-max locked to the full window
  // height (StatusBarManager), so it never shrinks when an OEM WebView defies
  // Keyboard.resize:'none' and shrinks innerHeight on IME open. Using
  // --stable-vh here (which is NOT locked on Android) made the sheet height
  // drop by the keyboard amount while the composer still added
  // paddingBottom = keyboardInset — a double subtraction that floated the
  // input a full keyboard-height above the actual keyboard (big white gap).
  // iOS keeps --stable-vh (monotonic-locked there) so the fixed sheet extends
  // under the IME and the single paddingBottom lifts the composer.
  const screenHeight = isNative
    ? (isNativeAndroid ? (androidVisibleHeight ? `${androidVisibleHeight}px` : "var(--visual-vh, 100dvh)") : "var(--stable-vh, 100dvh)")
    : webViewportHeight
      ? `${webViewportHeight}px`
      : "var(--visual-vh, 100dvh)";

  const getCommentViewport = useCallback(() => {
    const root = scrollAreaRef.current;
    if (!root) return null;
    return (root.querySelector("[data-radix-scroll-area-viewport]") as HTMLDivElement | null)
      ?? (root.firstElementChild as HTMLDivElement | null);
  }, []);

  const scrollCommentsToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = getCommentViewport();
    if (!viewport) return;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
  }, [getCommentViewport]);

  const stabilizeIOSViewport = useCallback(() => {
    if (!isIOS || typeof window === "undefined") return;
    window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
  }, [isIOS]);

  const restoreInputFocus = useCallback(() => {
    const t = textareaRef.current;
    if (!t) return;
    const s = t.selectionStart ?? t.value.length;
    const e = t.selectionEnd ?? t.value.length;
    t.focus({ preventScroll: true });
    try {
      t.setSelectionRange(s, e);
    } catch {
      // Some mobile browsers reject selection restoration during keyboard transitions.
    }
  }, []);

  const blurComposer = useCallback(() => {
    const t = textareaRef.current;
    if (t && document.activeElement === t) t.blur();
  }, []);

  const handleReactionGestureStateChange = useCallback((active: boolean) => {
    if (!active) { setIsReactionGestureActive(false); return; }
    const t = textareaRef.current;
    if (t && document.activeElement === t) restoreInputFocus();
    setIsReactionGestureActive(true);
  }, [restoreInputFocus]);

  // Animate in
  useEffect(() => {
    if (open) requestAnimationFrame(() => setIsVisible(true));
    else setIsVisible(false);
  }, [open]);

  useEffect(() => {
    if (isCommentInteracting && textareaRef.current) {
      const t = setTimeout(() => textareaRef.current?.focus({ preventScroll: true }), 50);
      return () => clearTimeout(t);
    }
  }, [isCommentInteracting]);

  useEffect(() => {
    if (!open || (!isReactionGestureActive && !isCommentInteracting)) return;
    const t = textareaRef.current;
    if (!t || document.activeElement !== t) return;
    const refocus = () => restoreInputFocus();
    refocus();
    const t1 = window.setTimeout(refocus, 0);
    const t2 = window.setTimeout(refocus, 120);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [open, isReactionGestureActive, isCommentInteracting, restoreInputFocus]);

  // Auto-resize textarea
  useEffect(() => {
    const t = textareaRef.current;
    if (!t) return;
    t.style.height = "auto";
    t.style.height = Math.min(t.scrollHeight, 110) + "px";
  }, [commentInput]);

  useEffect(() => {
    if (!open) {
      blurComposer();
      setIsCommentInteracting(false);
    }
  }, [open, blurComposer]);

  useEffect(() => {
    if (!open || !isIOS || !isKeyboardActive) return;
    const run = () => stabilizeIOSViewport();
    run();
    const f = window.requestAnimationFrame(run);
    const t1 = window.setTimeout(run, 180);
    return () => { window.cancelAnimationFrame(f); window.clearTimeout(t1); };
  }, [open, isIOS, isKeyboardActive, stabilizeIOSViewport]);

  // Scroll to bottom when new comments appear or keyboard opens
  useEffect(() => {
    if (!open) return;
    const behavior: ScrollBehavior = isIOS || isKeyboardActive ? "auto" : "smooth";
    scrollCommentsToBottom(behavior);
    const f = window.requestAnimationFrame(() => scrollCommentsToBottom("auto"));
    const t = window.setTimeout(() => scrollCommentsToBottom("auto"), 140);
    return () => { window.cancelAnimationFrame(f); window.clearTimeout(t); };
  }, [comments.length, open, isKeyboardActive, isIOS, scrollCommentsToBottom]);

  const handleComposerFocus = useCallback(() => {
    if (!isIOS) return;
    stabilizeIOSViewport();
    window.requestAnimationFrame(stabilizeIOSViewport);
    window.setTimeout(stabilizeIOSViewport, 120);
  }, [isIOS, stabilizeIOSViewport]);

  const handleSubmit = useCallback(() => {
    if (!commentInput.trim()) return;
    onSubmitComment();
  }, [commentInput, onSubmitComment]);

  // ---- @mention autocomplete ----
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionAnchorPos, setMentionAnchorPos] = useState<number | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  const mentionOpen = mentionAnchorPos !== null;
  const { data: mentionUsers = [] } = usePhotoMentionSuggestions(
    { teamId, clubId, miniLeagueId },
    mentionSearch,
    open && mentionOpen,
  );

  const detectMentionTrigger = useCallback((text: string, caret: number) => {
    if (caret <= 0) {
      setMentionAnchorPos(null);
      setMentionSearch("");
      return;
    }
    const before = text.slice(0, caret);
    const atIdx = before.lastIndexOf("@");
    if (atIdx < 0) {
      setMentionAnchorPos(null);
      setMentionSearch("");
      return;
    }
    // Must be at start or preceded by whitespace
    const prevChar = atIdx === 0 ? " " : before[atIdx - 1];
    if (!/\s/.test(prevChar) && atIdx !== 0) {
      setMentionAnchorPos(null);
      setMentionSearch("");
      return;
    }
    const query = before.slice(atIdx + 1);
    // Cancel if query contains whitespace/newline or closes a completed mention
    if (/[\s\])]/.test(query)) {
      setMentionAnchorPos(null);
      setMentionSearch("");
      return;
    }
    if (query.length > 30) {
      setMentionAnchorPos(null);
      setMentionSearch("");
      return;
    }
    setMentionAnchorPos(atIdx);
    setMentionSearch(query);
    setMentionSelectedIndex(0);
  }, []);

  const handleTextareaChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onCommentInputChange(v);
    detectMentionTrigger(v, e.target.selectionStart ?? v.length);
  }, [onCommentInputChange, detectMentionTrigger]);

  const handleTextareaSelect = useCallback((e: React.SyntheticEvent<HTMLTextAreaElement>) => {
    const t = e.currentTarget;
    detectMentionTrigger(t.value, t.selectionStart ?? t.value.length);
  }, [detectMentionTrigger]);

  const insertMention = useCallback((user: MentionUser) => {
    if (mentionAnchorPos === null || !user.display_name) return;
    const t = textareaRef.current;
    const caret = t?.selectionStart ?? (mentionAnchorPos + 1 + mentionSearch.length);
    const removeLen = caret - mentionAnchorPos; // covers "@" + query
    const insertion = `@[${user.display_name}](${user.id}) `;
    const next = commentInput.slice(0, mentionAnchorPos) + insertion + commentInput.slice(mentionAnchorPos + removeLen);
    onCommentInputChange(next);
    setMentionAnchorPos(null);
    setMentionSearch("");
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      const pos = mentionAnchorPos + insertion.length;
      try { ta.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  }, [mentionAnchorPos, mentionSearch, commentInput, onCommentInputChange]);

  const handleEmojiSelect = useCallback((emoji: string) => {
    const t = textareaRef.current;
    const caret = t?.selectionStart ?? commentInput.length;
    const next = commentInput.slice(0, caret) + emoji + commentInput.slice(caret);
    onCommentInputChange(next);
    requestAnimationFrame(() => {
      const ta = textareaRef.current;
      if (!ta) return;
      ta.focus({ preventScroll: true });
      const pos = caret + emoji.length;
      try { ta.setSelectionRange(pos, pos); } catch { /* ignore */ }
    });
  }, [commentInput, onCommentInputChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mentionOpen && mentionUsers.length > 0) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setMentionSelectedIndex((i) => (i + 1) % mentionUsers.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setMentionSelectedIndex((i) => (i - 1 + mentionUsers.length) % mentionUsers.length);
        return;
      }
      if (e.key === "Tab" || (e.key === "Enter" && !e.shiftKey)) {
        e.preventDefault();
        insertMention(mentionUsers[mentionSelectedIndex]);
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setMentionAnchorPos(null);
        setMentionSearch("");
        return;
      }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }, [mentionOpen, mentionUsers, mentionSelectedIndex, insertMention, handleSubmit]);

  const handleClose = useCallback(() => {
    blurComposer();
    setIsVisible(false);
    setTimeout(() => onOpenChange(false), isIOS ? 180 : 220);
  }, [blurComposer, isIOS, onOpenChange]);

  if (!open) return null;

  const hasText = commentInput.trim().length > 0;
  const topLevelComments = comments.filter(c => !c.reply_to_id);

  const content = (
    <div
      className={`media-comment-screen fixed inset-0 flex flex-col overflow-hidden overscroll-none bg-background ease-out ${
        isIOS
          ? `transition-opacity duration-200 ${isVisible ? "opacity-100" : "opacity-0 pointer-events-none"}`
          : `transition-transform duration-300 ${isVisible ? "translate-y-0" : "translate-y-full"}`
      }`}
      style={{
        zIndex: 2147483647,
        width: "100vw",
        height: screenHeight,
        maxHeight: screenHeight,
        minHeight: 0,
        transform: isIOS ? "translate3d(0,0,0)" : undefined,
      }}
      data-lock-keyboard-scroll="true"
      role="dialog"
      aria-modal="true"
      aria-label="Comments"
    >
      {/* Safe-area top spacer */}
      <div
        className="flex-shrink-0 bg-background"
        style={{ height: "var(--safe-area-top, env(safe-area-inset-top, 0px))" }}
      />

      {/* Compact sticky media context header */}
      <header className="flex items-center gap-3 px-2 py-2 border-b border-border/60 flex-shrink-0 bg-background">
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 flex-shrink-0"
          onClick={handleClose}
          aria-label="Close comments"
        >
          <ChevronLeft className="h-5 w-5" />
        </Button>

        {!imgError && previewPhotoUrl ? (
          <img
            src={previewPhotoUrl}
            alt=""
            onError={() => setImgError(true)}
            className="h-10 w-10 rounded-md object-cover flex-shrink-0 bg-muted"
          />
        ) : (
          <div className="h-10 w-10 rounded-md bg-muted flex-shrink-0" />
        )}

        <div className="flex flex-col min-w-0 flex-1 leading-tight">
          <span className="text-[14px] font-semibold truncate">
            {uploaderName || "Photo"}
          </span>
          <span className="text-[12px] text-muted-foreground truncate">
            {teamName ? `${teamName} · ` : ""}{comments.length} {comments.length === 1 ? "comment" : "comments"}
          </span>
        </div>
      </header>

      {/* Comment list — fills remaining space */}
      <ScrollArea
        ref={scrollAreaRef}
        className="flex-1 min-h-0"
        style={{ pointerEvents: isCommentInteracting ? "none" : "auto" }}
      >
        {topLevelComments.length === 0 ? (
          <div className="px-4 pt-8 pb-4 text-center">
            <p className="text-sm font-medium text-foreground">No comments yet</p>
            <p className="text-xs text-muted-foreground mt-1">Be the first to comment</p>
          </div>
        ) : (
          <div className="px-4 pt-3 pb-4 space-y-3">
            {topLevelComments.map((comment) => {
              const replies = comments.filter(c => c.reply_to_id === comment.id);
              return (
                <div key={comment.id}>
                  <PhotoComment
                    id={comment.id}
                    text={comment.text}
                    userId={comment.user_id}
                    displayName={comment.profiles?.display_name}
                    avatarUrl={comment.profiles?.avatar_url}
                    currentUserId={currentUserId}
                    createdAt={comment.created_at}
                    onInteractionChange={setIsCommentInteracting}
                    onLongPressGestureStateChange={handleReactionGestureStateChange}
                    onReply={(commentId, name) => {
                      onSetReplyingTo({ id: commentId, name });
                      window.setTimeout(() => textareaRef.current?.focus({ preventScroll: isIOS }), 100);
                    }}
                  />
                  <CommentRepliesThread
                    replies={replies}
                    parentDisplayName={comment.profiles?.display_name}
                    currentUserId={currentUserId}
                    onInteractionChange={setIsCommentInteracting}
                    onLongPressGestureStateChange={handleReactionGestureStateChange}
                    onReply={(commentId, name) => {
                      onSetReplyingTo({ id: commentId, name });
                      window.setTimeout(() => textareaRef.current?.focus({ preventScroll: isIOS }), 100);
                    }}
                  />
                </div>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Composer — slim pill, docked above keyboard */}
      <div
        className="flex-shrink-0 bg-background border-t border-border/60 transition-[padding] duration-150 ease-out"
        style={{
          paddingBottom: isNativeAndroid && isKeyboardActive
            ? "6px"
            : isNative && isKeyboardActive
            ? `${keyboardInset + 6}px`
            : "calc(var(--safe-area-bottom, env(safe-area-inset-bottom, 0px)) + 8px)",
        }}
      >
        {replyingTo && (
          <div className="flex items-center gap-2 px-4 py-1.5 bg-muted/40 border-b border-border/60">
            <span className="text-xs text-muted-foreground truncate flex-1">
              Replying to <span className="text-foreground font-medium">{replyingTo.name}</span>
            </span>
            <Button
              variant="ghost"
              size="sm"
              className="h-6 w-6 p-0"
              onClick={() => onSetReplyingTo(undefined)}
              aria-label="Cancel reply"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {/* Mention suggestions */}
        {mentionOpen && mentionUsers.length > 0 && (
          <div className="px-3 pb-1">
            <div
              className="rounded-2xl border border-border/40 bg-popover shadow-lg overflow-hidden max-h-56 overflow-y-auto"
              role="listbox"
              aria-label="Mention suggestions"
              onMouseDown={(e) => e.preventDefault()}
            >
              <div className="px-3 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
                Tag someone
              </div>
              <div className="px-1 pb-1">
                {mentionUsers.map((u, idx) => {
                  const selected = idx === mentionSelectedIndex;
                  const name = u.display_name || "";
                  return (
                    <button
                      key={u.id}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      className={`w-full flex items-center gap-2.5 px-2 py-1.5 rounded-xl text-left transition-colors ${
                        selected ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.04]"
                      }`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => insertMention(u)}
                    >
                      <Avatar className="h-7 w-7 shrink-0">
                        <AvatarImage src={u.avatar_url || undefined} />
                        <AvatarFallback className="text-[10px]">
                          {name.charAt(0).toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex-1 min-w-0 truncate text-[13px] text-foreground/90">
                        {name}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div className="px-3 pt-2">
          <div className="relative flex min-h-[52px] items-center gap-1.5 bg-muted/60 rounded-3xl px-1.5 py-1 focus-within:bg-muted/80 transition-colors">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center">
              <EmojiPicker onEmojiSelect={handleEmojiSelect} />
            </div>
            <textarea
              ref={textareaRef}
              value={commentInput}
              onChange={handleTextareaChange}
              onFocus={handleComposerFocus}
              onKeyDown={handleKeyDown}
              onSelect={handleTextareaSelect}
              onClick={handleTextareaSelect}
              placeholder={replyingTo ? `Reply to ${replyingTo.name}…` : "Add a comment…"}
              rows={1}
              // Use the OS keyboard's native spellcheck for the red squiggle —
              // mentions/URLs are naturally ignored by Gboard/QuickType so this
              // doesn't fight usernames, club/team names, emails or emoji.
              spellCheck
              autoCorrect="on"
              autoCapitalize="sentences"
              inputMode="text"
              className={`flex-1 min-w-0 resize-none bg-transparent placeholder:text-muted-foreground focus:outline-none min-h-[40px] max-h-[110px] px-1 py-2.5 leading-5 ${isIOS ? "text-base" : "text-[15px]"}`}
              style={isIOS ? { fontSize: "16px" } : undefined}
            />
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isPending || !hasText}
              className={`h-10 w-10 shrink-0 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity ${
                hasText ? "opacity-100" : "opacity-40 pointer-events-none"
              }`}
              aria-label="Send comment"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );

  if (typeof document === "undefined") return content;
  return createPortal(content, document.body);
}
