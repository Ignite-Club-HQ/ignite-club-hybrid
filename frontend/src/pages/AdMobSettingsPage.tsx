import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Smartphone, Save, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/ui/page-loading";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

interface AdMobConfig {
  id: string;
  platform: string;
  app_id: string;
  banner_ad_unit_id: string;
  interstitial_ad_unit_id: string;
  is_enabled: boolean;
}

export default function AdMobSettingsPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Smartphone className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">AdMob settings are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Native advertising identifiers and provider configuration remain outside the ICP application boundary.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseAdMobSettingsPage />;
}

function SupabaseAdMobSettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { data: configs, isLoading } = useQuery({
    queryKey: ["admob-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("admob_config")
        .select("*")
        .order("platform");
      if (error) throw error;
      return data as AdMobConfig[];
    },
  });

  if (isLoading) return <PageLoading />;

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">AdMob Settings</h1>
          <p className="text-sm text-muted-foreground">Configure Google AdMob for native apps</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            <ExternalLink className="h-4 w-4" />
            Getting Started
          </CardTitle>
          <CardDescription>
            Create an AdMob account at{" "}
            <button onClick={() => import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://reference.invalid"))} className="text-primary underline cursor-pointer">
              admob.google.com
            </button>
            , register your app for each platform, then create ad units and paste the IDs below.
            Ads only show on native mobile apps for non-Pro users.
          </CardDescription>
        </CardHeader>
      </Card>

      {configs?.map((config) => (
        <PlatformConfigCard key={config.id} config={config} queryClient={queryClient} />
      ))}
    </div>
  );
}

function PlatformConfigCard({ config, queryClient }: { config: AdMobConfig; queryClient: ReturnType<typeof useQueryClient> }) {
  const [appId, setAppId] = useState(config.app_id);
  const [bannerId, setBannerId] = useState(config.banner_ad_unit_id);
  const [interstitialId, setInterstitialId] = useState(config.interstitial_ad_unit_id);
  const [isEnabled, setIsEnabled] = useState(config.is_enabled);

  const mutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("admob_config")
        .update({
          app_id: appId,
          banner_ad_unit_id: bannerId,
          interstitial_ad_unit_id: interstitialId,
          is_enabled: isEnabled,
        })
        .eq("id", config.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admob-config"] });
      toast({ title: "Saved", description: `${config.platform === "android" ? "Android" : "iOS"} AdMob settings updated.` });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to save settings.", variant: "destructive" });
    },
  });

  const isAndroid = config.platform === "android";
  const platformLabel = isAndroid ? "Android" : "iOS";
  const PlatformIcon = Smartphone;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <PlatformIcon className="h-5 w-5" />
            {platformLabel}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Label htmlFor={`enabled-${config.id}`} className="text-sm">Enabled</Label>
            <Switch
              id={`enabled-${config.id}`}
              checked={isEnabled}
              onCheckedChange={setIsEnabled}
            />
          </div>
        </div>
        <CardDescription>
          {isAndroid
            ? "Bundle: app.lovable.igniteteamhub"
            : "Bundle: app.lovable.igniteteamhub"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Label htmlFor={`app-id-${config.id}`}>App ID</Label>
          <Input
            id={`app-id-${config.id}`}
            placeholder="ca-app-pub-XXXXXXXXXXXXXXXX~YYYYYYYYYY"
            value={appId}
            onChange={(e) => setAppId(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">Found in AdMob → Apps → App settings</p>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`banner-${config.id}`}>Banner Ad Unit ID</Label>
          <Input
            id={`banner-${config.id}`}
            placeholder="ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY"
            value={bannerId}
            onChange={(e) => setBannerId(e.target.value)}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`interstitial-${config.id}`}>Interstitial Ad Unit ID (optional)</Label>
          <Input
            id={`interstitial-${config.id}`}
            placeholder="ca-app-pub-XXXXXXXXXXXXXXXX/YYYYYYYYYY"
            value={interstitialId}
            onChange={(e) => setInterstitialId(e.target.value)}
          />
        </div>

        <Button onClick={() => mutation.mutate()} disabled={mutation.isPending} className="w-full">
          <Save className="h-4 w-4 mr-2" />
          {mutation.isPending ? "Saving..." : `Save ${platformLabel} Settings`}
        </Button>
      </CardContent>
    </Card>
  );
}
