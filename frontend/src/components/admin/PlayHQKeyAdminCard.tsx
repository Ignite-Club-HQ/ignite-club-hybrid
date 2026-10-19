import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { withFeatureBackend } from "@/live/featureRouter";
import { getLivePlayHQConfigStatus, setLivePlayHQConfig } from "@/live/features/events";

const DEFAULT_BASE_URL = "https://api.playhq.com";

/** ICP only: store the PlayHQ API key on the events service (main admin only). */
export function PlayHQKeyAdminCard() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [baseUrl, setBaseUrl] = useState(DEFAULT_BASE_URL);
  const [apiKey, setApiKey] = useState("");

  const { data: status, error } = useQuery({
    queryKey: ["icp-playhq-config-status"],
    queryFn: () =>
      withFeatureBackend("events", {
        supabase: async () => null,
        icp: (ctx) => getLivePlayHQConfigStatus(ctx),
      }, { shared: "app" }),
    retry: false,
  });

  const save = useMutation({
    mutationFn: (clear: boolean) =>
      withFeatureBackend("events", {
        supabase: async () => undefined,
        icp: (ctx) =>
          setLivePlayHQConfig(ctx, clear ? null : { baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      }, { shared: "app" }),
    onSuccess: (_d, clear) => {
      setApiKey("");
      qc.invalidateQueries({ queryKey: ["icp-playhq-config-status"] });
      toast({ title: clear ? "PlayHQ key removed" : "PlayHQ key saved" });
    },
    onError: (e: Error) => toast({ title: "Couldn't save PlayHQ key", description: e.message, variant: "destructive" }),
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Trophy className="h-5 w-5 text-primary" />
          PlayHQ connection
        </CardTitle>
        <CardDescription>
          Lets teams import their PlayHQ fixtures on-chain. Teams with auto-sync on are refreshed every 6 hours.
          Use a read-only key — it's stored on-chain. Only the main admin account can change this.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {error
            ? "Only the main admin account can see this setting."
            : status?.configured
              ? `Connected (${status.baseUrl ?? ""})${status.updatedAt ? ` · updated ${new Date(status.updatedAt).toLocaleDateString()}` : ""}`
              : "Not connected yet."}
        </p>
        <div className="space-y-1">
          <Label>PlayHQ address</Label>
          <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label>API key</Label>
          <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="Paste a new key" />
        </div>
        <div className="flex gap-2">
          <Button
            onClick={() => save.mutate(false)}
            disabled={save.isPending || !apiKey.trim() || !baseUrl.trim().startsWith("https://")}
          >
            {save.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
            Save key
          </Button>
          {status?.configured && (
            <Button variant="outline" onClick={() => save.mutate(true)} disabled={save.isPending}>
              Remove
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
