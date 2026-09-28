import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2, Globe2, Save, Globe } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { ISO_COUNTRY_CODES, countryName } from "@/lib/countries";
import {
  BACKEND_ROUTING_CONFIG_KEY,
  applyBackendRoutingConfig,
  parseBackendRoutingConfig,
  DEFAULT_BACKEND_ROUTING_CONFIG,
  normalizeApprovedTarget,
  type ApprovedBackendTarget,
  type BackendProvider,
  type BackendEligibility,
  type BackendTargetKind,
} from "@/live/backendRouting";
import { getEffectiveBackend, getEffectiveTarget } from "@/live/loadBackendRouting";
import { getCurrentCountry, setProfileCountry } from "@/live/userCountry";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/ui/page-loading";
import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLiveBackendTargetRegistry } from "@/live/targetRegistry";
import {
  ICP_CANISTER_CONFIG_KEY,
  applyIcpAdminOverrides,
  parseIcpAdminOverrides,
  validateCanisterId,
  type IcpAdminOverrides,
} from "@/live/icpAdminOverrides";

type CanisterRow = { key: string; id: string };
type CountryRuleRow = { country: string; eligibility: BackendEligibility; targetId: string };
type TargetRow = { backend: BackendProvider; kind: BackendTargetKind; alias: string; version: string; region: string; enabled: boolean };

const TARGET_KIND_LABELS: Record<BackendTargetKind, string> = {
  "supabase-region": "Supabase region",
  "icp-cloud-engine": "ICP Cloud Engine",
  "icp-mainnet": "ICP mainnet",
};

const KINDS_FOR_BACKEND: Record<BackendProvider, BackendTargetKind[]> = {
  supabase: ["supabase-region"],
  icp: ["icp-cloud-engine", "icp-mainnet"],
};

const NO_TARGET_PIN = "__none__";

const ELIGIBILITY_LABELS: Record<BackendEligibility, string> = {
  supabase: "Supabase only",
  icp: "ICP only",
  both: "Both",
};

const KNOWN_CANISTER_KEYS = ["identity_access", "internet_identity_frontend"];

function envBaselineCanisterIds(): Record<string, string> {
  try {
    const registry = getLiveBackendTargetRegistry();
    const target = registry.icpTargets.find(t => t.alias === registry.activeIcpAlias);
    return target?.canisterIds ?? {};
  } catch {
    return {};
  }
}

function rowsFromOverrides(overrides: IcpAdminOverrides | null): CanisterRow[] {
  if (!overrides) return [];
  return Object.entries(overrides.canisterIds).map(([key, id]) => ({ key, id }));
}

function validateRows(rows: CanisterRow[]): Record<string, string> {
  const canisterIds: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    const id = row.id.trim();
    if (!key && !id) continue;
    if (!/^[a-z][a-z0-9_]{0,62}$/.test(key)) {
      throw new Error(`Canister key "${key || "(empty)"}" must be lowercase letters, digits and underscores, starting with a letter.`);
    }
    if (!id) throw new Error(`Canister "${key}" is missing its canister ID.`);
    if (canisterIds[key]) throw new Error(`Canister key "${key}" is listed twice.`);
    canisterIds[key] = validateCanisterId(key, id);
  }
  return canisterIds;
}

