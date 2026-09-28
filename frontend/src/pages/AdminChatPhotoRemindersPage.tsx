import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Save, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { toast } from "sonner";

const SETTING_KEY = "chat_photo_gallery_reminders";

type Settings = {
  enabled: boolean;
  window_start_hours: number;
  window_end_hours: number;
  cooldown_days: number;
};

const DEFAULTS: Settings = {
  enabled: true,
  window_start_hours: 24,
  window_end_hours: 48,
  cooldown_days: 7,
};

import { IcpUnavailablePage } from "@/components/IcpUnavailablePage";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function AdminChatPhotoRemindersPage() {
  if (resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true)) {
    return <IcpUnavailablePage title="Photo-reminder administration is unavailable in ICP lab mode" description="Media scanning, reminder selection, and delivery remain disabled external-worker workflows." />;
  }
  return <SupabaseAdminChatPhotoRemindersPage />;
}

function SupabaseAdminChatPhotoRemindersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();

  const { data: isAppAdmin, isLoading: roleLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  const { data: settingRow, isLoading: settingsLoading } = useQuery({
    queryKey: ["app_setting", SETTING_KEY],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("app_settings")
        .select("value")
        .eq("key", SETTING_KEY)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!isAppAdmin,
  });

  const [form, setForm] = useState<Settings>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (settingRow?.value) {
      const v = settingRow.value as Partial<Settings>;
      setForm({
        enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULTS.enabled,
        window_start_hours: Number(v.window_start_hours ?? DEFAULTS.window_start_hours),
        window_end_hours: Number(v.window_end_hours ?? DEFAULTS.window_end_hours),
        cooldown_days: Number(v.cooldown_days ?? DEFAULTS.cooldown_days),
      });
    }
  }, [settingRow]);

  if (roleLoading) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <Header navigate={navigate} />
        <p className="text-muted-foreground text-center">Access denied. App admin role required.</p>
      </div>
    );
  }

  const validate = (): string | null => {
    if (form.window_start_hours < 1) return "Window start must be at least 1 hour.";
    if (form.window_end_hours <= form.window_start_hours)
      return "Window end must be greater than window start.";
    if (form.window_end_hours > 168) return "Window end cannot exceed 168 hours (7 days).";
    if (form.cooldown_days < 1 || form.cooldown_days > 90)
      return "Cooldown must be between 1 and 90 days.";
    return null;
  };

  const handleSave = async () => {
    const err = validate();
    if (err) {
      toast.error(err);
      return;
    }
    setSaving(true);
    const { error } = await supabase
      .from("app_settings")
      .update({ value: form as any, updated_at: new Date().toISOString() })
      .eq("key", SETTING_KEY);
    setSaving(false);
    if (error) {
      toast.error("Failed to save: " + error.message);
      return;
    }
    toast.success("Settings saved");
    qc.invalidateQueries({ queryKey: ["app_setting", SETTING_KEY] });
  };

  const handleRunNow = async () => {
    setRunning(true);
    const { data, error } = await supabase.functions.invoke("chat-photo-gallery-reminders", {
      body: {},
    });
    setRunning(false);
    if (error) {
      toast.error("Run failed: " + error.message);
      return;
    }
    toast.success(
      `Done — scanned ${data?.scanned ?? 0}, posted ${data?.posted ?? 0}, skipped ${data?.skipped ?? 0}`,
    );
  };

  return (
    <div className="py-6 space-y-6 max-w-2xl mx-auto">
      <Header navigate={navigate} />

      <Card>
        <CardHeader>
          <CardTitle>Chat Photo Gallery Reminders</CardTitle>
          <CardDescription>
            Hourly cron nudges members who shared photos in team chats to publish them to the team gallery.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {settingsLoading ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="enabled" className="text-base">Enabled</Label>
                  <p className="text-xs text-muted-foreground">Turn the cron on or off globally.</p>
                </div>
                <Switch
                  id="enabled"
                  checked={form.enabled}
                  onCheckedChange={(v) => setForm({ ...form, enabled: v })}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="start">Window start (hours ago)</Label>
                  <Input
                    id="start"
                    type="number"
                    min={1}
                    max={168}
                    value={form.window_start_hours}
                    onChange={(e) => setForm({ ...form, window_start_hours: Number(e.target.value) })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="end">Window end (hours ago)</Label>
                  <Input
                    id="end"
                    type="number"
                    min={2}
                    max={168}
                    value={form.window_end_hours}
                    onChange={(e) => setForm({ ...form, window_end_hours: Number(e.target.value) })}
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Photos posted between these two ages are eligible. Default 24–48h.
              </p>

              <div className="space-y-2">
                <Label htmlFor="cooldown">Per-author cooldown (days)</Label>
                <Input
                  id="cooldown"
                  type="number"
                  min={1}
                  max={90}
                  value={form.cooldown_days}
                  onChange={(e) => setForm({ ...form, cooldown_days: Number(e.target.value) })}
                />
                <p className="text-xs text-muted-foreground">
                  An uploader won't get nudged again in the same team within this many days.
                </p>
              </div>

              <div className="flex gap-2 pt-2">
                <Button onClick={handleSave} disabled={saving} className="flex-1">
                  <Save className="h-4 w-4 mr-2" />
                  {saving ? "Saving…" : "Save settings"}
                </Button>
                <Button variant="outline" onClick={handleRunNow} disabled={running}>
                  <Play className="h-4 w-4 mr-2" />
                  {running ? "Running…" : "Run now"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Header({ navigate }: { navigate: ReturnType<typeof useNavigate> }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
        <ArrowLeft className="h-5 w-5" />
      </Button>
      <div>
        <h1 className="text-2xl font-bold">Chat Photo Reminders</h1>
        <p className="text-sm text-muted-foreground">Configure timing and cooldown</p>
      </div>
    </div>
  );
}
