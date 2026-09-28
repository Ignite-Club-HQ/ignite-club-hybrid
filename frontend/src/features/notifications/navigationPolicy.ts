export type ChatJumpKind = "team" | "club" | "group" | "dm" | "broadcast" | "club_admin";

export type ChatTarget = {
  kind: ChatJumpKind;
  targetId: string | null;
  messageId: string;
  path: string;
};

export type ChatTargetResolution =
  | { status: "found"; target: ChatTarget }
  | { status: "not_found"; target: null }
  | { status: "unreachable"; target: null };

export const NOTIFICATION_FALLBACK_PATH = "/messages";

export function chatTargetPath(
  kind: ChatJumpKind,
  targetId: string | null,
  messageId: string,
): string {
  switch (kind) {
    case "team": return targetId ? `/messages/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "club": return targetId ? `/messages/club/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "group": return targetId ? `/groups/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "dm": return targetId ? `/messages/dm/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "club_admin": return targetId ? `/messages/club-admin/${targetId}?message=${messageId}` : NOTIFICATION_FALLBACK_PATH;
    case "broadcast": return `/messages/broadcast?message=${messageId}`;
    default: return NOTIFICATION_FALLBACK_PATH;
  }
}
