import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { format } from "date-fns";
import { ArrowLeft, Download, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { withFeatureBackend } from "@/live/featureRouter";
import { BACKUP_DOMAINS } from "@/live/adminBackupExport";

type Summary = { id: string; label: string; createdAt: number; files: number; folders: number };

const jsonSafe = (_k: string, v: unknown) =>
  typeof v === "bigint" ? v.toString() : v && typeof v === "object" && "toText" in (v as object) ? (v as { toText: () => string }).toText() : v;

export default function IcpManageBackupsPage() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { isAppAdmin, isLoading: adminLoading } = useIsAppAdmin();
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const { data: backups = [], isLoading, error } = useQuery({
    queryKey: ["icp-vault-backups"],
    enabled: isAppAdmin,
    queryFn: () =>
      withFeatureBackend("vault", {
        supabase: async (): Promise<Summary[]> => { throw new Error("Internet Identity connection required"); },
        icp: async (ctx) => {
          const { listLiveVaultBackups } = await import("@/live/features/vault");
          const rows = await listLiveVaultBackups(ctx);
          return rows
            .map((r) => ({
              id: r.id,
              label: r.backup_label,
              createdAt: Number(r.created_at_ms),
              files: Number(r.file_count),
              folders: Number(r.folder_count),
            }))
            .sort((a, b) => b.createdAt - a.createdAt);
        },
      }, { shared: "app" }),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ["icp-vault-backups"] });

  const create = useMutation({
    mutationFn: () =>
      withFeatureBackend("vault", {
        supabase: async () => { throw new Error("Internet Identity connection required"); },
        icp: async (ctx) => {
          const { createLiveVaultBackup } = await import("@/live/features/vault");
          await createLiveVaultBackup(ctx, label.trim() || `Backup ${format(new Date(), "d MMM yyyy HH:mm")}`);
        },
      }, { shared: "app" }),
    onSuccess: () => { setLabel(""); toast.success("Backup created"); refresh(); },
    onError: (e: Error) => toast.error(e.message || "Backup failed"),
  });

  const run = async (id: string, kind: "download" | "restore" | "delete") => {
    if (kind === "restore" && !confirm("Restore missing vault folders and files from this backup? Existing items are not overwritten.")) return;
    if (kind === "delete" && !confirm("Delete this backup permanently?")) return;
    setBusy(id + kind);
    try {
      await withFeatureBackend("vault", {
        supabase: async () => { throw new Error("Internet Identity connection required"); },
        icp: async (ctx) => {
          const v = await import("@/live/features/vault");
          if (kind === "download") {
            const b = await v.getLiveVaultBackup(ctx, id);
            const blob = new Blob([JSON.stringify(b, jsonSafe, 2)], { type: "application/json" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = `vault-backup-${id}.json`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(url), 5000);
          } else if (kind === "restore") {
            const report = await v.restoreLiveVaultBackupWithMedia(ctx, id);
            if (report.missingBytes.length > 0) {
              toast.warning(
                `Restored ${report.restoredRows} records, but ${report.missingBytes.length} media file${report.missingBytes.length === 1 ? "" : "s"} no longer have their encrypted bytes stored and cannot be recovered.`,
              );
            } else {
              toast.success(`Backup restored: ${report.restoredRows} records, ${report.grantsRepaired} media access grants repaired`);
            }
          } else {
            await v.deleteLiveVaultBackup(ctx, id);
            toast.success("Backup deleted");
            refresh();
          }
        },
      }, { shared: "app" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(null);
    }
  };

  if (adminLoading) return <div className="p-4"><Skeleton className="h-32 w-full" /></div>;
  if (!isAppAdmin) return <div className="p-6 text-center text-muted-foreground">Only app admins can manage backups.</div>;

  return (
    <div className="container max-w-3xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back"><ArrowLeft className="h-5 w-5" /></Button>
        <h1 className="text-xl font-semibold">Backups</h1>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Create backup</CardTitle>
          <CardDescription>Saves a snapshot of every vault folder and file record. Files stay encrypted.</CardDescription>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Input placeholder="Label (optional)" value={label} onChange={(e) => setLabel(e.target.value)} />
          <Button onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            <span className="ml-1">Create</span>
          </Button>
        </CardContent>
      </Card>
      {isLoading ? (
        <Skeleton className="h-24 w-full" />
      ) : error ? (
        <p role="alert" className="text-destructive">Could not load backups: {error.message}</p>
      ) : backups.length === 0 ? (
        <p className="text-center text-muted-foreground py-8">No backups yet.</p>
      ) : (
        backups.map((b) => (
          <Card key={b.id}>
            <CardContent className="p-4 flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="font-medium">{b.label}</p>
                <p className="text-sm text-muted-foreground">
                  {format(new Date(b.createdAt), "d MMM yyyy HH:mm")} · {b.folders} folders · {b.files} files
                </p>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" disabled={!!busy} aria-label={`Download ${b.label}`} title="Download backup" onClick={() => run(b.id, "download")}><Download className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={!!busy} aria-label={`Restore ${b.label}`} title="Restore missing records" onClick={() => run(b.id, "restore")}><RotateCcw className="h-4 w-4" /></Button>
                <Button size="sm" variant="outline" disabled={!!busy} aria-label={`Delete ${b.label}`} title="Delete backup" onClick={() => run(b.id, "delete")}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
      <section className="space-y-3 border-t pt-4">
        <h2 className="text-lg font-semibold">Domain exports</h2>
        <p className="text-sm text-muted-foreground">Privileged exports. Vault snapshots remain separately restorable. Media bytes and full club configuration are not included.</p>
        {BACKUP_DOMAINS.map(domain => <div key={domain} className="flex items-center justify-between gap-3 border-b py-2">
          <span className="text-sm">{domain.replaceAll("_", " ")}</span>
          <Button variant="outline" size="icon" aria-label={`Export ${domain}`} disabled={!!busy} onClick={async () => {
            setBusy(domain);
            try {
              const payload = await withFeatureBackend("vault", {
                supabase: async () => { throw new Error("Internet Identity connection required"); },
                icp: async ctx => (await import("@/live/adminBackupExport")).exportAdminDomain(ctx, domain),
              }, { shared: "app" });
              const url = URL.createObjectURL(new Blob([JSON.stringify(payload, jsonSafe, 2)], { type: "application/json" }));
              const a = document.createElement("a"); a.href = url; a.download = `${domain}-${new Date().toISOString().slice(0, 10)}.json`; a.click();
              setTimeout(() => URL.revokeObjectURL(url), 5000); toast.success("Export downloaded");
            } catch (e) { toast.error(e instanceof Error ? e.message : "Export failed"); }
            finally { setBusy(null); }
          }}><Download className="h-4 w-4" /></Button>
        </div>)}
      </section>
    </div>
  );
}
