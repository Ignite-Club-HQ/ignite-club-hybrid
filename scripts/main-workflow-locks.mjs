// Copy-only review preparation. Keep the source and prod branch behavior intact.
export const DESTINATION = 'Ignite-Club-HQ/ignite-club_hq-prod';
export const MAIN_DB_ALLOWED = new Set(['deploy-dev-function.yml', 'deploy-frontend-canister.yml']);
export function isMainPermanentlyBlocked(path, content) {
  const name = path.split('/').at(-1);
  return /(?:PROD_|yabcfiuntwqjwvschnji|branches:\s*\[prod\])/.test(content) ||
    (/SUPABASE_|DEV_REF/.test(content) && !MAIN_DB_ALLOWED.has(name) && name !== 'ci.yml');
}
export function workflowSwitch(path) {
  return 'IGNITE_MAIN_' + path.split('/').at(-1).replace(/\.yml$/, '').replace(/[^a-z0-9]/gi, '_').toUpperCase() + '_ENABLED';
}
export function jobGate(path, content) {
  const preserved = `github.repository != '${DESTINATION}' || github.ref == 'refs/heads/prod' || github.base_ref == 'prod'`;
  if (isMainPermanentlyBlocked(path, content)) return preserved;
  return `${preserved} || (github.ref == 'refs/heads/main' && github.event_name == 'workflow_dispatch' && vars.IGNITE_MAIN_WORKFLOWS_ENABLED == 'true' && vars.${workflowSwitch(path)} == 'true')`;
}
export function allowsJob({ repository = DESTINATION, ref, base = '', event, enabled = false, individual = false, blocked = false }) {
  if (repository !== DESTINATION || ref === 'refs/heads/prod' || base === 'prod') return true;
  return !blocked && ref === 'refs/heads/main' && event === 'workflow_dispatch' && enabled && individual;
}