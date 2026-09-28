import { useState, useEffect, Suspense } from "react";
import { usePageTitle } from "@/hooks/usePageTitle";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, User, Bell, Moon, Sun, Smartphone, Download, Send, MessageSquare, Calendar, Image, Users, LayoutGrid, Mail, Gift, Trophy, Settings, Fingerprint, ChevronRight, Lock, HelpCircle, Eye, Sparkles, Accessibility } from "lucide-react";
import { useTheme } from "next-themes";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePWAInstall } from "@/hooks/usePWAInstall";
import { usePasskey } from "@/hooks/usePasskey";
import { ChangePasswordDialog } from "@/components/ChangePasswordDialog";
import { FeedbackDialog } from "@/components/FeedbackDialog";
import { useUserHasAnyAICatchUpClub } from "@/hooks/useUserHasAnyAICatchUpClub";
import { useQueryClient } from "@tanstack/react-query";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { NotificationPreferenceList, type NotificationPreferenceDescriptor } from "@/components/NotificationPreferenceList";

// Check if we're on native platform at module load time
let isNativePlatform = false;
try {
  isNativePlatform = Capacitor.isNativePlatform();
} catch (e) {
  console.warn("[SettingsPage] Error checking native platform:", e);
}

const SKIP_WEB_PUSH = isNativePlatform;

// Lazy load push-related components
const LazyPushDiagnosticsCard = !SKIP_WEB_PUSH 
  ? lazyWithRetry(() => import("@/components/PushDiagnosticsCard").then(m => ({ default: m.PushDiagnosticsCard })))
  : () => null;

const LazyNativePushCard = SKIP_WEB_PUSH
  ? lazyWithRetry(() => import("@/components/NativePushCard").then(m => ({ default: m.NativePushCard })))
  : () => null;

const PasskeyManagementDialog = lazyWithRetry(() => import("@/components/PasskeyManagementDialog").then(m => ({ default: m.PasskeyManagementDialog })));

interface NotificationPreferences {
  messages_enabled: boolean;
  events_enabled: boolean;
  media_enabled: boolean;
  membership_enabled: boolean;
  pitch_board_enabled: boolean;
  rewards_enabled: boolean;
  show_message_preview: boolean;
}

interface EmailPreferences {
  email_messages_enabled: boolean;
  email_events_enabled: boolean;
  email_media_enabled: boolean;
  email_membership_enabled: boolean;
  email_admin_enabled: boolean;
  email_pitch_board_enabled: boolean;
  email_rewards_enabled: boolean;
  email_pom_enabled: boolean;
}

type NotificationPreferenceKey = keyof NotificationPreferences;
type EmailPreferenceKey = keyof EmailPreferences;

const pushPreferenceDescriptors: readonly NotificationPreferenceDescriptor<NotificationPreferenceKey>[] = [
  { key: "messages_enabled", icon: MessageSquare, label: "Messages", description: "Team, club, group chats & broadcasts" },
  {
    key: "show_message_preview",
    icon: Eye,
    label: "Show message text preview",
    description: "Show the message text on your lock screen. Sender name is always shown.",
    disabled: (values) => !values.messages_enabled,
  },
  { key: "events_enabled", icon: Calendar, label: "Events", description: "Invites, cancellations & duty assignments" },
  { key: "media_enabled", icon: Image, label: "Media", description: "Photo uploads, reactions & comments" },
  { key: "membership_enabled", icon: Users, label: "Membership", description: "Join requests & approvals" },
  { key: "pitch_board_enabled", icon: LayoutGrid, label: "Pitch Board", description: "Substitution alerts & game updates" },
  { key: "rewards_enabled", icon: Trophy, label: "Points & Rewards", description: "Points earned, rewards & engagement nudges" },
];

const nativePushPreferenceDescriptors = pushPreferenceDescriptors.filter(
  ({ key }) => key !== "rewards_enabled",
);

const emailPreferenceDescriptors: readonly NotificationPreferenceDescriptor<EmailPreferenceKey>[] = [
  { key: "email_events_enabled", icon: Calendar, label: "Events & Reminders", description: "Event invites, reminders & duty assignments" },
  { key: "email_membership_enabled", icon: Users, label: "Membership", description: "Team invites & join confirmations" },
  { key: "email_admin_enabled", icon: Settings, label: "Account & Admin", description: "Subscription renewals & system alerts" },
  { key: "email_pitch_board_enabled", icon: LayoutGrid, label: "Pitch Board", description: "Substitution alerts & game updates" },
  { key: "email_rewards_enabled", icon: Gift, label: "Rewards", description: "Reward redemptions & point updates" },
  { key: "email_pom_enabled", icon: Trophy, label: "Game Stats & Player of Match", description: "Player stats reports & POM award notifications" },
];

