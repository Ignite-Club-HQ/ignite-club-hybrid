// Owner-pinned boundary: no prod branch or production database operations.
export const MAIN_DEV_URL = 'https://ecsdwrarzfexssxtrymj.supabase.co';
export function assertMainDevOnly(env) {
  if (env.LOVABLE_ENV === 'prod' || env.CONTEXT === 'production') throw new Error('Production release contexts are forbidden for this integration.');
  for (const key of ['GITHUB_REF_NAME', 'GITHUB_HEAD_REF', 'GITHUB_BASE_REF', 'BRANCH', 'CM_BRANCH']) {
    if (env[key] === 'prod') throw new Error('The prod branch is off-limits.');
  }
  if (env.GITHUB_REF === 'refs/heads/prod') throw new Error('The prod branch is off-limits.');
  for (const key of ['VITE_SUPABASE_URL', 'SUPABASE_URL', 'IGNITE_LIVE_SUPABASE_URL', 'IGNITE_EXPECTED_SUPABASE_URL']) {
    if (env[key] && new URL(env[key]).origin !== MAIN_DEV_URL) throw new Error('Only the owner-approved DEV database is permitted.');
  }
  for (const key of ['VITE_SUPABASE_PROJECT_ID', 'SUPABASE_PROJECT_ID']) {
    if (env[key] && env[key] !== 'ecsdwrarzfexssxtrymj') throw new Error('Only the owner-approved DEV project is permitted.');
  }
}
export function assertMainMergeTarget(branch) {
  if (branch !== 'main') throw new Error('Integration may merge only into main.');
}