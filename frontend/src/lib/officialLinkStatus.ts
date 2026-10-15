export type OfficialLinkStatus = "valid" | "invalid" | "expired" | "used_up";

/** Plain-language message for a referee/committee link that can't be used. */
export function officialLinkProblem(status: string): string {
  switch (status) {
    case "expired": return "This link has expired.";
    case "used_up": return "This link has already been used the maximum number of times.";
    default: return "This link doesn't exist or has been turned off.";
  }
}
