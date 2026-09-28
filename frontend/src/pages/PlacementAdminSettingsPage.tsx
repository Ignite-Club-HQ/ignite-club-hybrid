import { ArrowLeft, Globe2, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { createPlacementAdminController, type PlacementAdminController, type PlacementAdminSettings } from "@/lab/placementAdminSettings";
import { PlacementAdminSettingsPanel } from "@/lab/PlacementAdminSettingsPanel";

const initialSettings: PlacementAdminSettings = {
  countries: [
    {
      country: "AU",
      allowedBackends: ["supabase"],
      policies: [
        { backend: "supabase", enabled: true, targetAlias: "supabase-au-primary", version: "v1", targetKind: "supabase-region", region: "ap-southeast-2" },
        { backend: "icp", enabled: false, targetAlias: "icp-au-cloud-engine", version: "v1", targetKind: "icp-cloud-engine", region: "AU_SYDNEY" },
      ],
    },
    {
      country: "US",
      allowedBackends: ["icp", "supabase"],
      policies: [
        { backend: "icp", enabled: true, targetAlias: "icp-public-mainnet", version: "mainnet-v1", targetKind: "icp-mainnet", region: "GLOBAL_NON_RESTRICTED" },
        { backend: "icp", enabled: true, targetAlias: "icp-us-cloud-engine", version: "v1", targetKind: "icp-cloud-engine", region: "US_EAST" },
        { backend: "supabase", enabled: true, targetAlias: "supabase-us-primary", version: "v2", targetKind: "supabase-region", region: "us-east-1" },
      ],
    },
  ],
  clubs: [],
};

export function PlacementAdminSettingsPage({
  controller = createPlacementAdminController(initialSettings),
  isAppAdmin = true,
}: {
  controller?: PlacementAdminController;
  isAppAdmin?: boolean;
}) {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const onBack = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    }
  };

  if (useIcpLab) {
    return <IcpUnavailablePage title="Placement settings are unavailable in ICP lab mode" description="The local placement-admin control plane is intentionally disabled until the approved external worker and policy boundary is implemented." />;
  }

  if (!isAppAdmin) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <div className="sticky top-0 z-10 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="icon" onClick={onBack}>
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">Infrastructure / Placement Settings</h1>
          </div>
        </div>
        <div className="flex flex-1 items-center justify-center p-4">
          <p className="text-muted-foreground">Access denied. App admin role required.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="sticky top-0 z-10 bg-background/95 border-b backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex items-center gap-3 px-4 py-3">
          <Globe2 className="h-5 w-5 text-primary" />
          <div>
            <h1 className="text-lg font-semibold">Infrastructure / Placement Settings</h1>
            <p className="text-xs text-muted-foreground">Country policy always wins over club selection.</p>
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-5xl flex-1 space-y-4 overflow-y-auto p-4">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <ShieldCheck className="h-5 w-5 text-emerald-500" />
              Placement controls
            </CardTitle>
            <CardDescription>App-admin control plane for country policies, target approval, and site availability.</CardDescription>
          </CardHeader>
          <CardContent>
            <PlacementAdminSettingsPanel controller={controller} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export default function PlacementAdminSettingsRoute() {
  return <PlacementAdminSettingsPage controller={createPlacementAdminController(initialSettings)} isAppAdmin />;
}
