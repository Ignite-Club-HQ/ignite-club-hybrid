export function getChatBottomPaddingOffset(bottomPadding: number | string | undefined): number {
  if (typeof bottomPadding === "number") return Math.max(0, bottomPadding);
  if (typeof bottomPadding !== "string") return 0;

  const pxMatch = bottomPadding.match(/(-?\d+(?:\.\d+)?)px/);
  if (pxMatch) return Math.max(0, Number.parseFloat(pxMatch[1]));

  const numeric = Number.parseFloat(bottomPadding);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}