export default function PlacementAdminSettingsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAppAdmin, isLoading: isLoadingAuth } = useIsAppAdmin();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  const [rows, setRows] = useState<CanisterRow[]>([]);
  const [touched, setTouched] = useState(false);
  const [defaultBackend, setDefaultBackend] = useState<BackendProvider>("supabase");
  const [countryRows, setCountryRows] = useState<CountryRuleRow[]>([]);
  const [targetRows, setTargetRows] = useState<TargetRow[]>([]);
  const [routingTouched, setRoutingTouched] = useState(false);

  const profileCountry = ((profile as { country?: string | null } | null)?.country ?? null);
  useEffect(() => {
    setProfileCountry(profileCountry);
  }, [profileCountry]);

  const { data: savedOverrides, isLoading: isLoadingSettings } = useQuery({
    queryKey: ["app-setting", ICP_CANISTER_CONFIG_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", ICP_CANISTER_CONFIG_KEY)
        .maybeSingle();
      if (error) throw error;
      return data ? parseIcpAdminOverrides(data.value) : null;
    },
    enabled: !!user && isAppAdmin,
  });

  useEffect(() => {
    if (!touched && savedOverrides !== undefined) {
      setRows(rowsFromOverrides(savedOverrides));
    }
  }, [savedOverrides, touched]);

  const { data: savedRouting, isLoading: isLoadingRouting } = useQuery({
    queryKey: ["app-setting", BACKEND_ROUTING_CONFIG_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", BACKEND_ROUTING_CONFIG_KEY)
        .maybeSingle();
      if (error) throw error;
      return data ? parseBackendRoutingConfig(data.value) : null;
    },
    enabled: !!user && isAppAdmin,
  });

  useEffect(() => {
    if (routingTouched || savedRouting === undefined) return;
    const config = savedRouting ?? DEFAULT_BACKEND_ROUTING_CONFIG;
    setDefaultBackend(config.defaultBackend);
    setCountryRows(
      Object.entries(config.countryRules).map(([country, eligibility]) => ({
        country,
        eligibility,
        targetId: config.countryTargets[country] ?? NO_TARGET_PIN,
      })),
    );
    setTargetRows(
      config.targets.map(t => ({
        backend: t.backend,
        kind: t.kind,
        alias: t.alias,
        version: t.version,
        region: t.region ?? "",
        enabled: t.enabled,
      })),
    );
  }, [savedRouting, routingTouched]);

  const routingMutation = useMutation({
    mutationFn: async (config: { defaultBackend: BackendProvider; countryRules: Record<string, BackendEligibility> }) => {
      const { data: existing, error: readError } = await supabase
        .from("app_settings")
        .select("id")
        .eq("key", BACKEND_ROUTING_CONFIG_KEY)
        .maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error } = await supabase
          .from("app_settings")
          .update({ value: config as never })
          .eq("key", BACKEND_ROUTING_CONFIG_KEY);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("app_settings")
          .insert({ key: BACKEND_ROUTING_CONFIG_KEY, value: config as never, description: "App-admin backend routing: default backend and per-country eligibility" } as never);
        if (error) throw error;
      }
      return config;
    },
    onSuccess: (config) => {
      applyBackendRoutingConfig(config);
      queryClient.invalidateQueries({ queryKey: ["app-setting", BACKEND_ROUTING_CONFIG_KEY] });
      setRoutingTouched(false);
      toast({ title: "Backend routing saved", description: "The routing configuration is active for this session and all future sessions." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save routing", description: error.message, variant: "destructive" });
    },
  });

  const updateCountryRow = (index: number, patch: Partial<CountryRuleRow>) => {
    setRoutingTouched(true);
    setCountryRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeCountryRow = (index: number) => {
    setRoutingTouched(true);
    setCountryRows(current => current.filter((_, i) => i !== index));
  };

  const addCountryRow = () => {
    setRoutingTouched(true);
    const suggestion = ISO_COUNTRY_CODES.find(code => !countryRows.some(r => r.country === code)) ?? "AU";
    setCountryRows(current => [...current, { country: suggestion, eligibility: "both" }]);
  };

  const handleSaveRouting = () => {
    const countryRules: Record<string, BackendEligibility> = {};
    for (const row of countryRows) {
      if (countryRules[row.country]) {
        toast({ title: "Cannot save", description: `${countryName(row.country)} is listed twice.`, variant: "destructive" });
        return;
      }
      countryRules[row.country] = row.eligibility;
    }
    routingMutation.mutate({ defaultBackend, countryRules });
  };

  const saveMutation = useMutation({
    mutationFn: async (canisterIds: Record<string, string>) => {
      const value = { canisterIds };
      const { data: existing, error: readError } = await supabase
        .from("app_settings")
        .select("id")
        .eq("key", ICP_CANISTER_CONFIG_KEY)
        .maybeSingle();
      if (readError) throw readError;
      if (existing) {
        const { error } = await supabase
          .from("app_settings")
          .update({ value: value as never })
          .eq("key", ICP_CANISTER_CONFIG_KEY);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("app_settings")
          .insert({ key: ICP_CANISTER_CONFIG_KEY, value: value as never, description: "App-admin ICP canister ID overrides" } as never);
        if (error) throw error;
      }
      return canisterIds;
    },
    onSuccess: (canisterIds) => {
      const overrides = Object.keys(canisterIds).length > 0 ? { canisterIds } : null;
      applyIcpAdminOverrides(overrides);
      queryClient.invalidateQueries({ queryKey: ["app-setting", ICP_CANISTER_CONFIG_KEY] });
      setTouched(false);
      toast({ title: "ICP canisters saved", description: "The new canister configuration is active for this session and all future sessions." });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save canisters", description: error.message, variant: "destructive" });
    },
  });

  const updateRow = (index: number, patch: Partial<CanisterRow>) => {
    setTouched(true);
    setRows(current => current.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  const removeRow = (index: number) => {
    setTouched(true);
    setRows(current => current.filter((_, i) => i !== index));
  };

  const addRow = () => {
    setTouched(true);
    const suggestion = KNOWN_CANISTER_KEYS.find(k => !rows.some(r => r.key.trim() === k));
    setRows(current => [...current, { key: suggestion ?? "", id: "" }]);
  };

  const handleSave = () => {
    try {
      saveMutation.mutate(validateRows(rows));
    } catch (error) {
      toast({ title: "Cannot save", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
  };

  if (useIcpLab) {
    return <IcpUnavailablePage title="Placement settings are unavailable in ICP lab mode" description="The local placement-admin control plane is intentionally disabled until the approved external worker and policy boundary is implemented." />;
  }

  if (isLoadingAuth || (isAppAdmin && (isLoadingSettings || isLoadingRouting))) {
    return <PageLoading />;
  }

  if (!isAppAdmin) {
    return (
      <div className="min-h-[100dvh] flex flex-col bg-background">
        <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
          <div className="flex items-center gap-3 px-4 py-3">
            <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
              <ArrowLeft className="h-5 w-5" />
            </Button>
            <h1 className="text-lg font-semibold">Infrastructure / Placement Settings</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center p-4">
          <p className="text-muted-foreground">Access denied. App admin role required.</p>
        </div>
      </div>
    );
  }

  const envIds = envBaselineCanisterIds();
  const envEntries = Object.entries(envIds);

  return (
    <div className="min-h-[100dvh] flex flex-col bg-background">
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 border-b">
        <div className="flex items-center gap-3 px-4 py-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-2">
            <Globe2 className="h-5 w-5 text-primary" />
            <div>
              <h1 className="text-lg font-semibold">Infrastructure / Placement Settings</h1>
              <p className="text-xs text-muted-foreground">ICP canisters, default backend, and per-country eligibility — one set of rules for the whole app.</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4 max-w-2xl mx-auto w-full">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Canister configuration</CardTitle>
            <CardDescription>
              Map each app canister key (e.g. <code className="text-xs">identity_access</code>) to the
              canister ID you deployed on the Internet Computer. Values saved here take effect
              immediately and for every signed-in session, and override the build-time defaults
              key-by-key.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {rows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No canisters configured yet. Add one below once you have deployed a canister.
              </p>
            )}
            {rows.map((row, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="space-y-1 w-2/5">
                  <Label htmlFor={`canister-key-${index}`}>Key</Label>
                  <Input
                    id={`canister-key-${index}`}
                    value={row.key}
                    onChange={(e) => updateRow(index, { key: e.target.value })}
                    placeholder="identity_access"
                  />
                </div>
                <div className="space-y-1 flex-1">
                  <Label htmlFor={`canister-id-${index}`}>Canister ID</Label>
                  <Input
                    id={`canister-id-${index}`}
                    value={row.id}
                    onChange={(e) => updateRow(index, { id: e.target.value })}
                    placeholder="aaaaa-bbbbb-ccccc-ddddd-cai"
                  />
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeRow(index)} aria-label="Remove canister">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex gap-2">
              <Button variant="outline" onClick={addRow}>
                <Plus className="mr-2 h-4 w-4" />
                Add canister
              </Button>
              <Button onClick={handleSave} disabled={saveMutation.isPending}>
                {saveMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Build-time defaults</CardTitle>
            <CardDescription>
              Canister IDs baked into this build via <code className="text-xs">IGNITE_LIVE_ICP_CANISTER_IDS_JSON</code>.
              Any key you configure above replaces the matching value here.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {envEntries.length === 0 ? (
              <p className="text-sm text-muted-foreground">No build-time canister IDs are set.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {envEntries.map(([key, id]) => (
                  <Badge key={key} variant="secondary" className="font-mono text-xs">
                    {key}: {id}
                  </Badge>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Globe className="h-4 w-4" />
              Backend routing
            </CardTitle>
            <CardDescription>
              Choose the default backend for the whole app. Countries eligible for both
              backends use this default; countries restricted to one backend always use
              that one. Routing picks which backend serves data — it never blocks
              anyone from signing in or using the app.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Label htmlFor="default-backend">Default backend</Label>
            <Select value={defaultBackend} onValueChange={(v) => { setRoutingTouched(true); setDefaultBackend(v as BackendProvider); }}>
              <SelectTrigger id="default-backend" className="w-full sm:w-64">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="supabase">Supabase</SelectItem>
                <SelectItem value="icp">Internet Computer (ICP)</SelectItem>
              </SelectContent>
            </Select>
            {defaultBackend === "icp" && envEntries.length === 0 && rows.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No canisters are configured yet, so the app will keep using Supabase
                until you add canister IDs above.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Country eligibility</CardTitle>
            <CardDescription>
              Restrict which backend(s) each country may use. Countries not listed here
              are eligible for both. A member's country comes from their profile if set,
              otherwise from their internet connection.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {countryRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No country rules — every country is eligible for both backends.
              </p>
            )}
            {countryRows.map((row, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="space-y-1 flex-1">
                  <Label htmlFor={`country-${index}`}>Country</Label>
                  <Select value={row.country} onValueChange={(v) => updateCountryRow(index, { country: v })}>
                    <SelectTrigger id={`country-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {ISO_COUNTRY_CODES.map(code => (
                        <SelectItem key={code} value={code}>{countryName(code)} ({code})</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1 w-44">
                  <Label htmlFor={`eligibility-${index}`}>Eligible for</Label>
                  <Select value={row.eligibility} onValueChange={(v) => updateCountryRow(index, { eligibility: v as BackendEligibility })}>
                    <SelectTrigger id={`eligibility-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(Object.keys(ELIGIBILITY_LABELS) as BackendEligibility[]).map(value => (
                        <SelectItem key={value} value={value}>{ELIGIBILITY_LABELS[value]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button variant="ghost" size="icon" onClick={() => removeCountryRow(index)} aria-label="Remove country rule">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}

            <div className="flex gap-2">
              <Button variant="outline" onClick={addCountryRow}>
                <Plus className="mr-2 h-4 w-4" />
                Add country
              </Button>
              <Button onClick={handleSaveRouting} disabled={routingMutation.isPending}>
                {routingMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                Save routing
              </Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Status</CardTitle>
            <CardDescription>How the routing rules apply to you right now.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            {(() => {
              const current = getCurrentCountry();
              return (
                <>
                  <Badge variant="secondary">
                    Your country: {current.country ? `${countryName(current.country)} (${current.country})` : "unknown"}
                    {current.source === "profile" ? " — from profile" : current.source === "ip" ? " — from connection" : ""}
                  </Badge>
                  <Badge variant="secondary">
                    Effective backend: {getEffectiveBackend() === "icp" ? "Internet Computer (ICP)" : "Supabase"}
                  </Badge>
                </>
              );
            })()}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
