import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend, type FeatureBackendContext } from "@/live/featureRouter";

/** One canister's reading inside a report. */
export type MemoryReading = { name: string; memory_mb: number | null; cycles_t?: number | null; note?: string };
export type MemoryAnalysis = {
  summary: string;
  canisters: { name: string; status: "ok" | "watch" | "attention"; explanation: string }[];
};
export type MemoryReport = { at: string; source: string; readings: MemoryReading[]; analysis: MemoryAnalysis | null };

type IcpReportRow = { at: bigint; source: string; readings_json: string; analysis_json: string };
type ReportsActor = {
  list_memory_reports: (limit: bigint) => Promise<IcpReportRow[]>;
  add_memory_report: (s: string, r: string, a: string) => Promise<{ Ok: null } | { Err: string }>;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const reportsIdl = ({ IDL }: any) =>
  IDL.Service({
    list_memory_reports: IDL.Func(
      [IDL.Nat],
      [IDL.Vec(IDL.Record({ at: IDL.Int, source: IDL.Text, readings_json: IDL.Text, analysis_json: IDL.Text }))],
      ["query"],
    ),
    add_memory_report: IDL.Func([IDL.Text, IDL.Text, IDL.Text], [IDL.Variant({ Ok: IDL.Null, Err: IDL.Text })], []),
  });

async function reportsActor(ctx: FeatureBackendContext) {
  const { createLiveActor } = await import("@/live/icpAgent");
  const { actor } = await createLiveActor<ReportsActor>(ctx.target, ctx.identity, "insights_domain", "Insights", reportsIdl);
  return actor;
}

function safeJson<T>(s: string, fallback: T): T {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
}

/** Latest reports, newest first. App admins only (enforced by the backend). */
export async function listMemoryReports(limit = 20): Promise<MemoryReport[]> {
  return withFeatureBackend("admin", {
    supabase: async () => {
      const { data, error } = await (supabase as any)
        .from("canister_memory_reports")
        .select("created_at, source, readings, analysis")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []).map((r: any) => ({ at: r.created_at, source: r.source, readings: r.readings ?? [], analysis: r.analysis }));
    },
    icp: async (ctx) => {
      const rows = await (await reportsActor(ctx)).list_memory_reports(BigInt(limit));
      return rows
        .map((r) => ({
          at: new Date(Number(r.at / 1_000_000n)).toISOString(),
          source: r.source,
          readings: safeJson<MemoryReading[]>(r.readings_json, []),
          analysis: safeJson<MemoryAnalysis | null>(r.analysis_json, null),
        }))
        .reverse();
    },
  });
}

/** Hand-entered reading, picked up by the next AI analysis run. */
export async function addManualMemoryReading(readings: MemoryReading[], source = "manual"): Promise<void> {
  return withFeatureBackend("admin", {
    supabase: async () => {
      const { data: auth } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from("canister_memory_reports")
        .insert({ source, readings, created_by: auth.user?.id });
      if (error) throw error;
    },
    icp: async (ctx) => {
      const res = await (await reportsActor(ctx)).add_memory_report(source, JSON.stringify(readings), "");
      if ("Err" in res) throw new Error(res.Err);
    },
  });
}
