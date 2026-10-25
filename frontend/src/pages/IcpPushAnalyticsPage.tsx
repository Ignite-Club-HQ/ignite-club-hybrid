import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, RefreshCw, Trash2, Save } from "lucide-react";
import { toast } from "sonner";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { getLivePushDeliveryHealth, getLivePushAlertSettings, upsertLivePushAlertSettings, cleanupLiveStaleDeviceTokens, type LivePushAlertSettingsInput } from "@/live/features/notifications";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";

const unavailable = async (): Promise<never> => { throw new Error("Internet Identity connection required"); };

export default function IcpPushAnalyticsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAppAdmin, isLoading } = useIsAppAdmin();
  const [draft, setDraft] = useState<LivePushAlertSettingsInput | null>(null);
  const [ageDays, setAgeDays] = useState(60);
  const health = useQuery({
    queryKey: ["icp-admin-push-health"], enabled: isAppAdmin, refetchInterval: 60000,
    queryFn: () => withFeatureBackend("notifications", {
      supabase: unavailable,
      icp: async ctx => ({ queue: ctx.target.canisterIds.notification_queue, ...await getLivePushDeliveryHealth(ctx, Date.now()) }),
    }, { everyGroup: true, requireComplete: true, merge: (parts: unknown[]) => {
      const rows = parts as Array<Awaited<ReturnType<typeof getLivePushDeliveryHealth>> & { queue: string }>;
      return [...new Map(rows.map(row => [row.queue, row])).values()];
    } }),
  });
  const settings = useQuery({ queryKey: ["icp-admin-push-settings"], enabled: isAppAdmin,
    queryFn: () => withFeatureBackend("notifications", { supabase: unavailable, icp: getLivePushAlertSettings }, { shared: "app" }),
  });
  const save = useMutation({ mutationFn: async (value: LivePushAlertSettingsInput) => {
    await withFeatureBackend("notifications", { supabase: unavailable, icp: ctx => upsertLivePushAlertSettings(ctx, value) }, writeOnce({ shared: "app" }));
  }, onSuccess: () => { setDraft(null); qc.invalidateQueries({ queryKey: ["icp-admin-push-settings"] }); toast.success("Alert settings saved"); }, onError: (e: Error) => toast.error(e.message) });
  const cleanup = useMutation({ mutationFn: async () => {
    if (!Number.isInteger(ageDays) || ageDays < 1 || ageDays > 3650) throw new Error("Choose a valid token age");
    if (!confirm(`Remove device registrations unused for ${ageDays} days from all listed queues?`)) return null;
    // The read above returns exact approved contexts; writes are explicit and
    // execute once per queue, never mutation fanout through readAcross.
    const contexts = await withFeatureBackend("notifications", { supabase: unavailable, icp: async ctx => ctx }, {
      everyGroup: true, requireComplete: true, merge: parts => [...new Map((parts as Parameters<typeof getLivePushDeliveryHealth>[0][]).map(ctx => [ctx.target.canisterIds.notification_queue, ctx])).values()],
    });
    let count = 0;
    for (const ctx of contexts) count += await cleanupLiveStaleDeviceTokens(ctx, Date.now(), ageDays * 86400000);
    return count;
  }, onSuccess: count => { if (count !== null) { toast.success(`Removed ${count} stale device registrations`); qc.invalidateQueries({ queryKey: ["icp-admin-push-health"] }); } }, onError: (e: Error) => toast.error(e.message) });
  if (isLoading) return <Skeleton className="h-32 m-4" />;
  if (!isAppAdmin) return <p className="p-6 text-muted-foreground">App admins only.</p>;
  const value = draft ?? settings.data;
  const totals = health.data?.reduce((total, row) => ({
    total24h: total.total24h + row.total24h, pending24h: total.pending24h + row.pending24h,
    processing24h: total.processing24h + row.processing24h, delivered24h: total.delivered24h + row.delivered24h,
    failed24h: total.failed24h + row.failed24h, deviceTokenCount: total.deviceTokenCount + row.deviceTokenCount,
  }), { total24h: 0, pending24h: 0, processing24h: 0, delivered24h: 0, failed24h: 0, deviceTokenCount: 0 });
  const fields = [["failureThresholdPercent", "Failure threshold (%)"], ["checkWindowHours", "Check window (hours)"], ["minNotifications", "Minimum notifications"], ["cooldownHours", "Cooldown (hours)"]] as const;
  return <div className="max-w-4xl mx-auto p-4 space-y-6">
    <header className="flex items-center gap-3"><Button size="icon" variant="ghost" aria-label="Back" onClick={() => navigate(-1)}><ArrowLeft /></Button><h1 className="text-xl font-semibold">Push Analytics</h1><Button className="ml-auto" size="icon" variant="outline" aria-label="Refresh" onClick={() => health.refetch()}><RefreshCw /></Button></header>
    {health.error && <p role="alert" className="text-destructive">{health.error.message}</p>}
    <h2 className="font-semibold">Last 24 hours</h2>
    {totals ? <dl className="grid grid-cols-2 sm:grid-cols-3 gap-4">{[["Notifications", totals.total24h], ["Queued", totals.pending24h], ["Processing", totals.processing24h], ["Delivery completed", totals.delivered24h], ["Failed", totals.failed24h], ["Device registrations", totals.deviceTokenCount]].map(([label, count]) => <div key={label} className="border-b pb-3"><dt className="text-sm text-muted-foreground">{label}</dt><dd className="text-2xl font-semibold">{count}</dd></div>)}</dl> : health.isPending && <Skeleton className="h-32" />}
    <section className="border-t pt-4 space-y-4"><h2 className="font-semibold">Alert settings</h2>{settings.error && <p role="alert" className="text-destructive">{settings.error.message}</p>}{value && <><div className="flex items-center gap-3"><Switch id="push-admin-alerts" checked={value.alertsEnabled} onCheckedChange={checked => setDraft({ ...value, alertsEnabled: checked })} /><Label htmlFor="push-admin-alerts">Alerts enabled</Label></div><div className="grid sm:grid-cols-2 gap-4">{fields.map(([key, label]) => <div key={key}><Label htmlFor={key}>{label}</Label><Input id={key} type="number" min={0} value={value[key]} onChange={e => setDraft({ ...value, [key]: Number(e.target.value) })} /></div>)}</div><Button disabled={save.isPending || !draft} onClick={() => draft && save.mutate(draft)}><Save className="mr-2 h-4 w-4" />Save</Button></>}</section>
    <section className="border-t pt-4 space-y-3"><h2 className="font-semibold">Stale device registrations</h2><Label htmlFor="token-age">Unused for (days)</Label><div className="flex gap-2"><Input id="token-age" type="number" min={1} max={3650} value={ageDays} onChange={e => setAgeDays(Number(e.target.value))} /><Button variant="outline" disabled={cleanup.isPending || !health.data} onClick={() => cleanup.mutate()}><Trash2 className="mr-2 h-4 w-4" />Remove stale</Button></div></section>
  </div>;
}