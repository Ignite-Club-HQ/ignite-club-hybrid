/** Prefer the grade segment, not an earlier organization UUID in the URL. */
export function playhqGradeId(raw: string): string | null {
  const value = raw.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || !(url.hostname === "playhq.com" || url.hostname.endsWith(".playhq.com"))) return null;
    const parts = url.pathname.split("/").filter(Boolean);
    const grade = parts.lastIndexOf("grade");
    const selected = grade >= 0 ? parts[grade + 1] : parts.at(-1);
    return selected && /^[a-zA-Z0-9_-]{1,128}$/.test(selected) ? selected : null;
  } catch {
    return /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
  }
}