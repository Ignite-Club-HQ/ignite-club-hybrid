export const CLEANUP_RELEASE = 'IGNITE_PRIVATE_NAME_CLEANUP_RELEASE';
export function requireCleanupGithubProtection(environment, branch) {
  if(environment?.can_admins_bypass!==false || !environment.protection_rules?.some(r=>r.type==='required_reviewers'&&r.reviewers?.length>0) || !environment.deployment_branch_policy) throw Error('Cleanup deployment requires existing reviewed environment and restricted source branches');
  if(branch?.enforce_admins?.enabled!==true || branch.allow_force_pushes?.enabled!==false || branch.allow_deletions?.enabled!==false || !branch.required_pull_request_reviews) throw Error('Cleanup source branch must be protected against unreviewed changes, force pushes and deletion');
}
// IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL is the live account admission release
// switch (historical name), not a rehearsal; every other rehearsal flag is forbidden.
const forbidden = name => name.includes('REHEARSAL') && name !== 'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL';
export function cleanupEnvironment(environment, service) {
  if (!['identity_access','club_domain','pii_access_control'].includes(service) || !Array.isArray(environment)) throw Error('Exact cleanup target required');
  const names = new Set();
  for (const row of environment) {
    if (typeof row.name !== 'string' || typeof row.value !== 'string' || names.has(row.name)) throw Error('Invalid or duplicate environment setting');
    names.add(row.name);
    if (forbidden(row.name) && row.value !== '0') throw Error(`Unrelated rehearsal must remain disabled: ${row.name}`);
    if (row.name === CLEANUP_RELEASE && !['0','1'].includes(row.value)) throw Error('Unknown cleanup release switch');
  }
  return [...environment.filter(row=>row.name!==CLEANUP_RELEASE),{name:CLEANUP_RELEASE,value:'1'}].sort((a,b)=>a.name.localeCompare(b.name));
}
export function requireCleanupWiring(service, rows, identity, allowLegacyDisplayLink = false) {
  if (service !== 'club_domain') return;
  const matches=rows.filter(row=>row[0]==='identity_access');
  // Owner-approved (2026-10-28): the display release may link the pinned
  // original Group 1 club service once, after its module upgrade.
  if(allowLegacyDisplayLink && matches.length===1 && matches[0][1]==='') return 'link';
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
// Candid decodes setting rows as {value,name}; locally built rows are
// {name,value}. Fingerprints must never depend on that key order.
export const canonicalSettingRows = rows => rows.map(r=>({name:r.name,value:r.value})).sort((a,b)=>a.name<b.name?-1:a.name>b.name?1:0);
/** An interrupted settings-only stage (no module installed) may be superseded by
 * a fresh checked plan, but only when every pending settings write is already
 * fully applied on the live canister. Anything else keeps the old rule. */
export function supersedableSettingsStage(journal, scope, settled) {
  if(!journal || journal.complete===true || journal.binding?.scope!==scope || journal.modulesComplete===true) return false;
  if(!Array.isArray(journal.steps) || journal.steps.some(s=>s.phase!=='ready')) return false;
  if(!Array.isArray(journal.cleanupActivation) || journal.galleryAuthorities || journal.publication) return false;
  return journal.cleanupActivation.every(s=>s.phase==='ready' || (['pending','complete'].includes(s.phase) && settled(s.canisterId)===true));
}
