/** Saved configuration is independent of whether Pro allows it to be displayed. */
export function hasSavedClubBranding(row: Record<string, unknown> | null | undefined): boolean {
  if (!row) return false;
  if (row.logo_url) return true;
  return Object.entries(row).some(([key, value]) => {
    if (!/^theme_(dark_)?(primary|secondary|accent)_(h|color)$/.test(key)) return false;
    if (Array.isArray(value)) return typeof value[0] === "string" && value[0].length > 0;
    return value !== null && value !== undefined && value !== "";
  });
}