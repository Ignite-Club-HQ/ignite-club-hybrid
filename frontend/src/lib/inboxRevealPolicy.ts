/** Display readiness only: cached rows never authorize destination reads. */
export function shouldBlockInboxReveal({
  online, icp, hasRows, loading, orderReady,
}: { online: boolean; icp: boolean; hasRows: boolean; loading: boolean; orderReady: boolean }) {
  if (!online || (icp && hasRows)) return false;
  return loading || !orderReady;
}