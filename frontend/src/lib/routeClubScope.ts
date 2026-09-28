/**
 * Route → owning club resolution.
 *
 * A number of routes render content that belongs to exactly one club (a team,
 * a club chat, a group chat, an event, a mini-league, a vault folder …). When
 * the user changes the active club filter from the header picker, staying on
 * another club's content is a scoping leak: the chrome says club B while the
 * body still shows club A.
 *
 * This module describes, purely from the pathname, *how* to resolve the owning
 * club for the current route:
 *  - `{ kind: "none" }`      → route is not club-scoped (lists, admin, profile…)
 *  - `{ kind: "direct" }`    → the club id is already in the URL
 *  - `{ kind: "lookup" }`    → a single-column lookup resolves the owning club
 *
 * Lookups are intentionally one column on one row so they are cheap and highly
 * cacheable. `nullable: true` means a NULL club_id is legitimate (e.g. personal
 * chat groups, team-only events) and must NOT be treated as a mismatch.
 */

export type ClubScopeTable =
  | "teams"
  | "events"
  | "chat_groups"
  | "mini_leagues"
  | "vault_folders"
  | "club_admin_conversations"
  | "photos"
  | "club_links";

export type RouteClubScope =
  | { kind: "none" }
  | { kind: "direct"; clubId: string }
  | { kind: "lookup"; table: ClubScopeTable; id: string }
  /**
   * Competitions span clubs: the owning club is the organiser, but every club
   * with an entered team is also legitimately "in" the competition. The guard
   * resolves the full set of participating clubs and bounces only when the newly
   * selected club is in none of them.
   */
  | { kind: "membership"; competitionId: string }
  /**
   * Direct messages have no owning club column, but DM eligibility IS club
   * based (`can_dm_user`). A DM with a member of club A must not stay open once
   * the filter moves to club B unless the other participant is also a member of
   * club B. The guard resolves the other participant and checks membership.
   */
  | { kind: "dm"; conversationId: string };

const seg = (pathname: string) => pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);

/**
 * Routes that are deliberately exempt because their content spans clubs or is
 * not club-owned at all (app admin tools, the user's own profile, competitions
 * and associations which are cross-club by design, DMs, public pages).
 */
const EXEMPT_ROOTS = new Set([
  "admin",
  "associations",
  "profile",
  "edit-profile",
  "account",
  "settings",
  "notifications",
  "children",
  "roles",
  "reports",
  "auth",
  "join",
  "join-club",
  "j",
  "eoi",
  "eoi-embed",
  "eoi-complete",
  "claim-team",
  "terms",
  "privacy",
  "cancellation",
  "video-guide",
  "share",
  "c",
  "signup-pro",
  "complete-profile",
  "reset-password",
  "verify-reset-code",
]);

export function resolveRouteClubScope(pathname: string): RouteClubScope {
  const parts = seg(pathname);
  if (parts.length === 0) return { kind: "none" };
  const [root, a, b, c] = parts;

  if (EXEMPT_ROOTS.has(root)) return { kind: "none" };

  switch (root) {
    // /clubs/:clubId/** — the club id is the first param
    case "clubs":
      if (!a || a === "new") return { kind: "none" };
      return { kind: "direct", clubId: a };

    // /competitions/:id/** — allowed for the organiser club and any entered club
    case "competitions":
      if (!a || a === "new" || a === "join") return { kind: "none" };
      return { kind: "membership", competitionId: a };

    case "pay-fees":
      return a ? { kind: "direct", clubId: a } : { kind: "none" };

    // /teams/:teamId/**
    case "teams":
      if (!a || a === "new") return { kind: "none" };
      return { kind: "lookup", table: "teams", id: a };

    // /events/:id/**
    case "events":
      if (!a || a === "new" || a === "import") return { kind: "none" };
      return { kind: "lookup", table: "events", id: a };

    // /groups/:groupId
    case "groups":
      return a ? { kind: "lookup", table: "chat_groups", id: a } : { kind: "none" };

    // /media/:photoId — a single photo belongs to at most one club
    case "media":
      return a ? { kind: "lookup", table: "photos", id: a } : { kind: "none" };

    // /club-link/:linkId — embedded club policy/registration/shop link
    case "club-link":
      return a ? { kind: "lookup", table: "club_links", id: a } : { kind: "none" };

    case "mini-leagues":
      return a ? { kind: "lookup", table: "mini_leagues", id: a } : { kind: "none" };

    // /vault and /vault/folder/:folderId
    case "vault":
      if (a === "folder" && b) return { kind: "lookup", table: "vault_folders", id: b };
      return { kind: "none" };

    case "messages":
      // /messages/club/:clubId
      if (a === "club" && b) return { kind: "direct", clubId: b };
      // /messages/club-admin/:conversationId
      if (a === "club-admin" && b)
        return { kind: "lookup", table: "club_admin_conversations", id: b };
      // DMs, broadcast, welcome and the inbox itself are not club-owned
      // /messages/dm/:conversationId — scoped by the other participant's clubs
      if (a === "dm" && b) return { kind: "dm", conversationId: b };
      if (!a || a === "dm" || a === "broadcast" || a === "welcome") return { kind: "none" };
      // /messages/:teamId — team chat
      if (!b && !c) return { kind: "lookup", table: "teams", id: a };
      return { kind: "none" };

    default:
      return { kind: "none" };
  }
}

/** Tables where a NULL club_id is legitimate (personal / unscoped rows). */
export const NULLABLE_CLUB_TABLES: ReadonlySet<ClubScopeTable> = new Set([
  "chat_groups",
  "events",
  "vault_folders",
  "photos",
]);
