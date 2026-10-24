import type { QueryClient } from "@tanstack/react-query";
import type { ClubScope } from "@/live/featureRouter";
import { chatScopeFromPath } from "@/live/chatScope";
import { groupChatReadScope } from "./groupChatScope";

/** A chat location is a routing hint, never proof of file ownership/access. */
export function chatVaultLocation(client: QueryClient, userId: string | undefined, pathname: string): ClubScope | undefined {
  const scope = chatScopeFromPath(pathname);
  if (!scope) return undefined;
  if ("clubId" in scope || "teamId" in scope) return scope;
  if ("conversationId" in scope && pathname.startsWith("/groups/")) {
    const owner = groupChatReadScope(client, userId, scope.conversationId);
    if ("clubId" in owner) return owner;
  }
  return undefined;
}

/** Same-club shares skip the all-group resource scan. Cross-club shares still discover. */
export async function readChatVaultCard<T>(
  location: ClubScope | undefined,
  resource: ClubScope,
  read: (scope: ClubScope) => Promise<T | null>,
): Promise<T | null> {
  if (location) {
    const row = await read(location);
    if (row !== null) return row;
  }
  return read(resource);
}