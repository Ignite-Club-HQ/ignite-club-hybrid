import { supabase } from "@/integrations/supabase/client";
import type { BackendProvider, BackendRoutingConfig } from "@/live/backendRouting";

/**
 * Club-website backend sync: when a club's effective backend changes in
 * Placement Settings, the website's backend is told where that club's data
 * now lives (Supabase vs an ICP canister) so its resolver can route reads.
 * The actual call goes through the same-origin /api/register-club-backend
 * endpoint, which holds the shared secret server-side.
 */

export type ClubBackendChange = { clubId: string; backend: BackendProvider };

function effectiveBackend(config: BackendRoutingConfig, clubId: string): BackendProvider {
  return config.clubBackendOverrides[clubId] ?? config.defaultBackend;
}

/**
 * Clubs whose effective backend differs between two routing configs. Only
 * clubs that are pinned in at least one config are considered — an unpinned
 * club follows the default and has no per-club registration to update.
 */
export function diffClubBackendChanges(
  previous: BackendRoutingConfig,
  next: BackendRoutingConfig,
): ClubBackendChange[] {
  const clubIds = new Set([
    ...Object.keys(previous.clubBackendOverrides),
    ...Object.keys(next.clubBackendOverrides),
  ]);
  const changes: ClubBackendChange[] = [];
  for (const clubId of clubIds) {
    const before = effectiveBackend(previous, clubId);
    const after = effectiveBackend(next, clubId);
    if (before !== after) changes.push({ clubId, backend: after });
  }
  return changes;
}

async function postRegistration(change: ClubBackendChange, canisterId: string | null): Promise<void> {
  const { data: sessionData } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (!token) throw new Error("Sign-in required to sync the website");
  const body: Record<string, string> = {
    club_id: change.clubId,
    backend: change.backend === "icp" ? "canister" : "supabase",
    data_scope: "all",
  };
  if (change.backend === "icp") {
    if (!canisterId) throw new Error("club_domain canister ID is not configured");
    body.canister_id = canisterId;
  }
  const res = await fetch("/api/register-club-backend", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const data = (await res.json()) as { error?: string };
      if (data.error) detail = data.error;
    } catch {
      // keep the status code as the detail
    }
    throw new Error(detail);
  }
}

/**
 * Best-effort fan-out of registration calls; returns per-club failures so the
 * caller can surface them without blocking the routing save itself.
 */
export async function syncClubBackendChanges(
  changes: ClubBackendChange[],
  canisterId: string | null,
): Promise<{ clubId: string; error: string }[]> {
  const failures: { clubId: string; error: string }[] = [];
  for (const change of changes) {
    try {
      await postRegistration(change, canisterId);
    } catch (error) {
      failures.push({ clubId: change.clubId, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return failures;
}
