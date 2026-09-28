import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { checkReplicaStatus, createAgent } from "@/lib/icp/agent";
import { icpConfig } from "@/lib/icp/config";

/** Memoized HttpAgent for the configured ICP network. */
export function useIcpAgent() {
  return useMemo(() => createAgent(), []);
}

/** Replica reachability check — only fetches in the browser. */
export function useReplicaStatus() {
  const agent = useIcpAgent();
  return useQuery({
    queryKey: ["icp-replica-status", icpConfig.host],
    queryFn: () => checkReplicaStatus(agent),
    retry: 1,
  });
}

/**
 * Internet Identity login state.
 * AuthClient is loaded lazily so nothing browser-specific runs during SSR.
 */
export function useInternetIdentity() {
  const [principal, setPrincipal] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@dfinity/auth-client").then(async ({ AuthClient }) => {
      const client = await AuthClient.create();
      if (cancelled) return;
      if (await client.isAuthenticated()) {
        setPrincipal(client.getIdentity().getPrincipal().toText());
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const login = async () => {
    setBusy(true);
    try {
      const { AuthClient } = await import("@dfinity/auth-client");
      const client = await AuthClient.create();
      await client.login({
        identityProvider: icpConfig.identityProviderUrl,
        onSuccess: () =>
          setPrincipal(client.getIdentity().getPrincipal().toText()),
      });
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    try {
      const { AuthClient } = await import("@dfinity/auth-client");
      const client = await AuthClient.create();
      await client.logout();
      setPrincipal(null);
    } finally {
      setBusy(false);
    }
  };

  return { principal, busy, login, logout };
}
