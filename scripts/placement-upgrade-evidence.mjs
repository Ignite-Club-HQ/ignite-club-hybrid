/** Optional record accepts both historical Ok(record) and live Ok(opt record).
 * This is a read-only release adapter, not a role authorization decision. */
export function placementOperatorEvidenceIdl(IDL) {
  const role = IDL.Variant({Auditor:IDL.Null,PlacementAdmin:IDL.Null,SecurityAdmin:IDL.Null,InfrastructureAdmin:IDL.Null,MigrationOperator:IDL.Null});
  const record = IDL.Record({user:IDL.Principal,roles:IDL.Vec(role)});
  return IDL.Service({get_operator:IDL.Func([IDL.Principal],[IDL.Variant({Ok:IDL.Opt(record),Err:IDL.Text})],['query'])});
}
export function normalizePlacementOperatorEvidence(reply) {
  if (!reply || 'Err' in reply || !Array.isArray(reply.Ok) || reply.Ok.length > 1) throw Error('Placement operator evidence unavailable');
  const row = reply.Ok[0];
  if (!row) return null;
  if (typeof row.user?.toText !== 'function' || !Array.isArray(row.roles)) throw Error('Invalid placement operator evidence');
  const roles = row.roles.map(role => {
    const names = Object.keys(role);
    if (names.length !== 1 || !['Auditor','PlacementAdmin','SecurityAdmin','InfrastructureAdmin','MigrationOperator'].includes(names[0])) throw Error('Unknown placement operator role');
    return names[0];
  }).sort();
  return {user:row.user.toText(),roles};
}