export default function SettingsPage() {
  const { user } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  usePageTitle("Settings");
  const navigate = useNavigate();
  const { toast } = useToast();
  const { canPrompt, isInstalled, isIOS, installApp } = usePWAInstall();
  const { setTheme, theme } = useTheme();
  const { isAvailable: biometricsAvailable, isRegistered: hasPasskey, loading: passkeyLoading, registerPasskey } = usePasskey();
  const [passkeyDialogOpen, setPasskeyDialogOpen] = useState(false);
  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [isAppAdmin, setIsAppAdmin] = useState(false);

  // Check if user is app admin
  useEffect(() => {
    const checkAppAdmin = async () => {
      if (!user || useIcpLab) return;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      setIsAppAdmin(!!data);
    };
    checkAppAdmin();
  }, [user, useIcpLab]);
  
  // Push notification state
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(!SKIP_WEB_PUSH);
  const [pushSupported, setPushSupported] = useState(!SKIP_WEB_PUSH);
  const [testingPush, setTestingPush] = useState(false);
  const [testPushDelay, setTestPushDelay] = useState(10);
  
  // Notification preferences
  const [preferences, setPreferences] = useState<NotificationPreferences>({
    messages_enabled: true,
    events_enabled: true,
    media_enabled: true,
    membership_enabled: true,
    pitch_board_enabled: true,
    rewards_enabled: true,
    show_message_preview: true,
  });
  const [emailPreferences, setEmailPreferences] = useState<EmailPreferences>({
    email_messages_enabled: true,
    email_events_enabled: true,
    email_media_enabled: true,
    email_membership_enabled: true,
    email_admin_enabled: true,
    email_pitch_board_enabled: true,
    email_rewards_enabled: true,
    email_pom_enabled: true,
  });
  const [prefsLoading, setPrefsLoading] = useState(false);
  const [emailPrefsLoading, setEmailPrefsLoading] = useState(false);
  const [aiCatchUpEnabled, setAiCatchUpEnabled] = useState(true);
  const [aiCatchUpLoading, setAiCatchUpLoading] = useState(false);
  const { hasAICatchUpClub } = useUserHasAnyAICatchUpClub();
  const settingsQueryClient = useQueryClient();
  
  const isMobileBrowser = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);

  // Load notification preferences
  useEffect(() => {
    const loadPreferences = async () => {
      if (!user || useIcpLab) return;
      
      const { data } = await supabase
        .from("notification_preferences")
        .select("*")
        .eq("user_id", user.id)
        .single();
      
      if (data) {
        const preferenceData = data as Record<string, boolean | null | undefined>;
        setPreferences({
          messages_enabled: Boolean(preferenceData.messages_enabled),
          events_enabled: Boolean(preferenceData.events_enabled),
          media_enabled: Boolean(preferenceData.media_enabled),
          membership_enabled: Boolean(preferenceData.membership_enabled),
          pitch_board_enabled: preferenceData.pitch_board_enabled ?? true,
          rewards_enabled: preferenceData.rewards_enabled ?? true,
          show_message_preview: preferenceData.show_message_preview ?? true,
        });
        setEmailPreferences({
          email_messages_enabled: preferenceData.email_messages_enabled ?? true,
          email_events_enabled: preferenceData.email_events_enabled ?? true,
          email_media_enabled: preferenceData.email_media_enabled ?? true,
          email_membership_enabled: preferenceData.email_membership_enabled ?? true,
          email_admin_enabled: preferenceData.email_admin_enabled ?? true,
          email_pitch_board_enabled: preferenceData.email_pitch_board_enabled ?? true,
          email_rewards_enabled: preferenceData.email_rewards_enabled ?? true,
          email_pom_enabled: preferenceData.email_pom_enabled ?? true,
        });
      }
    };
    
    loadPreferences();
  }, [user, useIcpLab]);

  // Load AI Chat Recap preference from profile
  useEffect(() => {
    const loadAiPref = async () => {
      if (!user || useIcpLab) return;
      const { data } = await supabase
        .from("profiles")
        .select("ai_catch_up_enabled")
        .eq("id", user.id)
        .maybeSingle();
      if (data) {
        const profileData = data as Record<string, unknown>;
        setAiCatchUpEnabled(profileData.ai_catch_up_enabled !== false);
      }
    };
    loadAiPref();
  }, [user, useIcpLab]);

  const handleAiCatchUpChange = async (value: boolean) => {
    if (!user || useIcpLab) return;
    setAiCatchUpLoading(true);
    const prev = aiCatchUpEnabled;
    setAiCatchUpEnabled(value);
    const { error } = await supabase
      .from("profiles")
      .update({ ai_catch_up_enabled: value })
      .eq("id", user.id);
    setAiCatchUpLoading(false);
    if (error) {
      setAiCatchUpEnabled(prev);
      toast({ title: "Failed to update", description: error.message, variant: "destructive" });
    } else {
      settingsQueryClient.invalidateQueries({ queryKey: ["user-ai-catchup-pref"] });
    }
  };

  // Check push notification status
  useEffect(() => {
    if (SKIP_WEB_PUSH) return;
    
    const checkPushStatus = async () => {
      if (typeof window === 'undefined' || 
          !('PushManager' in window) || 
          !('serviceWorker' in navigator) ||
          !('Notification' in window)) {
        setPushSupported(false);
        setPushLoading(false);
        return;
      }
      
      try {
        const pushModule = await import("@/lib/pushNotifications");
        const { checkPushSubscription, wasJustReset } = pushModule;
        
        if (wasJustReset()) {
          toast({
            title: "Push notifications reset",
            description: "Wait a few seconds, then enable notifications again",
          });
        }
        
        const isSubscribed = await checkPushSubscription(user?.id);
        setPushEnabled(isSubscribed);
        setPushLoading(false);
      } catch (err) {
        console.error("[SettingsPage] Failed to load push modules:", err);
        setPushSupported(false);
        setPushLoading(false);
      }
    };
    
    checkPushStatus();
  }, [toast, user?.id]);

  const handlePushToggle = async (enabled: boolean) => {
    if (SKIP_WEB_PUSH || !user) return;
    
    setPushLoading(true);
    
    try {
      const pushModule = await import("@/lib/pushNotifications");
      const { subscribeToPushNotifications, unsubscribeFromPushNotifications, forceUnlockPushSubscription } = pushModule;
      
      forceUnlockPushSubscription();
      
      if (enabled) {
        toast({ title: "Enabling push notifications...", description: "Please allow notifications if prompted" });
        const result = await subscribeToPushNotifications(user.id);
        
        if (result.success) {
          setPushEnabled(true);
          toast({ title: "Push notifications enabled" });
        } else {
          toast({ 
            title: "Could not enable notifications", 
            description: result.error || "Please check your browser permissions",
            variant: "destructive",
            duration: 20000
          });
        }
      } else {
        await unsubscribeFromPushNotifications(user.id);
        setPushEnabled(false);
        toast({ title: "Push notifications disabled" });
      }
    } catch (error) {
      console.error('[SettingsPage] Push toggle error:', error);
      toast({ 
        title: "Error updating notification settings", 
        description: error instanceof Error ? error.message : "Unknown error",
        variant: "destructive" 
      });
    }
    
    setPushLoading(false);
  };

  const handlePreferenceChange = async (key: keyof NotificationPreferences, value: boolean) => {
    if (!user || useIcpLab) return;
    
    const newPrefs = { ...preferences, [key]: value };
    setPreferences(newPrefs);
    setPrefsLoading(true);
    
    try {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: user.id, ...newPrefs }, { onConflict: "user_id" });
      
      if (error) throw error;
    } catch {
      setPreferences(preferences);
      toast({ title: "Failed to update preference", variant: "destructive" });
    }
    
    setPrefsLoading(false);
  };

  const handleEmailPreferenceChange = async (key: keyof EmailPreferences, value: boolean) => {
    if (!user || useIcpLab) return;
    
    const newPrefs = { ...emailPreferences, [key]: value };
    setEmailPreferences(newPrefs);
    setEmailPrefsLoading(true);
    
    try {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({ user_id: user.id, ...newPrefs }, { onConflict: "user_id" });
      
      if (error) throw error;
    } catch (error) {
      setEmailPreferences(emailPreferences);
      toast({ title: "Failed to update email preference", variant: "destructive" });
    }
    
    setEmailPrefsLoading(false);
  };

  const handleTestPush = async () => {
    if (!user || useIcpLab) return;
    
    setTestingPush(true);
    toast({
      title: "Test notification scheduled",
      description: `Notification will arrive in ${testPushDelay} seconds. Lock your phone now!`,
    });
    
    try {
      const { error } = await supabase.functions.invoke('test-push-notification', {
        body: { delay: testPushDelay }
      });
      
      if (error) {
        toast({ title: "Test failed", description: error.message, variant: "destructive" });
      } else {
        toast({ title: "Test sent!", description: "If push is working, you should have received a notification" });
      }
    } catch (err) {
      toast({ title: "Test failed", description: err instanceof Error ? err.message : "Unknown error", variant: "destructive" });
    }
    setTestingPush(false);
  };

  const handleSetupBiometrics = async () => {
    const result = await registerPasskey();
    if (result.success) {
      toast({
        title: "Biometric login enabled!",
        description: "You can now sign in with Face ID or Touch ID.",
      });
    } else {
      toast({
        title: "Setup failed",
        description: result.error || "Please try again.",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Settings</h1>
      </div>

      {/* Edit Profile Link */}
      <Card 
        className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => navigate("/edit-profile")}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <User className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="font-medium">Edit Profile</span>
              <p className="text-xs text-muted-foreground">Name, photo, and email</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>

      {/* Change Password */}
      <Card
        className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => setChangePasswordOpen(true)}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Lock className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="font-medium">Change Password</span>
              <p className="text-xs text-muted-foreground">Update your account password</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>

      {/* Appearance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            {theme === "dark" ? <Moon className="h-5 w-5" /> : <Sun className="h-5 w-5" />}
            Appearance
          </CardTitle>
          <CardDescription>Choose your preferred theme</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              {theme === "dark" ? (
                <Moon className="h-5 w-5 text-muted-foreground" />
              ) : (
                <Sun className="h-5 w-5 text-muted-foreground" />
              )}
              <span className="text-sm font-medium">Dark Mode</span>
            </div>
            <Switch
              checked={theme === "dark"}
              onCheckedChange={async (checked) => {
                const newTheme = checked ? "dark" : "light";
                const root = window.document.documentElement;
                root.classList.remove('light', 'dark');
                root.classList.add(newTheme);
                root.style.colorScheme = newTheme;
                localStorage.setItem('app-theme', newTheme);
                setTheme(newTheme);
                
                if (user && !useIcpLab) {
                  try {
                    await supabase.from('profiles').update({ theme_preference: newTheme }).eq('id', user.id);
                  } catch (err) {
                    console.error('[SettingsPage] Failed to save theme preference:', err);
                  }
                }
              }}
            />
          </div>
        </CardContent>
      </Card>

      {/* Accessibility */}
      <Card
        className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => navigate("/settings/accessibility")}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <Accessibility className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="font-medium">Accessibility</span>
              <p className="text-xs text-muted-foreground">
                Text size, high contrast, reduce motion, bold text
              </p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>


      {/* Biometrics / Passkeys */}
      {biometricsAvailable && (
        <Card 
          className="cursor-pointer hover:border-primary/50 transition-colors"
          onClick={hasPasskey ? () => setPasskeyDialogOpen(true) : handleSetupBiometrics}
        >
          <CardContent className="p-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-lg bg-primary/10">
                {passkeyLoading ? (
                  <Loader2 className="h-5 w-5 text-primary animate-spin" />
                ) : (
                  <Fingerprint className="h-5 w-5 text-primary" />
                )}
              </div>
              <div>
                <span className="font-medium">{hasPasskey ? "Manage Passkeys" : "Set up Face ID / Touch ID"}</span>
                <p className="text-xs text-muted-foreground">
                  {hasPasskey ? "View and manage your passkeys" : "Enable biometric login"}
                </p>
              </div>
              {hasPasskey && <Badge variant="secondary" className="text-xs">Active</Badge>}
            </div>
            <ChevronRight className="h-5 w-5 text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {/* Push Notifications Card */}
      {pushSupported && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Push Notifications
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="push-notifications">Enable Push Notifications</Label>
                <p className="text-xs text-muted-foreground">Receive notifications on your device</p>
              </div>
              <Switch
                id="push-notifications"
                checked={pushEnabled}
                onCheckedChange={handlePushToggle}
                disabled={pushLoading}
              />
            </div>

            {pushEnabled && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Label htmlFor="push-delay" className="text-sm whitespace-nowrap">Delay:</Label>
                  <select
                    id="push-delay"
                    value={testPushDelay}
                    onChange={(e) => setTestPushDelay(Number(e.target.value))}
                    className="flex h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    disabled={testingPush}
                  >
                    <option value={5}>5 sec</option>
                    <option value={10}>10 sec</option>
                    <option value={15}>15 sec</option>
                    <option value={30}>30 sec</option>
                    <option value={60}>60 sec</option>
                  </select>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleTestPush}
                    disabled={testingPush}
                    className="flex-1"
                  >
                    {testingPush ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                    {testingPush ? `Sending in ${testPushDelay}s...` : 'Test Push'}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Tap the button, then lock your phone. Notification arrives after the delay.
                </p>
              </div>
            )}

            <div className="text-xs text-muted-foreground flex items-center gap-2">
              <span>Browser permission:</span>
              <span className={
                typeof Notification !== 'undefined' && Notification.permission === 'granted' 
                  ? 'text-emerald-500 font-medium' 
                  : typeof Notification !== 'undefined' && Notification.permission === 'denied'
                  ? 'text-destructive font-medium'
                  : 'text-muted-foreground'
              }>
                {typeof Notification !== 'undefined' ? (
                  Notification.permission === 'granted' ? 'Allowed' : 
                  Notification.permission === 'denied' ? 'Blocked' : 'Not set'
                ) : 'N/A'}
              </span>
            </div>

            {typeof Notification !== 'undefined' && Notification.permission === 'denied' && (
              <div className="text-xs text-destructive/80 bg-destructive/10 p-3 rounded-md space-y-2">
                <p className="font-medium">Notifications are blocked by your browser</p>
                <div className="space-y-1">
                  <p className="font-medium">To unblock:</p>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>Click the <strong>lock/tune icon</strong> in the address bar</li>
                    <li>Find <strong>"Notifications"</strong></li>
                    <li>Change from "Block" to <strong>"Allow"</strong></li>
                    <li>Reload the page</li>
                  </ol>
                </div>
                <Button variant="outline" size="sm" className="mt-2" onClick={() => window.location.reload()}>
                  Refresh after unblocking
                </Button>
              </div>
            )}

            {/* PWA Install Prompt */}
            {isMobileBrowser && !isInstalled && (
              <div className="bg-primary/10 p-4 rounded-lg space-y-3">
                <div className="flex items-center gap-2">
                  <Smartphone className="h-5 w-5 text-primary" />
                  <p className="font-medium text-sm">Install for Better Notifications</p>
                </div>
                <p className="text-xs text-muted-foreground">
                  For reliable background notifications, install this app to your home screen.
                </p>
                {canPrompt ? (
                  <Button variant="default" size="sm" className="w-full" onClick={installApp}>
                    <Download className="h-4 w-4 mr-2" />
                    Install App
                  </Button>
                ) : isIOS ? (
                  <div className="text-xs space-y-2 bg-background/50 p-3 rounded-md">
                    <p className="font-medium">To install on iPhone/iPad:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Tap the <strong>Share</strong> button (square with arrow)</li>
                      <li>Scroll down and tap <strong>"Add to Home Screen"</strong></li>
                      <li>Tap <strong>"Add"</strong> to confirm</li>
                    </ol>
                  </div>
                ) : (
                  <div className="text-xs space-y-2 bg-background/50 p-3 rounded-md">
                    <p className="font-medium">To install on Android:</p>
                    <ol className="list-decimal list-inside space-y-1">
                      <li>Tap the <strong>menu</strong> (three dots) in your browser</li>
                      <li>Tap <strong>"Install app"</strong> or <strong>"Add to Home Screen"</strong></li>
                    </ol>
                  </div>
                )}
              </div>
            )}

            {isMobileBrowser && isInstalled && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 p-3 rounded-md">
                <Download className="h-4 w-4" />
                <span>App installed - background notifications are enabled</span>
              </div>
            )}

            {/* Category Preferences */}
            {pushEnabled && (
              <div className="space-y-4 pt-4 border-t">
                <p className="text-sm font-medium">Notification Categories</p>
                <p className="text-xs text-muted-foreground">Choose which types of notifications you want to receive</p>
                
                <NotificationPreferenceList
                  descriptors={pushPreferenceDescriptors}
                  values={preferences}
                  onChange={handlePreferenceChange}
                  disabled={prefsLoading}
                  className="space-y-3"
                />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Push Diagnostics - App Admin Only */}
      {isAppAdmin && !SKIP_WEB_PUSH && pushSupported && user && (
        <Suspense fallback={<Card><CardContent className="py-6"><div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div></CardContent></Card>}>
          <LazyPushDiagnosticsCard userId={user.id} pushEnabled={pushEnabled} onPushStatusChange={setPushEnabled} />
        </Suspense>
      )}

      {/* Native Push Category Preferences - shown for all native users */}
      {SKIP_WEB_PUSH && user && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Bell className="h-5 w-5" />
              Push Notifications
            </CardTitle>
            <CardDescription>Choose which types of push notifications you want to receive</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <NotificationPreferenceList
              descriptors={nativePushPreferenceDescriptors}
              values={preferences}
              onChange={handlePreferenceChange}
              disabled={prefsLoading}
              className="space-y-3"
            />
            <p className="text-xs text-muted-foreground pt-2">
              To fully disable push notifications, go to your device Settings &gt; Notifications &gt; Ignite.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Native Push Card - App Admin Only */}
      {SKIP_WEB_PUSH && isAppAdmin && user && (
        <Suspense fallback={<Card><CardContent className="py-6"><div className="flex justify-center"><Loader2 className="h-6 w-6 animate-spin" /></div></CardContent></Card>}>
          <LazyNativePushCard userId={user.id} />
        </Suspense>
      )}

      {/* AI Chat Recap */}
      {user && hasAICatchUpClub && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              AI Chat Recap
            </CardTitle>
            <CardDescription>
              Control whether you see AI-generated summaries of chat threads
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center justify-between">
              <div className="space-y-1 pr-4">
                <Label htmlFor="ai-catchup-user" className="text-base font-medium">
                  Show AI summaries
                </Label>
                <p className="text-xs text-muted-foreground">
                  When on, you'll see "Chat Recap" cards and a menu option to summarise recent messages in your chats. Only available in clubs on Pro where the feature has been enabled.
                </p>
              </div>
              <Switch
                id="ai-catchup-user"
                checked={aiCatchUpEnabled}
                onCheckedChange={handleAiCatchUpChange}
                disabled={aiCatchUpLoading}
              />
            </div>
          </CardContent>
        </Card>
      )}

      {/* Email Notifications Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="h-5 w-5" />
            Email Notifications
          </CardTitle>
          <CardDescription>Choose which types of emails you want to receive</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <NotificationPreferenceList
            descriptors={emailPreferenceDescriptors}
            values={emailPreferences}
            onChange={handleEmailPreferenceChange}
            disabled={emailPrefsLoading}
            className="space-y-3"
          />
        </CardContent>
      </Card>

      {/* Account Link */}
      <Card 
        className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => navigate("/account")}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-muted">
              <Settings className="h-5 w-5 text-muted-foreground" />
            </div>
            <div>
              <span className="font-medium">Account & Privacy</span>
              <p className="text-xs text-muted-foreground">Legal, data export, delete account</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>

      {/* Help and Support */}
      <Card 
        className="cursor-pointer hover:border-primary/50 transition-colors"
        onClick={() => setFeedbackOpen(true)}
      >
        <CardContent className="p-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-primary/10">
              <HelpCircle className="h-5 w-5 text-primary" />
            </div>
            <div>
              <span className="font-medium">Help and Support</span>
              <p className="text-xs text-muted-foreground">Report bugs or suggest features</p>
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground" />
        </CardContent>
      </Card>

      {/* Passkey Management Dialog */}
      <Suspense fallback={null}>
      <PasskeyManagementDialog open={passkeyDialogOpen} onOpenChange={setPasskeyDialogOpen} />
      </Suspense>

      {/* Change Password Dialog */}
      <ChangePasswordDialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen} />

      {/* Feedback Dialog */}
      <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
    </div>
  );
}
