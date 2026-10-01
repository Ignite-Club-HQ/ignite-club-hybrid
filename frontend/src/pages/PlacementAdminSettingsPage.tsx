import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Loader2, Plus, Trash2, Globe2, Save, Globe, FlaskConical } from "lucide-react";
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
  getBackendRoutingConfig,
  normalizeApprovedTarget,
  type ApprovedBackendTarget,
  type BackendProvider,
  type BackendEligibility,
  type BackendRoutingConfig,
  type BackendTargetKind,
} from "@/live/backendRouting";
import {
  FEATURE_AREAS,
  FEATURE_CANISTER_KEYS,
  isFeatureCanisterConfigured,
  resolveFeatureBackend,
} from "@/live/featureBackend";
import { getEffectiveBackend, getEffectiveTarget } from "@/live/loadBackendRouting";
import { getCurrentCountry, setProfileCountry } from "@/live/userCountry";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/ui/page-loading";
import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { getLiveBackendTargetRegistry, getActiveIcpTarget, type IcpTargetConfig } from "@/live/targetRegistry";
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

// The 14 backend canisters from backend/ + icp-domain-topology.json, plus the
// Internet Identity frontend asset canister. Used as suggestions in the mapping UI.
const KNOWN_CANISTER_KEYS = [
  // Control plane (global infrastructure)
  "placement_registry",
  "shard_router",
  "migration_coordinator",
  // Domain canisters (one per feature area)
  "identity_access",
  "pii_access_control",
  "club_domain",
  "events_domain",
  "competition_domain",
  "messaging_domain",
  "media_metadata",
  "vault_domain",
  "mini_league_domain",
  "club_points_domain",
  "insights_domain",
  // Blob store for on-chain media bytes (future; optional)
  "media_blob_store",
  // Workers (background jobs)
  "notification_queue",
  "timer_jobs",
  "secret_workload_identity",
  // Frontend asset canister
  "internet_identity_frontend",
];

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

const FEATURE_LABELS: Record<string, string> = {
  events: "Events",
  messaging: "Messaging",
  media: "Media",
  news: "Club news",
  home: "Home schedule",
  membership: "Membership",
  competitions: "Competitions",
  notifications: "Notifications",
  vault: "Vault",
};

/**
 * Synthetic target used by the dry-run preview: pretends every feature
 * canister is deployed so the admin can see how routing WOULD resolve once
 * real canister IDs are in place. Simulation only — it is never written to
 * the routing store and never used for real traffic.
 */
const SIMULATED_TARGET: IcpTargetConfig = {
  provider: "icp",
  alias: "simulated",
  networkKind: "public_mainnet",
  host: "https://icp0.io",
  deploymentClass: "public_subnet",
  canisterIds: Object.fromEntries(
    FEATURE_AREAS.map(feature => [FEATURE_CANISTER_KEYS[feature], "aaaaa-aa"]),
  ),
};

function tryActiveIcpTarget(): IcpTargetConfig | null {
  try {
    return getActiveIcpTarget();
  } catch {
    return null;
  }
}

