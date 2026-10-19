import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { ArrowLeft, Save, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { PageLoading } from "@/components/ui/page-loading";
import { useIsAppAdmin } from "@/hooks/useIsAppAdmin";
import { toast } from "sonner";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";

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

function parseSettings(raw: unknown): Settings {
  const v = (raw ?? {}) as Partial<Settings>;
  return {
    enabled: typeof v.enabled === "boolean" ? v.enabled : DEFAULTS.enabled,
    window_start_hours: Number(v.window_start_hours ?? DEFAULTS.window_start_hours),
    window_end_hours: Number(v.window_end_hours ?? DEFAULTS.window_end_hours),
    cooldown_days: Number(v.cooldown_days ?? DEFAULTS.cooldown_days),
  };
}

export default function AdminChatPhotoRemindersPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isIcp = resolveAuthBackend() === "icp";

  const { isAppAdmin, isLoading: roleLoading } = useIsAppAdmin();

  const { data: settingRow, isLoading: settingsLoading, error: settingsError } = useQuery({
    queryKey: ["app_setting", SETTING_KEY, isIcp],
    queryFn: async () => {
      if (isIcp) {
        return withFeatureBackend("messaging", {
          supabase: async () => { throw new Error("Internet Identity connection required"); },
          icp: async (ctx) => {
            const { getLiveChatPhotoReminderSettings } = await import("@/live/features/messaging");
            return { value: await getLiveChatPhotoReminderSettings(ctx) };
          },
        }, { shared: "app" });
      }
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
      setForm(parseSettings(settingRow.value));
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
    if (![form.window_start_hours, form.window_end_hours, form.cooldown_days].every(Number.isSafeInteger)) return "Enter whole numbers.";
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
    try {
      if (isIcp) {
        await withFeatureBackend("messaging", {
          supabase: async () => { throw new Error("Internet Identity connection required"); },
          icp: async (ctx) => {
            const { setLiveChatPhotoReminderSettings } = await import("@/live/features/messaging");
            await setLiveChatPhotoReminderSettings(ctx, form);
          },
        }, { shared: "app" });
      } else {
        const { error } = await supabase
          .from("app_settings")
          .update({ value: form as any, updated_at: new Date().toISOString() })
          .eq("key", SETTING_KEY);
        if (error) throw error;
      }
      toast.success("Settings saved");
      qc.invalidateQueries({ queryKey: ["app_setting", SETTING_KEY] });
    } catch (e) {
      toast.error("Failed to save: " + (e as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const handleRunNow = async () => {
    const err = validate();
    if (err) { toast.error(err); return; }
    setRunning(true);
    let data: { scanned?: number; posted?: number; skipped?: number } | null = null;
    try {
      data = await withFeatureBackend("messaging", {
        supabase: async () => {
          const { data, error } = await supabase.functions.invoke("chat-photo-gallery-reminders", { body: {} });
          if (error) throw error;
          return data;
        },
        icp: async (ctx) => {
          const { runLiveChatPhotoGalleryReminders } = await import("@/live/features/messaging");
          return runLiveChatPhotoGalleryReminders(
            ctx, Date.now(),
            form.window_start_hours, form.window_end_hours, form.cooldown_days,
          );
        },
      }, { everyGroup: true, merge: (parts: Array<{ scanned?: number; posted?: number; skipped?: number } | null>) => parts.reduce((t, p) => ({ scanned: (t.scanned ?? 0) + (p?.scanned ?? 0), posted: (t.posted ?? 0) + (p?.posted ?? 0), skipped: (t.skipped ?? 0) + (p?.skipped ?? 0) }), { scanned: 0, posted: 0, skipped: 0 }) });
    } catch (e) {
      setRunning(false);
      toast.error("Run failed: " + (e as Error).message);
      return;
    }
    setRunning(false);
    toast.success(
      `Done — scanned ${data?.scanned ?? 0}, queued ${data?.posted ?? 0}, skipped ${data?.skipped ?? 0}`,
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
          {settingsError && <p role="alert" className="text-destructive">Could not load settings: {settingsError.message}</p>}
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
