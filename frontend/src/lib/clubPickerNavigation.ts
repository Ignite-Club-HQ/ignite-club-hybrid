import { resolveRouteClubScope } from "./routeClubScope";

/** Explicit picker gestures only: never infer ownership through network reads. */
export function clubPickerDestination(
  pathname: string,
  search: string,
  previousClubId: string | null,
  nextClubId: string | null,
): string | null {
  if (!nextClubId || nextClubId === previousClubId) return null;
  const scope = resolveRouteClubScope(pathname);
  if (scope.kind === "direct" && scope.clubId === nextClubId) return null;
  const root = pathname.split("/").filter(Boolean)[0];
  const params = new URLSearchParams(search);
  if (root === "media" && (scope.kind !== "none" || params.toString())) return "/media";
  if (root === "vault" && (scope.kind !== "none" || params.toString())) return "/vault";
  if (root === "news" && pathname !== "/news" && pathname !== "/news/") return "/news";
  if (scope.kind === "none") return null;
  if (root === "messages" || root === "groups") return "/messages";
  if (root === "events") return "/events";
  if (root === "clubs") return "/clubs";
  if (root === "competitions") return "/competitions";
  return "/";
}