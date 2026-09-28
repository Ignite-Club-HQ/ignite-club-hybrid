import { useEffect } from "react";
import { clearReconciliationScope } from "@/lib/chatMessageReconciliation";

/**
 * Keep reconciliation patches/tombstones for the lifetime of one chat scope.
 * Ordinary query-cache updates must not clear them; only a scope change or
 * component unmount may release the registry entry.
 */
export function useChatReconciliationScopeLifecycle(scopeKey: string): void {
  useEffect(() => () => clearReconciliationScope(scopeKey), [scopeKey]);
}
