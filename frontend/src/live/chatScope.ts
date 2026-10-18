/** Which club a chat belongs to, for group routing. Pure (no ICP imports):
 * safe in the app's start-up bundle. */
import type { ClubScope } from "./featureRouter";

/** Chat kind + id as used across the app (scope_type / scope.kind). */
export function scopeForChat(kind: string | null | undefined, id: string | null | undefined): ClubScope | undefined {
  if (kind === "broadcast" || kind === "global") return { shared: "app" };
  if (!id) return undefined;
  if (kind === "club") return { clubId: id };
  if (kind === "team") return { teamId: id };
  if (kind === "group" || kind === "club_admin" || kind === "dm" || kind === "direct") return { conversationId: id };
  return undefined;
}

/** The chat open on screen, from the page address. undefined = not a chat
 * page: group routing then refuses the call rather than guessing. */
export function chatScopeFromPath(pathname: string): ClubScope | undefined {
  const p = pathname.replace(/\/+$/, "");
  if (p === "/messages/broadcast") return { shared: "app" };
  if (p === "/messages/welcome") return { shared: "person" };
  let m = p.match(/^\/messages\/club\/([^/]+)$/); if (m) return { clubId: decodeURIComponent(m[1]) };
  m = p.match(/^\/messages\/(?:dm|club-admin)\/([^/]+)$/); if (m) return { conversationId: decodeURIComponent(m[1]) };
  m = p.match(/^\/groups\/([^/]+)$/); if (m) return { conversationId: decodeURIComponent(m[1]) };
  m = p.match(/^\/messages\/([^/]+)$/); if (m) return { teamId: decodeURIComponent(m[1]) };
  return undefined;
}

/** Read at call time (the app uses browser-path routing). */
export function currentChatScope(): ClubScope | undefined {
  return typeof window === "undefined" ? undefined : chatScopeFromPath(window.location.pathname);
}

/** Add a write marker to an optional chat scope. */
export function chatWrite(scope: ClubScope | undefined): ClubScope | undefined {
  return scope ? { ...scope, writeKey: "once", attempts: 1 } : undefined;
}
