/** All failed sources remain visible; optional labels must not claim events failed. */
export function scheduleRefreshIssue(failed: readonly string[], queryError?: unknown): string | undefined {
  const issues: string[] = [];
  if (queryError) {
    const text = queryError instanceof Error ? queryError.message : String(queryError);
    issues.push(/deadline|timed?\s*out|timeout/i.test(text)
      ? "The club took too long to return events."
      : /denied|unauthori[sz]ed|forbidden|admission|membership/i.test(text)
        ? "Your club access could not be confirmed."
        : "The latest events could not be retrieved.");
  }
  if (failed.some(id => id.startsWith('club:'))) issues.push("Some clubs’ events could not be refreshed.");
  if (failed.some(id => id.startsWith('team:'))) issues.push("Some team names could not be retrieved.");
  if (failed.some(id => id.startsWith('profile:'))) issues.push("Some club names could not be retrieved.");
  if (failed.some(id => id.startsWith('duties:'))) issues.push("Some duty-team assignments could not be refreshed.");
  return issues.length ? issues.join(' ') + " Available events remain visible. Tap to retry." : undefined;
}