export default function PlacementAdminSettingsPage() {
  const { user, profile } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAppAdmin, isLoading: isLoadingAuth } = useIsAppAdmin();

  const [rows, setRows] = useState<CanisterRow[]>([]);
  const [touched, setTouched] = useState(false);
  const [defaultBackend, setDefaultBackend] = useState<BackendProvider>("supabase");
  const [countryRows, setCountryRows] = useState<CountryRuleRow[]>([]);
  const [targetRows, setTargetRows] = useState<TargetRow[]>([]);
  const [routingTouched, setRoutingTouched] = useState(false);
  const [simulateCanisters, setSimulateCanisters] = useState(false);

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
    mutationFn: async (config: {
      defaultBackend: BackendProvider;
      countryRules: Record<string, BackendEligibility>;
      targets: ApprovedBackendTarget[];
      countryTargets: Record<string, string>;
    }) => {
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
          .insert({ key: BACKEND_ROUTING_CONFIG_KEY, value: config as never, description: "App-admin backend routing: default backend, per-country eligibility, and approved targets" } as never);
        if (error) throw error;
      }
      return config;
    },
    onSuccess: (config) => {
      applyBackendRoutingConfig(config);
      // Flipping backend routing changes which backend every feature reads
      // from (Supabase vs ICP). A full invalidation forces every feature
      // query cache to refetch under the new mode instead of continuing to
      // serve stale cross-mode data until each cache's own staleTime lapses.
      queryClient.invalidateQueries();
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
    setCountryRows(current => [...current, { country: suggestion, eligibility: "both", targetId: NO_TARGET_PIN }]);
  };

  const updateTargetRow = (index: number, patch: Partial<TargetRow>) => {
    setRoutingTouched(true);
    setTargetRows(current =>
      current.map((row, i) => {
        if (i !== index) return row;
        const next = { ...row, ...patch };
        // Keep the target kind valid when the backend changes.
        if (patch.backend && !KINDS_FOR_BACKEND[next.backend].includes(next.kind)) {
          next.kind = KINDS_FOR_BACKEND[next.backend][0];
        }
        return next;
      }),
    );
  };

  const removeTargetRow = (index: number) => {
    setRoutingTouched(true);
    setTargetRows(current => current.filter((_, i) => i !== index));
  };

  const addTargetRow = () => {
    setRoutingTouched(true);
    setTargetRows(current => [
      ...current,
      { backend: "supabase", kind: "supabase-region", alias: "", version: "v1", region: "", enabled: true },
    ]);
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
    try {
      const targets = targetRows
        .filter(row => row.alias.trim() || row.version.trim())
        .map(row => normalizeApprovedTarget({ ...row }));
      const seen = new Set<string>();
      for (const target of targets) {
        if (seen.has(target.id)) {
          throw new Error(`Target "${target.id}" is listed twice.`);
        }
        seen.add(target.id);
      }
      const countryTargets: Record<string, string> = {};
      for (const row of countryRows) {
        if (row.targetId === NO_TARGET_PIN) continue;
        const target = targets.find(t => t.id === row.targetId);
        if (!target) {
          throw new Error(`${countryName(row.country)} is pinned to a target that no longer exists.`);
        }
        const eligibility = countryRules[row.country];
        if (eligibility !== "both" && eligibility !== target.backend) {
          throw new Error(
            `${countryName(row.country)} is ${ELIGIBILITY_LABELS[eligibility].toLowerCase()} but is pinned to a ${target.backend === "icp" ? "ICP" : "Supabase"} target.`,
          );
        }
        countryTargets[row.country] = target.id;
      }
      routingMutation.mutate({ defaultBackend, countryRules, targets, countryTargets });
    } catch (error) {
      toast({ title: "Cannot save", description: error instanceof Error ? error.message : String(error), variant: "destructive" });
    }
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
                No canisters configured yet. Add one below once you have deployed a canister —
                the Key field suggests the 13 canisters your backend defines.
              </p>
            )}
            <datalist id="known-canister-keys">
              {KNOWN_CANISTER_KEYS.map((key) => (
                <option key={key} value={key} />
              ))}
            </datalist>
            {rows.map((row, index) => (
              <div key={index} className="flex items-end gap-2">
                <div className="space-y-1 w-2/5">
                  <Label htmlFor={`canister-key-${index}`}>Key</Label>
                  <Input
                    id={`canister-key-${index}`}
                    value={row.key}
                    onChange={(e) => updateRow(index, { key: e.target.value })}
                    placeholder="identity_access"
                    list="known-canister-keys"
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
            <CardTitle className="text-base">Approved targets</CardTitle>
            <CardDescription>
              The deployment targets each backend is approved to use — a Supabase region,
              or an ICP Cloud Engine / mainnet deployment, with a version. Only enabled
              targets can serve data; a disabled target is never routed to. You can pin a
              country to a specific target in the Country eligibility section below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {targetRows.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No approved targets — each backend uses its built-in default deployment.
              </p>
            )}
            {targetRows.map((row, index) => (
              <div key={index} className="space-y-2 rounded-md border p-3">
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1 w-40">
                    <Label htmlFor={`target-backend-${index}`}>Backend</Label>
                    <Select value={row.backend} onValueChange={(v) => updateTargetRow(index, { backend: v as BackendProvider })}>
                      <SelectTrigger id={`target-backend-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="supabase">Supabase</SelectItem>
                        <SelectItem value="icp">Internet Computer (ICP)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 w-44">
                    <Label htmlFor={`target-kind-${index}`}>Target type</Label>
                    <Select value={row.kind} onValueChange={(v) => updateTargetRow(index, { kind: v as BackendTargetKind })}>
                      <SelectTrigger id={`target-kind-${index}`}>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {KINDS_FOR_BACKEND[row.backend].map(kind => (
                          <SelectItem key={kind} value={kind}>{TARGET_KIND_LABELS[kind]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-2 pb-1">
                    <Switch
                      id={`target-enabled-${index}`}
                      checked={row.enabled}
                      onCheckedChange={(checked) => updateTargetRow(index, { enabled: checked })}
                    />
                    <Label htmlFor={`target-enabled-${index}`}>Enabled</Label>
                  </div>
                  <Button variant="ghost" size="icon" onClick={() => removeTargetRow(index)} aria-label="Remove target">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
                <div className="flex flex-wrap items-end gap-2">
                  <div className="space-y-1 flex-1 min-w-32">
                    <Label htmlFor={`target-alias-${index}`}>Alias</Label>
                    <Input
                      id={`target-alias-${index}`}
                      value={row.alias}
                      onChange={(e) => updateTargetRow(index, { alias: e.target.value })}
                      placeholder={row.backend === "supabase" ? "ap-southeast-2" : "cloud-engine-1"}
                    />
                  </div>
                  <div className="space-y-1 w-28">
                    <Label htmlFor={`target-version-${index}`}>Version</Label>
                    <Input
                      id={`target-version-${index}`}
                      value={row.version}
                      onChange={(e) => updateTargetRow(index, { version: e.target.value })}
                      placeholder="v1"
                    />
                  </div>
                  <div className="space-y-1 w-40">
                    <Label htmlFor={`target-region-${index}`}>Region (optional)</Label>
                    <Input
                      id={`target-region-${index}`}
                      value={row.region}
                      onChange={(e) => updateTargetRow(index, { region: e.target.value })}
                      placeholder="ap-southeast-2"
                    />
                  </div>
                </div>
              </div>
            ))}
            <Button variant="outline" onClick={addTargetRow}>
              <Plus className="mr-2 h-4 w-4" />
              Add target
            </Button>
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
                <div className="space-y-1 w-56">
                  <Label htmlFor={`pin-${index}`}>Pinned target</Label>
                  <Select value={row.targetId} onValueChange={(v) => updateCountryRow(index, { targetId: v })}>
                    <SelectTrigger id={`pin-${index}`}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={NO_TARGET_PIN}>No pin (first enabled target)</SelectItem>
                      {targetRows
                        .filter(t => t.alias.trim())
                        .filter(t => row.eligibility === "both" || t.backend === row.eligibility)
                        .map(t => {
                          const id = `${t.backend}/${t.alias.trim()}/${t.version.trim() || "v1"}`;
                          return (
                            <SelectItem key={id} value={id}>
                              {t.alias.trim()} · {t.version.trim() || "v1"} ({t.backend === "icp" ? "ICP" : "Supabase"})
                            </SelectItem>
                          );
                        })}
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
            <CardTitle className="text-base flex items-center gap-2">
              <FlaskConical className="h-4 w-4" />
              Dry run: preview ICP routing
            </CardTitle>
            <CardDescription>
              Simulate every feature canister being deployed, and see which backend each
              feature area would use under the rules on this page — before you have real
              canister IDs. Nothing here is saved and no traffic is sent to canisters.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center gap-2">
              <Switch
                id="simulate-canisters"
                checked={simulateCanisters}
                onCheckedChange={setSimulateCanisters}
              />
              <Label htmlFor="simulate-canisters">Simulate all canisters configured</Label>
            </div>
            {simulateCanisters && (() => {
              const { country } = getCurrentCountry();
              const previewConfig: BackendRoutingConfig = {
                defaultBackend,
                countryRules: Object.fromEntries(countryRows.map(r => [r.country, r.eligibility])),
                targets: [],
                countryTargets: {},
              };
              const currentTarget = tryActiveIcpTarget();
              return (
                <>
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="secondary">
                      Sign-in screen would show: {resolveFeatureBackend(previewConfig, country, SIMULATED_TARGET, "events") === "icp" ? "Internet Identity" : "Supabase"}
                    </Badge>
                  </div>
                  <div className="space-y-2">
                    {FEATURE_AREAS.map(feature => {
                      const configured = isFeatureCanisterConfigured(currentTarget, feature);
                      const currentBackend = resolveFeatureBackend(previewConfig, country, currentTarget, feature);
                      const simulatedBackend = resolveFeatureBackend(previewConfig, country, SIMULATED_TARGET, feature);
                      return (
                        <div key={feature} className="flex flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
                          <span className="font-medium w-32">{FEATURE_LABELS[feature]}</span>
                          <code className="text-xs text-muted-foreground flex-1 min-w-32">{FEATURE_CANISTER_KEYS[feature]}</code>
                          <Badge variant={configured ? "secondary" : "outline"} className="text-xs">
                            {configured ? "ID configured" : "no ID yet"}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            now: {currentBackend === "icp" ? "ICP" : "Supabase"}
                          </Badge>
                          <Badge variant={simulatedBackend === "icp" ? "default" : "secondary"} className="text-xs">
                            after deploy: {simulatedBackend === "icp" ? "ICP" : "Supabase"}
                          </Badge>
                        </div>
                      );
                    })}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    A feature only moves to ICP when its country is eligible for ICP (or the default
                    backend is ICP). Features that stay on Supabase above would keep using Supabase
                    even after deployment — check the default backend and country rules.
                  </p>
                </>
              );
            })()}
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
                  <Badge variant="secondary">
                    Effective target: {(() => {
                      const target = getEffectiveTarget();
                      return target ? `${target.alias} · ${target.version}` : "backend default (no approved targets)";
                    })()}
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
