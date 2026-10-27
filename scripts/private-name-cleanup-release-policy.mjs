export const CLEANUP_RELEASE = 'IGNITE_PRIVATE_NAME_CLEANUP_RELEASE';
const forbidden = name => name.includes('REHEARSAL') && (name.startsWith('IGNITE_PRIVATE_') || name === 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL');
export function cleanupEnvironment(environment, service) {
  if (!['identity_access','club_domain','pii_access_control'].includes(service) || !Array.isArray(environment)) throw Error('Exact cleanup target required');
  const names = new Set();
  for (const row of environment) {
    if (typeof row.name !== 'string' || typeof row.value !== 'string' || names.has(row.name)) throw Error('Invalid or duplicate environment setting');
    names.add(row.name);
    if (forbidden(row.name) && row.value !== '0') throw Error('Unrelated rehearsal must remain disabled');
    if (row.name === CLEANUP_RELEASE && !['0','1'].includes(row.value)) throw Error('Unknown cleanup release switch');
  }
  return [...environment.filter(row=>row.name!==CLEANUP_RELEASE),{name:CLEANUP_RELEASE,value:'1'}].sort((a,b)=>a.name.localeCompare(b.name));
}
export function requireCleanupWiring(service, rows, identity) {
  if (service !== 'club_domain') return;
  const matches=rows.filter(row=>row[0]==='identity_access');
  if(matches.length!==1 || matches[0][1]!==identity) throw Error('Cleanup requires existing exact identity wiring; do not rewire legacy clubs');
}
export async function activateCleanupSettings(steps, transport) {
  for(const step of steps) {
    await transport.gate();
    let observed=await transport.observe(step);
    if(observed.rawSettingsHash===step.newSettingsHash) { step.phase='complete'; await transport.persist(); continue; }
    if(observed.rawSettingsHash!==step.oldSettingsHash || step.phase!=='ready') throw Error('Unknown cleanup activation; retain intent and reconcile settings without replay');
    step.phase='pending'; await transport.persist();
    await transport.update(step);
    observed=await transport.observe(step);
    if(observed.rawSettingsHash!==step.newSettingsHash) throw Error('Cleanup settings readback failed; retain intent');
    step.phase='complete'; await transport.persist();
  }
}