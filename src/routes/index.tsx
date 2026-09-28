import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Blocks,
  CheckCircle2,
  Database,
  Flame,
  KeyRound,
  Loader2,
  XCircle,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { configuredCanisters, icpConfig } from "@/lib/icp/config";
import { useInternetIdentity, useReplicaStatus } from "@/hooks/use-icp";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Ignite Club HQ Hybrid" },
      {
        name: "description",
        content:
          "Ignite Club HQ Hybrid — club management on Supabase with Internet Computer canister integration.",
      },
      { property: "og:title", content: "Ignite Club HQ Hybrid" },
      {
        property: "og:description",
        content:
          "Ignite Club HQ Hybrid — club management on Supabase with Internet Computer canister integration.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function StatusPill({ ok, label }: { ok: boolean; label: string }) {
  const Icon = ok ? CheckCircle2 : XCircle;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ${
        ok
          ? "bg-primary/15 text-primary"
          : "bg-muted text-muted-foreground"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}

function Index() {
  const replica = useReplicaStatus();
  const { principal, busy, login, logout } = useInternetIdentity();

  const supabaseStatus = useQuery({
    queryKey: ["supabase-status"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("clubs")
        .select("id", { count: "exact", head: true });
      if (error) throw error;
      return count ?? 0;
    },
    retry: 1,
  });

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="flex items-center gap-4">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15">
            <Flame className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              Ignite Club HQ <span className="text-primary">Hybrid</span>
            </h1>
            <p className="text-sm text-muted-foreground">
              Supabase backend · Internet Computer canisters
            </p>
          </div>
        </header>

        <div className="mt-10 grid gap-4 sm:grid-cols-2">
          {/* Supabase */}
          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Database className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Supabase</h2>
              </div>
              {supabaseStatus.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <StatusPill
                  ok={supabaseStatus.isSuccess}
                  label={supabaseStatus.isSuccess ? "Connected" : "Restricted"}
                />
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {supabaseStatus.isSuccess
                ? `Reachable — ${supabaseStatus.data} club${supabaseStatus.data === 1 ? "" : "s"} visible with current access.`
                : supabaseStatus.isError
                  ? "Database is up, but this read is restricted — sign-in or row-level policies may apply."
                  : "Checking connection…"}
            </p>
          </section>

          {/* ICP */}
          <section className="rounded-xl border bg-card p-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <Blocks className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Internet Computer</h2>
              </div>
              {replica.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              ) : (
                <StatusPill
                  ok={replica.isSuccess}
                  label={replica.isSuccess ? "Replica reachable" : "Unreachable"}
                />
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              Network: <span className="text-foreground">{icpConfig.network}</span>
              {" · "}
              <span className="break-all">{icpConfig.host}</span>
            </p>
            <div className="mt-3">
              {configuredCanisters.length === 0 ? (
                <p className="rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                  No canisters configured yet. Once deployed, add their IDs to
                  the app environment and their generated declarations under the
                  ICP declarations folder — the connection layer is ready.
                </p>
              ) : (
                <ul className="space-y-1.5">
                  {configuredCanisters.map((c) => (
                    <li
                      key={c.id}
                      className="flex items-center justify-between rounded-lg bg-muted px-3 py-2 text-xs"
                    >
                      <span className="font-medium">{c.name}</span>
                      <span className="font-mono text-muted-foreground">{c.id}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          {/* Internet Identity */}
          <section className="rounded-xl border bg-card p-5 sm:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <KeyRound className="h-5 w-5 text-primary" />
                <h2 className="font-semibold">Internet Identity</h2>
              </div>
              {principal ? (
                <div className="flex items-center gap-3">
                  <span className="rounded-lg bg-muted px-3 py-1.5 font-mono text-xs text-muted-foreground">
                    {principal}
                  </span>
                  <button
                    onClick={logout}
                    disabled={busy}
                    className="rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
                  >
                    Log out
                  </button>
                </div>
              ) : (
                <button
                  onClick={login}
                  disabled={busy}
                  className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                >
                  {busy && <Loader2 className="h-4 w-4 animate-spin" />}
                  Log in with Internet Identity
                </button>
              )}
            </div>
            <p className="mt-3 text-sm text-muted-foreground">
              {principal
                ? "Signed in — this identity will be used for authenticated canister calls."
                : "Optional for now — sign in to authenticate future canister update calls."}
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
