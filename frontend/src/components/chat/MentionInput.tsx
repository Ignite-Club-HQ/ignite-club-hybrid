import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { supabase } from "@/integrations/supabase/client";
import { LinkPreview } from "./LinkPreview";
import { EmojiPicker } from "./EmojiPicker";
import { EventLinkCard } from "./EventLinkCard";
import { VaultFileCard } from "./VaultFileCard";
import { Capacitor } from "@capacitor/core";
import { X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

interface MentionInputProps {
  value: string;
  onChange: (value: string) => void;
  onKeyPress?: (e: React.KeyboardEvent) => void;
  onInputChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  teamId?: string;
  clubId?: string;
  groupId?: string;
  /** DM: the other participant's user id. Restricts mentions to {me, other}. */
  dmOtherUserId?: string;
  /** Club-admin thread: the member's user id. Restricts mentions to {member, club admins of clubId}. */
  clubAdminMemberUserId?: string;
  /** Disable mentions entirely (e.g. broadcast chat). */
  disableMentions?: boolean;
  showEmojiPicker?: boolean;
  /** Optional: enables a "GIF" tab in the emoji picker. Receives the selected GIF URL. */
  onGifSelect?: (gifUrl: string) => void;
  /**
   * When true, the input renders without its own pill background — the parent
   * (ChatComposerShell) provides the unified container instead. Used by the
   * redesigned WhatsApp/iMessage-style composer.
   */
  bare?: boolean;
}

interface SuggestedUser {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
}

// Mention format: @[DisplayName](userId)
const MENTION_REGEX = /@\[([^\]]+)\]\(([^)]+)\)/g;
const EVENT_TOKEN_RE = /\[event:([0-9a-f-]{36})\]/gi;

// URL detection regex
const URL_REGEX = /https?:\/\/[^\s]+/g;

/**
 * Parse raw value into segments of plain text and mentions.
 * Each mention segment includes its raw string, display text, and position in the raw string.
 */
interface RawSegment {
  type: "text" | "mention" | "event" | "vault-file" | "vault-folder" | "vault-root";
  raw: string;       // the raw string in value
  display: string;   // what the user sees: for mentions it's "@DisplayName"
  rawStart: number;  // start index in raw value
  rawEnd: number;    // end index in raw value
  userId?: string;
  displayName?: string;
  eventId?: string;
  vaultId?: string;
  vaultRootScope?: "team" | "club";
}

function parseRawValue(raw: string): RawSegment[] {
  const segments: RawSegment[] = [];
  // Order: mention, event, vaultroot, vaultfolder, vault file
  const regex = /(@\[([^\]]+)\]\(([^)]+)\))|(\[event:([0-9a-f-]{36})\])|(\[vaultroot:(team|club):([0-9a-f-]{36})\])|(\[vaultfolder:([0-9a-f-]{36})\])|(\[vault:([0-9a-f-]{36})\])/gi;
  let lastEnd = 0;
  let match;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastEnd) {
      const textPart = raw.slice(lastEnd, match.index);
      segments.push({
        type: "text",
        raw: textPart,
        display: textPart,
        rawStart: lastEnd,
        rawEnd: match.index,
      });
    }

    if (match[1]) {
      segments.push({
        type: "mention",
        raw: match[0],
        display: `@${match[2]}`,
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        userId: match[3],
        displayName: match[2],
      });
    } else if (match[4]) {
      segments.push({
        type: "event",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        eventId: match[5],
      });
    } else if (match[6]) {
      const scope = (match[7] || "").toLowerCase() as "team" | "club";
      segments.push({
        type: "vault-root",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        vaultId: match[8],
        vaultRootScope: scope,
      });
    } else if (match[9]) {
      segments.push({
        type: "vault-folder",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        vaultId: match[10],
      });
    } else if (match[11]) {
      segments.push({
        type: "vault-file",
        raw: match[0],
        display: "",
        rawStart: match.index,
        rawEnd: match.index + match[0].length,
        vaultId: match[12],
      });
    }

    lastEnd = match.index + match[0].length;
  }

  if (lastEnd < raw.length) {
    segments.push({
      type: "text",
      raw: raw.slice(lastEnd),
      display: raw.slice(lastEnd),
      rawStart: lastEnd,
      rawEnd: raw.length,
    });
  }

  return segments;
}

function segmentsToDisplay(segments: RawSegment[]): string {
  return segments.map(s => s.display).join("");
}

/**
 * Convert a cursor position in display space to raw space.
 */
