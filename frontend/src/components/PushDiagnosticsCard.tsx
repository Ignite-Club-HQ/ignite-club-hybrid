import { useState, useEffect } from "react";
import { 
  CheckCircle, 
  XCircle, 
  AlertTriangle, 
  RefreshCw, 
  Smartphone, 
  Monitor,
  Globe,
  WifiOff,
  Bell,
  BellOff,
  Info,
  ChevronDown,
  ChevronUp
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useToast } from "@/hooks/use-toast";
import {
  getPushDiagnostics,
  getPlatformInfo,
  clearLogs,
  type PushDiagnostics,
  type PlatformInfo,
} from "@/lib/pushReliability";
import { 
  subscribeToPushNotifications, 
  resetPushNotifications,
  forceUnlockPushSubscription,
} from "@/lib/pushNotifications";

interface PushDiagnosticsCardProps {
  userId: string;
  pushEnabled: boolean;
  onPushStatusChange: (enabled: boolean) => void;
}

const PLATFORM_ICONS: Record<string, React.ReactNode> = {
  'ios-pwa': <Smartphone className="h-4 w-4" />,
  'ios-safari': <Smartphone className="h-4 w-4" />,
  'android-chrome': <Smartphone className="h-4 w-4" />,
  'android-firefox': <Smartphone className="h-4 w-4" />,
  'android-other': <Smartphone className="h-4 w-4" />,
  'desktop-chrome': <Monitor className="h-4 w-4" />,
  'desktop-firefox': <Monitor className="h-4 w-4" />,
  'desktop-safari': <Monitor className="h-4 w-4" />,
  'desktop-edge': <Monitor className="h-4 w-4" />,
  'desktop-other': <Monitor className="h-4 w-4" />,
  'unknown': <Globe className="h-4 w-4" />,
};

const RELIABILITY_COLORS: Record<number, string> = {
  1: 'text-red-500',
  2: 'text-orange-500',
  3: 'text-yellow-500',
  4: 'text-green-400',
  5: 'text-green-500',
};

// Detect Chrome on Android
function isChromeAndroid(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /android/i.test(navigator.userAgent) && /chrome/i.test(navigator.userAgent);
}

