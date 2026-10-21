import { Principal } from '@icp-sdk/core/principal';

/** Expected delivery identity comes from the existing CI worker, never a queue's first grant. */
export function resolveOpeningWorker(approved, configured) {
  const validate = value => {
    if (typeof value !== 'string' || !value) return undefined;
    let principal;
    try { principal = Principal.fromText(value); } catch { throw new Error('Invalid opening notification worker principal'); }
    if (principal.isAnonymous() || value === 'aaaaa-aa') throw new Error('Invalid opening notification worker principal');
    return principal.toText();
  };
  const approval = validate(approved), worker = validate(configured);
  if (approval && worker && approval !== worker) throw new Error('Opening approval worker differs from the existing delivery identity; stop and review');
  if (!worker && !approval) throw new Error('Opening notification worker missing: supply the existing ICP_PUSH_WORKER_SEED or PUSH_WORKER_PRINCIPAL in GitHub');
  return worker ?? approval;
}