function displayToRawCursor(segments: RawSegment[], displayPos: number): number {
  let dispAccum = 0;
  for (const seg of segments) {
    const segDisplayLen = seg.display.length;
    if (dispAccum + segDisplayLen >= displayPos) {
      if (seg.type !== "text") {
        // If cursor is within a mention display, snap to start or end
        const offset = displayPos - dispAccum;
        return offset <= segDisplayLen / 2 ? seg.rawStart : seg.rawEnd;
      }
      return seg.rawStart + (displayPos - dispAccum);
    }
    dispAccum += segDisplayLen;
  }
  return segments.length > 0 ? segments[segments.length - 1].rawEnd : 0;
}

/**
 * Convert a cursor position in raw space to display space.
 */
function rawToDisplayCursor(segments: RawSegment[], rawPos: number): number {
  let dispAccum = 0;
  for (const seg of segments) {
    if (rawPos <= seg.rawStart) {
      return dispAccum;
    }
    if (rawPos < seg.rawEnd) {
      if (seg.type !== "text") {
        return dispAccum; // snap to start of mention
      }
      return dispAccum + (rawPos - seg.rawStart);
    }
    dispAccum += seg.display.length;
  }
  return dispAccum;
}

/**
 * Given old raw value, old segments, and a new display string + cursor,
 * reconstruct the new raw value preserving mentions that weren't edited.
 */
function reconstructRawFromDisplayEdit(
  oldSegments: RawSegment[],
  oldDisplay: string,
  newDisplay: string,
  cursorInNewDisplay: number
): string {
  // Simple diff: find common prefix and suffix between old and new display
  let prefixLen = 0;
  while (
    prefixLen < oldDisplay.length &&
    prefixLen < newDisplay.length &&
    oldDisplay[prefixLen] === newDisplay[prefixLen]
  ) {
    prefixLen++;
  }

  let suffixLen = 0;
  while (
    suffixLen < oldDisplay.length - prefixLen &&
    suffixLen < newDisplay.length - prefixLen &&
    oldDisplay[oldDisplay.length - 1 - suffixLen] === newDisplay[newDisplay.length - 1 - suffixLen]
  ) {
    suffixLen++;
  }

  const oldEditStart = prefixLen;
  const oldEditEnd = oldDisplay.length - suffixLen;
  const newEditStart = prefixLen;
  const newEditEnd = newDisplay.length - suffixLen;
  const insertedText = newDisplay.slice(newEditStart, newEditEnd);

  // Map display positions to raw positions
  const rawEditStart = displayToRawCursor(oldSegments, oldEditStart);
  const rawEditEnd = displayToRawCursor(oldSegments, oldEditEnd);

  // Check if edit range covers any mentions partially or fully
  // If a mention is partially in the edit range, remove the entire mention
  let actualRawStart = rawEditStart;
  let actualRawEnd = rawEditEnd;

  for (const seg of oldSegments) {
    if (seg.type !== "text") {
      // If the edit overlaps with this mention at all, remove the entire mention
      if (seg.rawStart < actualRawEnd && seg.rawEnd > actualRawStart) {
        actualRawStart = Math.min(actualRawStart, seg.rawStart);
        actualRawEnd = Math.max(actualRawEnd, seg.rawEnd);
      }
    }
  }

  // Rebuild: prefix raw + inserted text + suffix raw
  const rawBefore = oldSegments.length > 0
    ? oldSegments[0].raw.length > 0
      ? getRawUpTo(oldSegments, actualRawStart)
      : ""
    : "";
  const rawAfter = getRawFrom(oldSegments, actualRawEnd);

  return rawBefore + insertedText + rawAfter;
}

function getRawUpTo(segments: RawSegment[], rawPos: number): string {
  let result = "";
  for (const seg of segments) {
    if (seg.rawEnd <= rawPos) {
      result += seg.raw;
    } else if (seg.rawStart < rawPos) {
      if (seg.type !== "text") {
        // Don't include partial mentions
      } else {
        result += seg.raw.slice(0, rawPos - seg.rawStart);
      }
      break;
    } else {
      break;
    }
  }
  return result;
}

function getRawFrom(segments: RawSegment[], rawPos: number): string {
  let result = "";
  for (const seg of segments) {
    if (seg.rawStart >= rawPos) {
      result += seg.raw;
    } else if (seg.rawEnd > rawPos) {
      if (seg.type !== "text") {
        // Don't include partial mentions
      } else {
        result += seg.raw.slice(rawPos - seg.rawStart);
      }
    }
  }
  return result;
}

