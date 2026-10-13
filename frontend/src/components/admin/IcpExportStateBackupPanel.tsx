import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Download, Loader2, FileArchive } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { getActiveIcpTarget } from "@/live/targetRegistry";
import {
  connectLiveClubPointsDomain,
  connectLiveCompetitionDomain,
  connectLiveEventsDomain,
  connectLiveMediaMetadata,
  connectLiveMessagingDomain,
  DOMAIN_LABELS,
} from "@/live/domains";
import { getCurrentInternetIdentity } from "@/live/internetIdentityAuth";

type ExportableDomain = {
  key: string;
  label: string;
  connect: (target: ReturnType<typeof getActiveIcpTarget>, identity: Awaited<ReturnType<typeof getCurrentInternetIdentity>>) => Promise<{ actor: { export_state: () => Promise<unknown> } }>;
};

const EXPORTABLE_DOMAINS: ExportableDomain[] = [
  { key: "club_points_domain", label: DOMAIN_LABELS.club_points_domain, connect: connectLiveClubPointsDomain as ExportableDomain["connect"] },
  { key: "competition_domain", label: DOMAIN_LABELS.competition_domain, connect: connectLiveCompetitionDomain as ExportableDomain["connect"] },
  { key: "events_domain", label: DOMAIN_LABELS.events_domain, connect: connectLiveEventsDomain as ExportableDomain["connect"] },
  { key: "media_metadata", label: DOMAIN_LABELS.media_metadata, connect: connectLiveMediaMetadata as ExportableDomain["connect"] },
  { key: "messaging_domain", label: DOMAIN_LABELS.messaging_domain, connect: connectLiveMessagingDomain as ExportableDomain["connect"] },
];

/** JSON.stringify replacer that renders bigint (Candid `nat`/`int`) values as strings instead of throwing. */
function bigIntSafeReplacer(_key: string, value: unknown): unknown {
  return typeof value === "bigint" ? value.toString() : value;
}

/**
 * ICP-lab equivalent of the Supabase backup page: there is no Supabase
 * Storage archive to download/restore, but every domain canister exposes a
 * read-only `export_state` query. This panel downloads each domain's raw
 * exported state as a timestamped JSON file for manual inspection / backup.
 */
export function IcpExportStateBackupPanel() {
  const navigate = useNavigate();
  const [downloadingKey, setDownloadingKey] = useState<string | null>(null);

  const handleExport = async (domain: ExportableDomain) => {
    setDownloadingKey(domain.key);
    try {
      const target = getActiveIcpTarget();
      const identity = await getCurrentInternetIdentity();
      if (!identity) throw new Error("Sign in with Internet Identity to export canister state.");

      const { actor } = await domain.connect(target, identity);
      const result = await actor.export_state();

      const json = JSON.stringify(result, bigIntSafeReplacer, 2);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = url;
      a.download = `${domain.key}-export-${stamp}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success(`${domain.label} export downloaded`);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Export failed";
      toast.error(`${domain.label} export failed: ${message}`);
    } finally {
      setDownloadingKey(null);
    }
  };

  return (
    <div className="container max-w-4xl mx-auto py-8 px-4 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Canister State Exports</h1>
          <p className="text-muted-foreground">Download each domain's exported state (ICP lab mode)</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileArchive className="h-5 w-5" />
            Domain exports
          </CardTitle>
          <CardDescription>
            Each button calls that canister's read-only <code>export_state</code> query and downloads the result as
            JSON. Backup creation, scheduled retention, and restore have no ICP equivalent yet.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {EXPORTABLE_DOMAINS.map((domain) => (
            <div
              key={domain.key}
              className="flex items-center justify-between gap-3 rounded-lg border p-4"
            >
              <div className="min-w-0">
                <p className="font-medium truncate">{domain.label}</p>
                <p className="text-xs text-muted-foreground font-mono truncate">{domain.key}</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => handleExport(domain)}
                disabled={downloadingKey === domain.key}
              >
                {downloadingKey === domain.key ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Download export
                  </>
                )}
              </Button>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
