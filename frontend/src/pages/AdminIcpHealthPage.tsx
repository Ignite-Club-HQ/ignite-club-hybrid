import { Navigate } from "react-router-dom";

/**
 * Deprecated: the live canister fuel/memory view moved to Group
 * Infrastructure (/admin/group-infrastructure), which is now the single
 * canonical place for live utilization — per group and per canister. The
 * memory history, trend and forecast cards moved with it. Keep this redirect
 * so old links and bookmarks keep working.
 */
export default function AdminIcpHealthPage() {
  return <Navigate to="/admin/group-infrastructure" replace />;
}
