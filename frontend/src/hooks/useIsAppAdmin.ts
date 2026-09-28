import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * Single authoritative source of app-admin permission detection.
 *
 * Every consumer must use this hook so that the shared React Query key
 * `["is-app-admin", userId]` is always populated by the *same* query
 * function with the *same* boolean contract and the same enablement rules.
 *
 * Previously each page re-declared its own `useQuery` on that key with
 * subtly different `enabled` gates (`authReady && !!user`, `!!user &&
 * initialized`, `!!user`) and different staleTime/retry settings. Whichever
 * copy mounted first owned the shared cache entry, so a stricter gate on one
 * page could leave `data === undefined` (permission unresolved) even though
 * the user is a confirmed app admin — which is exactly how the Broadcast
 * composer stayed hidden on a cold direct visit to `/messages/broadcast`.
 *
 * Contract:
 * - `isAppAdmin` is `true` ONLY when the lookup resolved and found the role.
 *   Loading, error and unauthenticated states all resolve to `false`, so a
 *   failed or unresolved query can never grant privileged UI.
 * - Backend RLS remains the final authorization layer; this is UI gating only.
 */
export const isAppAdminQueryKey = (userId: string | null | undefined) =>
  ["is-app-admin", userId] as const;

export async function fetchIsAppAdmin(userId: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("id")
    .eq("user_id", userId)
    .eq("role", "app_admin")
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export interface UseIsAppAdminResult {
  isAppAdmin: boolean;
  isLoading: boolean;
  error: unknown;
}

export function useIsAppAdmin(): UseIsAppAdminResult {
  const { user } = useAuth();
  const userId = user?.id;

  const query = useQuery({
    queryKey: isAppAdminQueryKey(userId),
    queryFn: () => fetchIsAppAdmin(userId!),
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    retry: 2,
  });

  return {
    // Never infer admin from anything but a resolved `true`.
    isAppAdmin: query.data === true,
    isLoading: !!userId && query.isPending,
    error: query.error,
  };
}
