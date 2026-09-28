/**
 * Selects the local ICP adapter for this isolated build.
 *
 * The second argument is an explicit deployment boundary: the lab passes
 * `true` while a promoted application must pass its deployment configuration
 * instead of inheriting local mode or fixture behavior.
 */
export function resolveLocalAuthMode(search: string, localLabMode = true): boolean {
  if (!localLabMode) return false;
  const params = new URLSearchParams(search);
  const explicit = params.get('backend');
  if (explicit === 'supabase') return false;
  return true;
}
