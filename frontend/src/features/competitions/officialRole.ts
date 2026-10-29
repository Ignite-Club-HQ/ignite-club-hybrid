export type OfficialRole = "referee" | "committee_member";

/** Translate storage vocabulary only; the server still authorizes every join. */
export function normalizeOfficialRole(value: unknown): OfficialRole | null {
  if (value === "referee") return "referee";
  if (value === "committee" || value === "committee_member") return "committee_member";
  return null;
}

export function officialJoinPath(token: string, emailInvite: boolean): string {
  return `/competitions/officials/join?${emailInvite ? "email=1&" : ""}token=${encodeURIComponent(token)}`;
}