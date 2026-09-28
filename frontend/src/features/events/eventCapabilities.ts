/**
 * Frontend event-action capabilities. These control presentation and query
 * enablement only; Supabase RLS/RPC authorization remains authoritative.
 */
export type EventCapabilityInput = {
  isEventManager?: boolean | null;
  isAppAdmin?: boolean | null;
  isSubsManagerForEvent?: boolean | null;
};

export type EventCapabilities = {
  canManageEvent: boolean;
  canOperateMatch: boolean;
};

export function resolveEventCapabilities({
  isEventManager,
  isAppAdmin,
  isSubsManagerForEvent,
}: EventCapabilityInput): EventCapabilities {
  const canManageEvent = Boolean(isEventManager || isAppAdmin);
  return {
    canManageEvent,
    canOperateMatch: Boolean(canManageEvent || isSubsManagerForEvent),
  };
}