export function PushDiagnosticsCard({ userId, pushEnabled, onPushStatusChange }: PushDiagnosticsCardProps) {
  const { toast } = useToast();
  const [diagnostics, setDiagnostics] = useState<PushDiagnostics | null>(null);
  const [platformInfo, setPlatformInfo] = useState<PlatformInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [fixing, setFixing] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [showDetails, setShowDetails] = useState(false);

  const loadDiagnostics = async () => {
    setLoading(true);
    try {
      const [diag, platform] = await Promise.all([
        getPushDiagnostics(),
        Promise.resolve(getPlatformInfo()),
      ]);
      setDiagnostics(diag);
      setPlatformInfo(platform);
    } catch (e) {
      console.error('Failed to load diagnostics:', e);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadDiagnostics();
  }, [pushEnabled]);

  const getHealthStatus = () => {
    if (!diagnostics) return { status: 'unknown', color: 'text-muted-foreground', icon: Info };
    
    if (!diagnostics.hasServiceWorker || !diagnostics.hasPushManager) {
      return { status: 'unsupported', color: 'text-red-500', icon: XCircle };
    }
    
    if (diagnostics.permission === 'denied') {
      return { status: 'blocked', color: 'text-red-500', icon: BellOff };
    }
    
    if (diagnostics.permissionWasRevoked) {
      return { status: 'revoked', color: 'text-orange-500', icon: AlertTriangle };
    }
    
    // Check for failures BEFORE checking if disabled - user needs Reset button to fix stuck state
    const hasFailures = diagnostics.freshness?.consecutiveFailures && diagnostics.freshness.consecutiveFailures > 0;
    
    if (hasFailures) {
      return { status: 'degraded', color: 'text-yellow-500', icon: AlertTriangle };
    }
    
    if (!pushEnabled) {
      return { status: 'disabled', color: 'text-muted-foreground', icon: Bell };
    }
    
    if (diagnostics.offlineQueue.length > 0) {
      return { status: 'pending', color: 'text-yellow-500', icon: WifiOff };
    }
    
    return { status: 'healthy', color: 'text-green-500', icon: CheckCircle };
  };

  const handleFix = async () => {
    setFixing(true);
    try {
      // Force clear any stale lock before attempting to fix
      forceUnlockPushSubscription();
      
      const result = await subscribeToPushNotifications(userId);
      if (result.success) {
        toast({ title: "Push notifications fixed!", description: "Subscription restored successfully" });
        onPushStatusChange(true);
        await loadDiagnostics();
      } else {
        toast({ title: "Fix failed", description: result.error, variant: "destructive" });
      }
    } catch (e) {
      toast({ title: "Error", description: String(e), variant: "destructive" });
    }
    setFixing(false);
  };

  const handleReset = async () => {
    setResetting(true);
    try {
      // Force clear lock before reset
      forceUnlockPushSubscription();
      
      // For Chrome Android, recommend reload after reset for cleaner state
      const shouldReload = isChromeAndroid();
      await resetPushNotifications(userId, shouldReload);
      
      if (!shouldReload) {
        toast({ title: "Push state reset", description: "Now try enabling notifications again" });
        onPushStatusChange(false);
        clearLogs();
        await loadDiagnostics();
      }
      // If shouldReload is true, page will reload automatically
    } catch (e) {
      toast({ title: "Reset failed", description: String(e), variant: "destructive" });
    }
    setResetting(false);
  };

  const health = getHealthStatus();
  const HealthIcon = health.icon;

  const getStatusMessage = () => {
    const chromeAndroid = isChromeAndroid();
    
    switch (health.status) {
      case 'unsupported':
        return 'Push notifications are not supported on this browser/device.';
      case 'blocked':
        return 'Notifications are blocked. Enable in browser settings (click the lock icon).';
      case 'revoked':
        return 'Permission was revoked. Click "Fix" to re-enable.';
      case 'disabled':
        return 'Push notifications are disabled. Enable them above.';
      case 'degraded':
        if (chromeAndroid) {
          return `Chrome Android issue detected. Click "Reset" to fix, then re-enable notifications.`;
        }
        return `Recent delivery issues detected (${diagnostics?.freshness?.consecutiveFailures} failures). Click "Fix" to refresh.`;
      case 'pending':
        return `${diagnostics?.offlineQueue.length} operation(s) queued. Will sync when online.`;
      case 'healthy':
        return 'Push notifications are working correctly.';
      default:
        return 'Checking status...';
    }
  };

  const renderPlatformBadge = () => {
    if (!platformInfo) return null;
    
    return (
      <div className="flex items-center gap-2">
        {PLATFORM_ICONS[platformInfo.platform]}
        <span className="text-sm capitalize">{platformInfo.platform.replace(/-/g, ' ')}</span>
        <Badge variant="outline" className={RELIABILITY_COLORS[platformInfo.reliabilityRating]}>
          {platformInfo.reliabilityRating}/5 reliability
        </Badge>
      </div>
    );
  };

  if (loading) {
    return (
      <Card className="border-dashed">
        <CardContent className="py-4">
          <div className="flex items-center gap-2 text-muted-foreground">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span>Checking push notification health...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={`border-l-4 ${
      health.status === 'healthy' ? 'border-l-green-500' :
      health.status === 'degraded' || health.status === 'pending' ? 'border-l-yellow-500' :
      health.status === 'disabled' ? 'border-l-muted' :
      'border-l-red-500'
    }`}>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <HealthIcon className={`h-5 w-5 ${health.color}`} />
            <CardTitle className="text-base">Push Diagnostics</CardTitle>
          </div>
          <Button variant="ghost" size="sm" onClick={loadDiagnostics}>
            <RefreshCw className="h-4 w-4" />
          </Button>
        </div>
        <CardDescription>{getStatusMessage()}</CardDescription>
      </CardHeader>
      
      <CardContent className="space-y-4">
        {/* Platform Info */}
        {renderPlatformBadge()}
        
        {/* Platform Notes */}
        {platformInfo && platformInfo.notes && (
          <p className="text-xs text-muted-foreground">{platformInfo.notes}</p>
        )}

        {/* Quick Actions */}
        {(health.status === 'degraded' || health.status === 'revoked' || health.status === 'pending') && (
          <div className="flex gap-2">
            <Button 
              size="sm" 
              onClick={handleFix}
              disabled={fixing}
            >
              {fixing ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Fix Now
            </Button>
            <Button 
              size="sm" 
              variant="outline"
              onClick={handleReset}
              disabled={resetting}
            >
              {resetting ? <RefreshCw className="h-4 w-4 mr-2 animate-spin" /> : null}
              Reset
            </Button>
          </div>
        )}

        {/* Detailed Info Collapsible */}
        <Collapsible open={showDetails} onOpenChange={setShowDetails}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="w-full justify-between">
              <span>Technical Details</span>
              {showDetails ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-3 pt-2">
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted-foreground">Service Worker:</span>
                <span className={`ml-2 ${diagnostics?.hasServiceWorker ? 'text-green-500' : 'text-red-500'}`}>
                  {diagnostics?.hasServiceWorker ? '✓' : '✗'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Push Manager:</span>
                <span className={`ml-2 ${diagnostics?.hasPushManager ? 'text-green-500' : 'text-red-500'}`}>
                  {diagnostics?.hasPushManager ? '✓' : '✗'}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Permission:</span>
                <span className={`ml-2 ${
                  diagnostics?.permission === 'granted' ? 'text-green-500' :
                  diagnostics?.permission === 'denied' ? 'text-red-500' : 'text-yellow-500'
                }`}>
                  {diagnostics?.permission}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Standalone:</span>
                <span className={`ml-2 ${diagnostics?.isStandalone ? 'text-green-500' : 'text-muted-foreground'}`}>
                  {diagnostics?.isStandalone ? 'Yes (PWA)' : 'No'}
                </span>
              </div>
            </div>

            {diagnostics?.freshness && (
              <div className="text-sm space-y-1">
                <p className="text-muted-foreground">Last validated: {
                  diagnostics.freshness.lastValidated 
                    ? new Date(diagnostics.freshness.lastValidated).toLocaleString()
                    : 'Never'
                }</p>
                {diagnostics.freshness.consecutiveFailures > 0 && (
                  <p className="text-yellow-500">
                    Consecutive failures: {diagnostics.freshness.consecutiveFailures}
                  </p>
                )}
              </div>
            )}

            {/* Recent Logs */}
            <Collapsible open={showLogs} onOpenChange={setShowLogs}>
              <CollapsibleTrigger asChild>
                <Button variant="ghost" size="sm" className="w-full justify-between">
                  <span>Recent Logs ({diagnostics?.recentLogs.length || 0})</span>
                  {showLogs ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                {diagnostics?.recentLogs && diagnostics.recentLogs.length > 0 ? (
                  <div className="max-h-48 overflow-y-auto space-y-1 text-xs font-mono bg-muted/50 rounded p-2">
                    {diagnostics.recentLogs.slice(-10).reverse().map((log, i) => (
                      <div key={i} className={`${
                        log.level === 'error' ? 'text-red-500' :
                        log.level === 'warn' ? 'text-yellow-500' : 'text-muted-foreground'
                      }`}>
                        <span className="opacity-60">{log.timestamp.split('T')[1]?.slice(0, 8)}</span>
                        {' '}{log.action}
                        {log.details && <span className="opacity-60"> {JSON.stringify(log.details)}</span>}
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground py-2">No recent logs</p>
                )}
                {diagnostics?.recentLogs && diagnostics.recentLogs.length > 0 && (
                  <Button 
                    variant="ghost" 
                    size="sm" 
                    onClick={() => {
                      clearLogs();
                      loadDiagnostics();
                    }}
                    className="mt-2"
                  >
                    Clear Logs
                  </Button>
                )}
              </CollapsibleContent>
            </Collapsible>
          </CollapsibleContent>
        </Collapsible>
      </CardContent>
    </Card>
  );
}
