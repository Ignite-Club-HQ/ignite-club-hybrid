import { useState, useEffect } from "react";
import { Bell, Loader2, Send, CheckCircle, XCircle, Smartphone, MessageSquare, Calendar, Image, Users, Settings, LayoutGrid, Gift, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

interface NativePushCardProps {
  userId: string;
}

interface PushPreferences {
  messages_enabled: boolean;
  events_enabled: boolean;
  media_enabled: boolean;
  membership_enabled: boolean;
  admin_enabled: boolean;
  pitch_board_enabled: boolean;
  rewards_enabled: boolean;
  pom_enabled: boolean;
}

const defaultPreferences: PushPreferences = {
  messages_enabled: true,
  events_enabled: true,
  media_enabled: true,
  membership_enabled: true,
  admin_enabled: true,
  pitch_board_enabled: true,
  rewards_enabled: true,
  pom_enabled: true,
};

export function NativePushCard({ userId }: NativePushCardProps) {
  const [pushEnabled, setPushEnabled] = useState(false);
  const [loading, setLoading] = useState(true);
  const [enabling, setEnabling] = useState(false);
  const [testingPush, setTestingPush] = useState(false);
  const [testPushDelay, setTestPushDelay] = useState(10);
  const [preferences, setPreferences] = useState<PushPreferences>(defaultPreferences);
  const [prefsLoading, setPrefsLoading] = useState(false);

  // Check if native push is already enabled and load preferences
  useEffect(() => {
    const checkStatus = async () => {
      try {
        // Check if user has FCM tokens in the database
        const { data: tokenData, error: tokenError } = await supabase
          .from('fcm_tokens' as any)
          .select('id')
          .eq('user_id', userId)
          .limit(1);
        
        // Load notification preferences
        const { data: prefsData } = await supabase
          .from("notification_preferences")
          .select("*")
          .eq("user_id", userId)
          .single();
        
        if (prefsData) {
          setPreferences({
            messages_enabled: prefsData.messages_enabled ?? true,
            events_enabled: prefsData.events_enabled ?? true,
            media_enabled: prefsData.media_enabled ?? true,
            membership_enabled: prefsData.membership_enabled ?? true,
            admin_enabled: prefsData.admin_enabled ?? true,
            pitch_board_enabled: prefsData.pitch_board_enabled ?? true,
            rewards_enabled: prefsData.rewards_enabled ?? true,
            pom_enabled: prefsData.pom_enabled ?? true,
          });
        }
        
        const hasToken = !tokenError && tokenData && tokenData.length > 0;
        
        // Also check native permission status
        const { checkNativePermission } = await import("@/lib/nativePush");
        const permission = await checkNativePermission();
        setPushEnabled(permission === 'granted' && hasToken);
      } catch (err) {
        console.error('[NativePushCard] Error checking status:', err);
      } finally {
        setLoading(false);
      }
    };
    
    checkStatus();
  }, [userId]);

  const handlePreferenceChange = async (key: keyof PushPreferences, value: boolean) => {
    setPrefsLoading(true);
    const updatedPrefs = { ...preferences, [key]: value };
    setPreferences(updatedPrefs);
    
    try {
      const { error } = await supabase
        .from("notification_preferences")
        .upsert({
          user_id: userId,
          [key]: value,
          updated_at: new Date().toISOString(),
        } as never, { onConflict: "user_id" });
      
      if (error) {
        console.error('[NativePushCard] Error updating preference:', error);
        // Revert on error
        setPreferences(preferences);
        toast.error("Failed to update preference");
      }
    } catch (err) {
      console.error('[NativePushCard] Error updating preference:', err);
      setPreferences(preferences);
      toast.error("Failed to update preference");
    } finally {
      setPrefsLoading(false);
    }
  };

  const handleEnablePush = async () => {
    setEnabling(true);
    
    try {
      const { initializeNativePush } = await import("@/lib/nativePush");
      const result = await initializeNativePush(userId);
      
      if (result.success) {
        setPushEnabled(true);
        toast.success("Push notifications enabled!", {
          description: "You'll now receive notifications on this device."
        });
      } else {
        toast.error("Failed to enable notifications", {
          description: result.error || "Please check your device settings."
        });
      }
    } catch (err) {
      console.error('[NativePushCard] Error enabling push:', err);
      toast.error("Error enabling notifications");
    } finally {
      setEnabling(false);
    }
  };

  const handleDisablePush = async () => {
    setEnabling(true);
    
    try {
      const { unregisterNativePush } = await import("@/lib/nativePush");
      await unregisterNativePush(userId);
      setPushEnabled(false);
      toast.success("Push notifications disabled");
    } catch (err) {
      console.error('[NativePushCard] Error disabling push:', err);
      toast.error("Error disabling notifications");
    } finally {
      setEnabling(false);
    }
  };

  const handleTestPush = async () => {
    setTestingPush(true);
    toast.info(`Test notification scheduled`, {
      description: `Notification will arrive in ${testPushDelay} seconds. Lock your phone now!`
    });
    
    try {
      const { data, error } = await supabase.functions.invoke('test-push-notification', {
        body: { delay: testPushDelay }
      });
      
      if (error) {
        console.error('Test push error:', error);
        toast.error("Test failed", {
          description: error.message || "Could not send test notification"
        });
      } else {
        console.log('Test push result:', data);
        toast.success("Test sent!", {
          description: "If push is working, you should receive a notification."
        });
      }
    } catch (err) {
      console.error('Test push exception:', err);
      toast.error("Test failed", {
        description: err instanceof Error ? err.message : "Unknown error"
      });
    }
    setTestingPush(false);
  };

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Push Notifications
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center py-8">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bell className="h-5 w-5" />
          Push Notifications
        </CardTitle>
        <CardDescription>
          Receive notifications on this device
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Master toggle */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {pushEnabled ? (
              <CheckCircle className="h-5 w-5 text-emerald-500" />
            ) : (
              <XCircle className="h-5 w-5 text-muted-foreground" />
            )}
            <div className="space-y-0.5">
              <Label>Push Notifications</Label>
              <p className="text-xs text-muted-foreground">
                {pushEnabled 
                  ? "Notifications are enabled on this device" 
                  : "Enable to receive alerts and updates"}
              </p>
            </div>
          </div>
          <Switch
            checked={pushEnabled}
            onCheckedChange={(checked) => {
              if (checked) {
                handleEnablePush();
              } else {
                handleDisablePush();
              }
            }}
            disabled={enabling}
          />
        </div>

        {/* Enable button for first-time setup */}
        {!pushEnabled && (
          <Button
            className="w-full"
            onClick={handleEnablePush}
            disabled={enabling}
          >
            {enabling ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Enabling...
              </>
            ) : (
              <>
                <Bell className="h-4 w-4 mr-2" />
                Enable Push Notifications
              </>
            )}
          </Button>
        )}

        {/* Granular push preferences - only show when enabled */}
        {pushEnabled && (
          <>
            <Separator />
            <div className="space-y-1">
              <p className="text-sm font-medium">Notification Types</p>
              <p className="text-xs text-muted-foreground">
                Choose which types of push notifications you receive
              </p>
            </div>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <MessageSquare className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-messages">Messages</Label>
                    <p className="text-xs text-muted-foreground">
                      Direct messages & chat notifications
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-messages"
                  checked={preferences.messages_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("messages_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Calendar className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-events">Events & Reminders</Label>
                    <p className="text-xs text-muted-foreground">
                      Event invites, reminders & duty assignments
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-events"
                  checked={preferences.events_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("events_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Image className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-media">Media</Label>
                    <p className="text-xs text-muted-foreground">
                      Photo uploads & comments
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-media"
                  checked={preferences.media_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("media_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Users className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-membership">Membership</Label>
                    <p className="text-xs text-muted-foreground">
                      Team invites & join confirmations
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-membership"
                  checked={preferences.membership_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("membership_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Settings className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-admin">Account & Admin</Label>
                    <p className="text-xs text-muted-foreground">
                      System alerts & important updates
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-admin"
                  checked={preferences.admin_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("admin_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <LayoutGrid className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-pitch-board">Pitch Board</Label>
                    <p className="text-xs text-muted-foreground">
                      Substitution alerts & game updates
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-pitch-board"
                  checked={preferences.pitch_board_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("pitch_board_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Gift className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-rewards">Rewards</Label>
                    <p className="text-xs text-muted-foreground">
                      Reward redemptions & point updates
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-rewards"
                  checked={preferences.rewards_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("rewards_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-muted-foreground" />
                  <div>
                    <Label htmlFor="push-pom">Game Stats & Player of Match</Label>
                    <p className="text-xs text-muted-foreground">
                      Player stats reports & POM awards
                    </p>
                  </div>
                </div>
                <Switch
                  id="push-pom"
                  checked={preferences.pom_enabled}
                  onCheckedChange={(v) => handlePreferenceChange("pom_enabled", v)}
                  disabled={prefsLoading}
                />
              </div>
            </div>

            <Separator />

            {/* Test Push Button */}
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
                  {testingPush ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  {testingPush ? `Sending...` : 'Test Push'}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Tap the button, then lock your phone. Notification arrives after the delay.
              </p>
            </div>
          </>
        )}

        {/* Native app indicator */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted/50 p-3 rounded-md">
          <Smartphone className="h-4 w-4" />
          <span>Using native push notifications via Firebase Cloud Messaging</span>
        </div>
      </CardContent>
    </Card>
  );
}
