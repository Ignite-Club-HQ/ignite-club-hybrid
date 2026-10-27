// Upgrade compatibility is not permission to configure an authority.
export function groupPermissionRequirement(service, clubCanisterId) {
  if (service === 'timer_jobs') return null;
  if (['media_metadata', 'insights_domain'].includes(service)) return ['permission_source', 'local_club_roles'];
  return ['club_domain', clubCanisterId];
}
export function validateGroupPermissionWiring(service, rows, clubCanisterId) {
  const requirement = groupPermissionRequirement(service, clubCanisterId);
  if (!requirement) return;
  const [name, expected] = requirement;
  const matches = rows.filter(row => row[0] === name);
  if (!expected || matches.length !== 1 || matches[0][1] !== expected) throw Error(`Permission wiring differs: ${service}/${name}`);
}
const LEGACY_CLUB = 'mzzzv-taaaa-aaaal-qxlrq-cai';
const IDENTITY = 'mq2sj-fiaaa-aaaal-qxlqa-cai';
const LIFECYCLE_SETTINGS = [
  'IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL',
  'IGNITE_ACCOUNT_SERVICE_IDENTITY',
  'IGNITE_BOUND_DELETION_RELEASE',
  'IGNITE_NEW_CLUB_PLACEMENT_ROUTER',
  'IGNITE_NEW_CLUB_PLACEMENT_GROUP',
  'IGNITE_NEW_CLUB_PLACEMENT_TARGET',
];
export function legacyClubLifecycleDisabled(environment) {
  if (!Array.isArray(environment)) return false;
  // Only missing settings or explicitly disabled switches qualify. Unknown
  // values, duplicate settings, identity or placement bindings fail closed.
  return LIFECYCLE_SETTINGS.every(name => {
    const entries = environment.filter(row => row.name === name);
    if (!entries.length) return true;
    if (entries.length !== 1) return false;
    return ['IGNITE_ACCOUNT_GROUP_LOCAL_REHEARSAL', 'IGNITE_BOUND_DELETION_RELEASE'].includes(name)
      && entries[0].value === '0';
  });
}
export function validateClubIdentityWiring(target, rows, identityCanisterId, lifecycleDisabled) {
  const identities = rows.filter(row => row[0] === 'identity_access');
  if (identityCanisterId !== IDENTITY || identities.length !== 1) throw Error('Exact club identity wiring required');
  if (identities[0][1] === identityCanisterId) return;
  if (target.groupId === 'g1' && target.name === 'club_domain' && target.canisterId === LEGACY_CLUB
      && identities[0][1] === '' && lifecycleDisabled === true) return;
  throw Error('Club identity wiring differs; legacy absence is allowed only on pinned Group 1 with lifecycle and placement settings disabled');
}
export function approvedDisplayLinkRows(target, rows, identityCanisterId) {
  if(target.groupId!=='g1'||target.name!=='club_domain'||target.canisterId!==LEGACY_CLUB||identityCanisterId!==IDENTITY)throw Error('Only the approved original Group 1 display link is allowed');
  const matches=rows.filter(row=>row[0]==='identity_access');
  if(matches.length!==1||matches[0][1]!=='')throw Error('Display link requires one empty original identity');
  return rows.map(row=>row[0]==='identity_access'?[row[0],identityCanisterId]:[...row]);
}