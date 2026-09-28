export interface MiniLeagueJoinLinkCardCopy {
  heading: string;
  description: (miniLeagueName: string) => string;
  emptyHelp: string;
  generateLabel: string;
  qrDescription: string;
  regenerateTitle: string;
}

export interface MiniLeagueJoinLinkRoleConfig {
  role: "league_admin" | "parent";
  metadataKind: "league_admin_join_link" | "mini_league_parent_join_link";
  invitedLabel: (miniLeagueName: string) => string;
}

export const MINI_LEAGUE_ADMIN_JOIN_LINK_ROLE: MiniLeagueJoinLinkRoleConfig = {
  role: "league_admin",
  metadataKind: "league_admin_join_link",
  invitedLabel: (miniLeagueName) => `${miniLeagueName} – League Admin link`,
};

export const MINI_LEAGUE_PARENT_JOIN_LINK_ROLE: MiniLeagueJoinLinkRoleConfig = {
  role: "parent",
  metadataKind: "mini_league_parent_join_link",
  invitedLabel: (miniLeagueName) => `${miniLeagueName} – Parent join link`,
};

export const MINI_LEAGUE_ADMIN_JOIN_LINK_COPY: MiniLeagueJoinLinkCardCopy = {
  heading: "Share a League Admin link",
  description: (miniLeagueName) =>
    `One link anyone can tap to become a League Admin for ${miniLeagueName}. Reuse it for as many people as you like.`,
  emptyHelp:
    "Creates a permanent link — you only need to do this once. Reopen this sheet anytime to grab it again.",
  generateLabel: "Generate League Admin link",
  qrDescription: "Point a camera at the code to become a League Admin",
  regenerateTitle: "Regenerate League Admin link?",
};

export const MINI_LEAGUE_PARENT_JOIN_LINK_COPY: MiniLeagueJoinLinkCardCopy = {
  heading: "Share a parent join link",
  description: (miniLeagueName) =>
    `One link any parent can tap to join ${miniLeagueName} and add their child. Reuse it for as many families as you like.`,
  emptyHelp: "Creates a permanent link — you only need to do this once.",
  generateLabel: "Generate parent join link",
  qrDescription: "Point a camera at the code to join as a parent",
  regenerateTitle: "Regenerate parent join link?",
};

export function generateShortToken(): string {
  const arr = new Uint8Array(12);
  crypto.getRandomValues(arr);
  return btoa(String.fromCharCode(...arr))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

export function buildMiniLeagueJoinLinkUrl(inviteToken: string): string {
  return `https://reference.invalid/join/p/${inviteToken}`;
}

export function buildMiniLeagueJoinLinkQrFilename(prefix: string, miniLeagueName: string): string {
  return `${prefix}-${miniLeagueName.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`;
}

export function requireAuthenticatedUserId(userId: string | null | undefined): string {
  if (!userId) throw new Error("Not signed in");
  return userId;
}