export function MentionInput({
  value,
  onChange,
  onKeyPress,
  onInputChange,
  disabled,
  placeholder,
  className,
  teamId,
  clubId,
  groupId,
  dmOtherUserId,
  clubAdminMemberUserId,
  disableMentions = false,
  showEmojiPicker = true,
  onGifSelect,
  bare = false,
}: MentionInputProps) {
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState("");
  const [mentionStartIndex, setMentionStartIndex] = useState(-1); // in display space
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const highlightRef = useRef<HTMLDivElement>(null);
  const touchYRef = useRef<number | null>(null);
  const isComposingRef = useRef(false);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

  // Parse segments from raw value
  const segments = useMemo(() => parseRawValue(value), [value]);
  const displayValue = useMemo(() => segmentsToDisplay(segments), [segments]);

  // Auto-resize textarea
  const adjustHeight = useCallback(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    // Skip layout thrash while IME composition is active — forcing
    // height='auto' + reading scrollHeight can re-enter Gboard's composing
    // region and cause autocorrect suggestions to lose characters
    // ("becaus ei" instead of "because"). We re-run after compositionend.
    if (isComposingRef.current) return;
    textarea.style.height = 'auto';
    // Cap at ~4 visible lines (20px line-height × 4 + 12px top + 12px bottom
    // padding = 104px). Keeps composer compact so more conversation stays
    // visible above the keyboard, matching WhatsApp/Messenger.
    const maxHeight = 104;
    const overflowing = textarea.scrollHeight > maxHeight;
    textarea.style.height = `${Math.min(textarea.scrollHeight, maxHeight)}px`;
    textarea.style.overflowY = overflowing ? 'auto' : 'hidden';
    // Allow vertical pan/drag inside the textarea when content overflows so
    // the user can scroll back to the top of a long draft (matches native).
    textarea.style.touchAction = overflowing ? 'pan-y' : 'auto';
    // Keep the caret visible while typing: if the cursor is at the end of
    // the draft, follow it to the bottom of the scroll region.
    if (overflowing) {
      const atEnd = textarea.selectionStart === textarea.value.length;
      if (atEnd) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    }
    if (highlightRef.current) {
      highlightRef.current.scrollTop = textarea.scrollTop;
    }
  }, []);

  // Resize synchronously in the SAME commit that changes `value`. Deferring
  // this to a rAF meant the textarea collapsed one frame after the send
  // commit (and after the message row had already been pinned), so the
  // composer height — and therefore the list footer — moved a frame late and
  // the thread visibly stepped. The IME guard lives inside `adjustHeight`.
  useLayoutEffect(() => {
    if (isComposingRef.current) return;
    adjustHeight();
  }, [value, adjustHeight]);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;

    const syncHighlightScroll = () => {
      if (highlightRef.current) {
        highlightRef.current.scrollTop = textarea.scrollTop;
      }
    };

    const handleTouchStart = (event: TouchEvent) => {
      touchYRef.current = event.touches[0]?.clientY ?? null;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const previousY = touchYRef.current;
      const currentY = event.touches[0]?.clientY ?? null;
      if (previousY == null || currentY == null) return;

      const maxScrollTop = textarea.scrollHeight - textarea.clientHeight;
      if (maxScrollTop <= 1) return;

      const nextScrollTop = Math.max(0, Math.min(maxScrollTop, textarea.scrollTop + previousY - currentY));
      touchYRef.current = currentY;

      if (Math.abs(nextScrollTop - textarea.scrollTop) < 0.5) return;

      textarea.scrollTop = nextScrollTop;
      syncHighlightScroll();
      event.preventDefault();
      event.stopPropagation();
    };

    const handleTouchEnd = () => {
      touchYRef.current = null;
    };

    textarea.addEventListener("touchstart", handleTouchStart, { passive: true });
    textarea.addEventListener("touchmove", handleTouchMove, { passive: false });
    textarea.addEventListener("touchend", handleTouchEnd);
    textarea.addEventListener("touchcancel", handleTouchEnd);

    return () => {
      textarea.removeEventListener("touchstart", handleTouchStart);
      textarea.removeEventListener("touchmove", handleTouchMove);
      textarea.removeEventListener("touchend", handleTouchEnd);
      textarea.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, []);

  const detectedUrls = useMemo(() => {
    const matches = value.match(URL_REGEX) || [];
    return [...new Set(matches)].slice(0, 3);
  }, [value]);

  const hasEventToken = useMemo(() => /\[event:[0-9a-f-]{36}\]/i.test(value), [value]);
  const hasVaultToken = useMemo(
    () => /\[(?:vault|vaultfolder|vaultroot:(?:team|club)):[0-9a-f-]{36}\]/i.test(value),
    [value],
  );
  const hideTextareaPlaceholder = hasEventToken || hasVaultToken;

  const eventIds = useMemo(
    () => [...new Set(Array.from(value.matchAll(/\[event:([0-9a-f-]{36})\]/gi), (match) => match[1]).filter(Boolean))].slice(0, 3),
    [value]
  );

  const vaultFileIds = useMemo(
    () => [...new Set(Array.from(value.matchAll(/\[vault:([0-9a-f-]{36})\]/gi), (m) => m[1]).filter(Boolean))].slice(0, 3),
    [value],
  );
  const vaultFolderIds = useMemo(
    () => [...new Set(Array.from(value.matchAll(/\[vaultfolder:([0-9a-f-]{36})\]/gi), (m) => m[1]).filter(Boolean))].slice(0, 3),
    [value],
  );
  const vaultRoots = useMemo(() => {
    const seen = new Set<string>();
    const out: { scope: "team" | "club"; id: string }[] = [];
    for (const m of value.matchAll(/\[vaultroot:(team|club):([0-9a-f-]{36})\]/gi)) {
      const scope = (m[1] || "").toLowerCase() as "team" | "club";
      const id = (m[2] || "").toLowerCase();
      const key = `${scope}:${id}`;
      if (!seen.has(key)) {
        seen.add(key);
        out.push({ scope, id });
      }
    }
    return out.slice(0, 3);
  }, [value]);

  const removeEventToken = useCallback((eventId: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[event:${eventId}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);

  const removeVaultFileToken = useCallback((id: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[vault:${id}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);
  const removeVaultFolderToken = useCallback((id: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[vaultfolder:${id}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);
  const removeVaultRootToken = useCallback((scope: "team" | "club", id: string) => {
    onChange(value.replace(new RegExp(`\\s*\\[vaultroot:${scope}:${id}\\]\\s*`, "i"), " ").replace(/\s{2,}/g, " ").trim());
  }, [onChange, value]);

  const { user: currentUser } = useAuth();

  // Fetch the set of users who are actually members of this chat thread.
  // Mentions are strictly scoped to thread participants so users can't be
  // notified into threads they don't belong to.
  const { data: users } = useQuery({
    queryKey: [
      "mention-users",
      teamId,
      clubId,
      groupId,
      dmOtherUserId,
      clubAdminMemberUserId,
      currentUser?.id,
      mentionSearch,
    ],
    queryFn: async () => {
      let userIds: string[] = [];

      if (dmOtherUserId) {
        userIds = [dmOtherUserId, currentUser?.id].filter(Boolean) as string[];
      } else if (clubAdminMemberUserId && clubId) {
        const { data: admins } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId)
          .eq("role", "club_admin");
        userIds = [
          ...new Set([
            clubAdminMemberUserId,
            ...(admins?.map((r) => r.user_id) || []),
          ]),
        ];
      } else if (groupId) {
        const { data: group } = await supabase
          .from("chat_groups")
          .select("team_id, club_id, membership_mode, allowed_roles, mini_league_id")
          .eq("id", groupId)
          .maybeSingle();

        const mlId = (group as any)?.mini_league_id as string | null | undefined;
        const mode = (group as any)?.membership_mode as string | null | undefined;
        const allowedRoles = ((group as any)?.allowed_roles as string[] | null | undefined) || [];

        if (mlId) {
          // Mini-league: league admins + per-league admins + parents of players
          const [leagueRow, perLeagueAdmins, players] = await Promise.all([
            supabase.from("mini_leagues").select("club_id").eq("id", mlId).maybeSingle(),
            supabase.from("mini_league_admins").select("user_id").eq("mini_league_id", mlId),
            supabase
              .from("mini_league_players")
              .select("parent_user_id")
              .eq("mini_league_id", mlId)
              .not("parent_user_id", "is", null),
          ]);
          const ids = new Set<string>();
          const mlClubId = (leagueRow.data as any)?.club_id as string | undefined;
          if (mlClubId) {
            const { data: clubRoles } = await supabase
              .from("user_roles")
              .select("user_id")
              .eq("club_id", mlClubId)
              .eq("role", "league_admin");
            (clubRoles || []).forEach((r) => ids.add(r.user_id));
          }
          (perLeagueAdmins.data || []).forEach((a) => ids.add(a.user_id));
          (players.data || []).forEach((p: any) => p.parent_user_id && ids.add(p.parent_user_id));
          userIds = Array.from(ids);
        } else if ((!group?.team_id && !group?.club_id) || mode === "manual") {
          // Manual / personal group: use explicit group_members
          const { data: gm } = await supabase
            .from("group_members")
            .select("user_id")
            .eq("group_id", groupId);
          userIds = [...new Set((gm || []).map((m) => m.user_id))];
        } else if (group?.team_id) {
          let q = supabase
            .from("user_roles")
            .select("user_id")
            .eq("team_id", group.team_id);
          if (allowedRoles.length > 0) q = q.in("role", allowedRoles as any);
          const { data: roles } = await q;
          userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
        } else if (group?.club_id) {
          let q = supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", group.club_id);
          if (allowedRoles.length > 0) q = q.in("role", allowedRoles as any);
          const { data: roles } = await q;
          userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
        }
      } else if (teamId) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("team_id", teamId);
        userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
      } else if (clubId) {
        const { data: roles } = await supabase
          .from("user_roles")
          .select("user_id")
          .eq("club_id", clubId);
        userIds = [...new Set(roles?.map((r) => r.user_id) || [])];
      }

      // Strict: if no scope resolved any members, do NOT fall back to a
      // global profile search — that would let users be tagged into threads
      // they don't belong to.
      if (userIds.length === 0) return [] as SuggestedUser[];

      const { data } = await supabase
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", userIds)
        .not("display_name", "is", null)
        .ilike("display_name", `%${mentionSearch}%`)
        .limit(5);

      return (data || []) as SuggestedUser[];
    },
    enabled: !disableMentions && showSuggestions && mentionSearch.length >= 0,
  });


  // Highlighted segments for the overlay
  const highlightedSegments = useMemo(() => {
    return segments.map((seg, i) => ({
      text: seg.display,
      isMention: seg.type === "mention",
      isEvent: seg.type === "event",
      key: i,
    }));
  }, [segments]);

  // Check for @ mention trigger in display text
  const checkForMentionTrigger = useCallback((text: string, cursorPos: number) => {
    if (disableMentions) return;
    const textBeforeCursor = text.slice(0, cursorPos);
    const lastAtIndex = textBeforeCursor.lastIndexOf("@");



    if (lastAtIndex !== -1) {
      const textAfterAt = textBeforeCursor.slice(lastAtIndex + 1);
      // Don't trigger if there's a space or newline after @
      if (!textAfterAt.includes(" ") && !textAfterAt.includes("\n")) {
        // Check if this @ is part of an existing mention display (e.g. "@John")
        // We need to verify this isn't an already-completed mention
        let isMentionDisplay = false;
        let dispAccum = 0;
        for (const seg of segments) {
          if (seg.type === "mention") {
            const mentionStart = dispAccum;
            const mentionEnd = dispAccum + seg.display.length;
            if (lastAtIndex >= mentionStart && lastAtIndex < mentionEnd) {
              isMentionDisplay = true;
              break;
            }
          }
          dispAccum += seg.display.length;
        }

        if (!isMentionDisplay) {
          setShowSuggestions(true);
          setMentionSearch(textAfterAt);
          setMentionStartIndex(lastAtIndex);
          setSelectedIndex(0);
          return;
        }
      }
    }

    setShowSuggestions(false);
    setMentionSearch("");
    setMentionStartIndex(-1);
  }, [segments, disableMentions]);

  const handleDisplayChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newDisplay = e.target.value;
    const cursorPos = e.target.selectionStart || 0;

    if (newDisplay === displayValue) return;

    // NOTE: we deliberately do NOT early-return while `isComposingRef.current`
    // is true. Android Gboard fires `compositionstart` on essentially every
    // keystroke, and skipping `onChange` here causes the controlled
    // `displayValue` to lag the textarea — React then re-renders with the
    // stale `value` and wipes the in-flight characters, making typing appear
    // impossible to the user (reported by real users: "I can't type, I have
    // to send an image"). The original autocorrect-clobber bug this gate
    // tried to fix actually came from `adjustHeight` thrashing layout during
    // composition; that's still gated inside `adjustHeight` itself.
    // Reconstruction of the raw value is safe here because for plain-text
    // edits (no mention overlap) the result equals the new display string,
    // so React performs no DOM write and Gboard's pending suggestion is
    // preserved.

    // Reconstruct raw value from display edit
    const newRaw = reconstructRawFromDisplayEdit(segments, displayValue, newDisplay, cursorPos);

    onChange(newRaw);
    adjustHeight();

    // Check for mention trigger
    checkForMentionTrigger(newDisplay, cursorPos);
  }, [segments, displayValue, onChange, adjustHeight, checkForMentionTrigger]);


  const handleCompositionStart = useCallback(() => {
    isComposingRef.current = true;
  }, []);

  const handleCompositionEnd = useCallback((e: React.CompositionEvent<HTMLTextAreaElement>) => {
    // Defer clearing the composing flag + re-firing the change handler until
    // AFTER Gboard's final `input` event lands in the same task. If we read
    // e.target.value synchronously here we capture pre-correction text and
    // then clobber the IME's final commit, producing garbled output like
    // "becaus ei" or "wmotional". rAF gives the browser one frame to flush
    // the corrected value into the textarea before we reconstruct raw value.
    requestAnimationFrame(() => {
      isComposingRef.current = false;
      const textarea = inputRef.current;
      if (!textarea) return;
      // Synthesize a change event from the textarea's CURRENT value (post-commit)
      // rather than the stale composition event target.
      const synthetic = {
        target: textarea,
        currentTarget: textarea,
      } as unknown as React.ChangeEvent<HTMLTextAreaElement>;
      handleDisplayChange(synthetic);
      adjustHeight();
    });
  }, [handleDisplayChange, adjustHeight]);

  const insertMention = useCallback((user: SuggestedUser) => {
    if (mentionStartIndex === -1 || !user.display_name) return;

    // mentionStartIndex is in display space, pointing to the "@"
    // We need to replace from "@" + mentionSearch in raw space
    const rawStartIndex = displayToRawCursor(segments, mentionStartIndex);

    // The raw text at this position should be "@" + mentionSearch
    const rawMention = `@[${user.display_name}](${user.id}) `;

    // Calculate what to remove: the "@" + search text
    const removeLength = 1 + mentionSearch.length; // "@" + search text
    const rawEndIndex = rawStartIndex + removeLength;

    const newRaw = value.slice(0, rawStartIndex) + rawMention + value.slice(rawEndIndex);

    onChange(newRaw);
    setShowSuggestions(false);
    setMentionSearch("");
    setMentionStartIndex(-1);

    // Focus and set cursor after the inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        const newSegments = parseRawValue(newRaw);
        const newDisplayVal = segmentsToDisplay(newSegments);
        // Find cursor position after the mention + space
        const rawCursorPos = rawStartIndex + rawMention.length;
        const displayCursorPos = rawToDisplayCursor(newSegments, rawCursorPos);
        inputRef.current.setSelectionRange(displayCursorPos, displayCursorPos);
      }
    }, 0);
  }, [mentionStartIndex, mentionSearch, value, onChange, segments]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Backspace at the end of a mention → delete the entire mention tag.
    if (e.key === "Backspace" && !e.shiftKey) {
      const ta = e.currentTarget;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      if (start === end && start > 0) {
        let dispAccum = 0;
        let rawAccum = 0;
        for (const seg of segments) {
          const segDispEnd = dispAccum + seg.display.length;
          const segRawEnd = rawAccum + seg.raw.length;
          if (seg.type === "mention" && start === segDispEnd) {
            e.preventDefault();
            const newRaw = value.slice(0, rawAccum) + value.slice(segRawEnd);
            onChange(newRaw);
            setTimeout(() => {
              if (inputRef.current) {
                inputRef.current.focus();
                const newSegs = parseRawValue(newRaw);
                const newDispCursor = rawToDisplayCursor(newSegs, rawAccum);
                inputRef.current.setSelectionRange(newDispCursor, newDispCursor);
              }
            }, 0);
            return;
          }
          dispAccum = segDispEnd;
          rawAccum = segRawEnd;
        }
      }
    }

    if (!showSuggestions || !users || users.length === 0) {
      // On iOS native, Enter should insert a newline (matches iMessage / WhatsApp).
      // Sending is done via the explicit Send button. On desktop, Enter still sends
      // and Shift+Enter inserts a newline.
      if (e.key === "Enter" && !e.shiftKey && !isNativeIOS && onKeyPress) {
        e.preventDefault();
        onKeyPress(e);
      }
      return;
    }


    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev + 1) % users.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((prev) => (prev - 1 + users.length) % users.length);
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      if (users[selectedIndex]) {
        insertMention(users[selectedIndex]);
      }
    } else if (e.key === "Escape") {
      setShowSuggestions(false);
    }
  }, [showSuggestions, users, selectedIndex, insertMention, onKeyPress, isNativeIOS, segments, value, onChange]);

  // Close suggestions when clicking outside (but not inside our component)
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  const handleEmojiSelect = useCallback((emoji: string) => {
    const cursorPos = inputRef.current?.selectionStart || displayValue.length;
    // Convert display cursor to raw cursor for insertion
    const rawCursorPos = displayToRawCursor(segments, cursorPos);
    const newValue = value.slice(0, rawCursorPos) + emoji + value.slice(rawCursorPos);
    onChange(newValue);

    setTimeout(() => {
      if (isNativeIOS) {
        (document.activeElement as HTMLElement | null)?.blur();
        return;
      }

      inputRef.current?.focus();
      const newSegments = parseRawValue(newValue);
      const newDisplayCursor = rawToDisplayCursor(newSegments, rawCursorPos + emoji.length);
      inputRef.current?.setSelectionRange(newDisplayCursor, newDisplayCursor);
    }, 0);
  }, [value, onChange, isNativeIOS, segments, displayValue]);

  // In bare mode, pull the emoji button toward the + attachment button so they
  // read as a single [+ 😊] control group (WhatsApp-style). The textarea
  // inside still expands via flex-1, so typing width is preserved.
  return (
    <div ref={containerRef} className={`relative flex-1 min-w-0 max-w-full ${bare ? "self-end" : "self-stretch ml-1"} space-y-2`}>



      {/* URL Previews */}
      {detectedUrls.length > 0 && (
        <div className="w-full min-w-0 max-w-full max-h-28 space-y-2 overflow-x-hidden overflow-y-auto overscroll-contain pr-1">
          {detectedUrls.map((url) => (
            <LinkPreview
              key={url}
              url={url}
              compact
              onRemove={() => onChange(value.replace(url, "").trim())}
            />
          ))}
        </div>
      )}

      {eventIds.length > 0 && (
        <div className="w-full min-w-0 max-w-full space-y-2">
          {eventIds.map((eventId) => (
            <div key={eventId} className="flex items-center gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <EventLinkCard eventId={eventId} />
              </div>
              <button
                type="button"
                onClick={() => removeEventToken(eventId)}
                aria-label="Remove event"
                className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {(vaultRoots.length > 0 || vaultFolderIds.length > 0 || vaultFileIds.length > 0) && (
        <div className="w-full min-w-0 max-w-full space-y-2">
          {vaultRoots.map((r) => (
            <div key={`vr-${r.scope}-${r.id}`} className="flex items-center gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <VaultFileCard rootScope={r.scope} rootId={r.id} />
              </div>
              <button
                type="button"
                onClick={() => removeVaultRootToken(r.scope, r.id)}
                aria-label="Remove attachment"
                className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {vaultFolderIds.map((id) => (
            <div key={`vf-${id}`} className="flex items-center gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <VaultFileCard folderId={id} />
              </div>
              <button
                type="button"
                onClick={() => removeVaultFolderToken(id)}
                aria-label="Remove folder"
                className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
          {vaultFileIds.map((id) => (
            <div key={`vfile-${id}`} className="flex items-center gap-2 min-w-0 max-w-full">
              <div className="min-w-0 flex-1">
                <VaultFileCard fileId={id} />
              </div>
              <button
                type="button"
                onClick={() => removeVaultFileToken(id)}
                aria-label="Remove file"
                className="shrink-0 inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      <div
        className={
          bare
            ? "flex w-full min-w-0 max-w-full items-end overflow-hidden gap-0 pl-0 pr-1 min-h-10"
            : "flex w-full min-w-0 max-w-full items-center overflow-hidden rounded-2xl bg-muted/55 dark:bg-muted/40 pl-0.5 pr-1 min-h-9 ring-0 focus-within:bg-muted/70 dark:focus-within:bg-muted/55 focus-within:ring-1 focus-within:ring-ring/40 transition-[background-color,box-shadow] duration-150"
        }
      >
        {showEmojiPicker && (
          // 48dp dedicated emoji/GIF target with extra hit-padding on every
          // side. Taps inside the padding also open the picker — we forward
          // pointerdown to the inner [data-emoji-button] so users don't
          // accidentally focus the textarea when aiming for the emoji icon.
          // Padding gap to the textarea keeps quick emoji access while
          // protecting the message input from accidental edge taps.
          <div
            className={`flex items-center justify-center h-10 shrink-0 transition-all duration-200 animate-in fade-in zoom-in-95 ${bare ? "-ml-1" : "mr-1"}`}
            onPointerDown={(e) => {
              const target = e.target as HTMLElement;
              // PopoverContent renders in a React portal, so React events from
              // INSIDE the open picker (e.g. the GIF search input) bubble up
              // through the React tree to this handler even though the DOM
              // target lives in document.body. Only forward taps whose DOM
              // target is physically inside this wrapper — otherwise tapping
              // the GIF search box re-toggled the trigger and closed the popup.
              if (!e.currentTarget.contains(target)) return;
              if (target.closest('[data-emoji-button]')) return;
              const btn = e.currentTarget.querySelector<HTMLButtonElement>('[data-emoji-button]');
              if (!btn) return;
              e.preventDefault();
              e.stopPropagation();
              btn.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }));
            }}
          >
            <EmojiPicker onEmojiSelect={handleEmojiSelect} onGifSelect={onGifSelect} disabled={disabled} />
          </div>
        )}



        <div className="relative flex-1 min-w-0 max-w-full overflow-hidden">
          {/* Highlight overlay for mentions */}
          {!isNativeIOS && (
            <div
              ref={highlightRef}
              aria-hidden="true"
              className="absolute inset-0 pointer-events-none overflow-hidden pl-0 pr-0.5 text-[16px] whitespace-pre-wrap break-words text-transparent flex items-center"
              style={{ maxHeight: '104px', overflowWrap: 'anywhere', wordBreak: 'break-word', lineHeight: '20px', paddingTop: '10px', paddingBottom: '10px' }}

            >
              <div className="w-full">
                {highlightedSegments.map((seg) =>
                  seg.isMention ? (
                    <span key={seg.key} className="rounded px-0.5 bg-primary/15 text-transparent">{seg.text}</span>
                  ) : (
                    <span key={seg.key}>{seg.text}</span>
                  )
                )}
              </div>
            </div>
          )}
          <textarea
            ref={inputRef}
            value={displayValue}
            onChange={handleDisplayChange}
            onKeyDown={handleKeyDown}
            onCompositionStart={handleCompositionStart}
            onCompositionEnd={handleCompositionEnd}
            onScroll={() => {
              if (highlightRef.current && inputRef.current) {
                highlightRef.current.scrollTop = inputRef.current.scrollTop;
              }
            }}
            disabled={disabled}
            placeholder={hideTextareaPlaceholder ? "" : placeholder}
            rows={1}
            wrap="soft"
            autoComplete="off"
            autoCorrect="on"
            autoCapitalize="sentences"
            inputMode="text"
            spellCheck
            enterKeyHint="enter"
            aria-label={placeholder || "Message"}
            aria-multiline="true"
            role="textbox"
            data-chat-composer="true"
            className={`relative block w-full min-w-0 max-w-full resize-none break-words border-none bg-transparent pl-0 pr-0.5 text-[16px] outline-none placeholder:text-foreground/35 placeholder:font-normal dark:placeholder:text-foreground/30 disabled:cursor-not-allowed disabled:opacity-50 ${hideTextareaPlaceholder ? "font-medium" : ""} ${className || ''}`}
            style={{ width: '100%', maxHeight: '104px', maxWidth: '100%', overflowX: 'hidden', overflowY: 'hidden', overflowWrap: 'anywhere', wordBreak: 'break-word', boxSizing: 'border-box', WebkitUserSelect: 'text', userSelect: 'text', WebkitTouchCallout: 'default', touchAction: 'auto', lineHeight: '20px', paddingTop: '10px', paddingBottom: '10px', verticalAlign: 'middle', WebkitOverflowScrolling: 'touch' } as React.CSSProperties}

          />
        </div>
      </div>

      {showSuggestions && users && users.length > 0 && (
        <div
          className="absolute bottom-full left-1 mb-2 z-50 w-fit min-w-[200px] max-w-[min(320px,calc(100%-0.5rem))] rounded-2xl border border-border/40 bg-popover shadow-[0_10px_30px_-12px_rgba(0,0,0,0.35)] dark:shadow-[0_12px_32px_-10px_rgba(0,0,0,0.7)] overflow-hidden animate-in fade-in slide-in-from-bottom-1 duration-150"
          onClick={(e) => e.stopPropagation()}
          role="listbox"
          aria-label="Mention suggestions"
        >
          <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-muted-foreground/70">
            Mention
          </div>
          <div className="px-1 pb-1">
            {users.map((user, index) => {
              const isSelected = index === selectedIndex;
              const name = user.display_name || "";
              // Highlight matching substring
              const lowerName = name.toLowerCase();
              const lowerQ = mentionSearch.toLowerCase();
              const matchIdx = lowerQ ? lowerName.indexOf(lowerQ) : -1;
              const before = matchIdx >= 0 ? name.slice(0, matchIdx) : name;
              const match = matchIdx >= 0 ? name.slice(matchIdx, matchIdx + mentionSearch.length) : "";
              const after = matchIdx >= 0 ? name.slice(matchIdx + mentionSearch.length) : "";

              return (
                <button
                  key={user.id}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className={`relative w-full flex items-center gap-2.5 pl-2 pr-3 py-1.5 rounded-xl text-left transition-colors ${
                    isSelected
                      ? "bg-foreground/[0.06] dark:bg-foreground/[0.08]"
                      : "hover:bg-foreground/[0.04]"
                  }`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => insertMention(user)}
                >
                  {isSelected && (
                    <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary/70" />
                  )}
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarImage src={user.avatar_url || undefined} />
                    <AvatarFallback className="text-[10px] bg-muted text-muted-foreground">
                      {name.charAt(0).toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="flex-1 min-w-0 truncate text-[13px] leading-tight text-foreground/90">
                    {matchIdx >= 0 ? (
                      <>
                        {before}
                        <span className="text-primary font-medium">{match}</span>
                        {after}
                      </>
                    ) : (
                      name
                    )}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
