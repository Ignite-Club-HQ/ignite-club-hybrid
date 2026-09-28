import { useState, useEffect } from "react";
import { ArrowLeft, CreditCard, CheckCircle2, XCircle, Eye, EyeOff, Shield } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useAuth } from "@/hooks/useAuth";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

interface StripeConfigStatus {
  configured: boolean;
  isEnabled: boolean;
  publishableKey: string | null;
  hasSecretKey: boolean;
}

export default function AppStripeSettingsPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Shield className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Application payment configuration is unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Secret and publishable key management remains outside canister and frontend state. No configuration was accessed.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseAppStripeSettingsPage />;
}

function SupabaseAppStripeSettingsPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  
  // Form state - secret key is write-only, never displayed
  const [secretKey, setSecretKey] = useState("");
  const [publishableKey, setPublishableKey] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [showSecretKey, setShowSecretKey] = useState(false);

  // Check if user is app admin
  const { data: isAppAdmin, isLoading: isCheckingAdmin } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user!.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user,
  });

  // Fetch Stripe config status via secure edge function
  const { data: stripeConfig, isLoading } = useQuery<StripeConfigStatus | null>({
    queryKey: ['app-stripe-config-status'],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-stripe-config', {
        body: { action: 'get', configType: 'app' }
      });
      if (error) throw error;
      return data;
    },
    enabled: isAppAdmin === true,
  });

  // Populate form with existing publishable key (secret key is never returned)
  useEffect(() => {
    if (stripeConfig) {
      setPublishableKey(stripeConfig.publishableKey || "");
      setIsEnabled(stripeConfig.isEnabled);
      // Secret key is NEVER returned from the server - always start empty
      setSecretKey("");
    }
  }, [stripeConfig]);

  // Save mutation via secure edge function
  const saveMutation = useMutation({
    mutationFn: async () => {
      // If updating existing config and no new secret key provided, error
      if (stripeConfig?.configured && !secretKey) {
        throw new Error("Please enter a new secret key to update the configuration");
      }
      
      const { data, error } = await supabase.functions.invoke('manage-stripe-config', {
        body: {
          action: 'save',
          configType: 'app',
          secretKey: secretKey.trim(),
          publishableKey: publishableKey.trim(),
          isEnabled,
        }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-stripe-config-status'] });
      setSecretKey(""); // Clear secret key after save
      toast({ title: "Stripe configuration saved successfully" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save configuration", description: error.message, variant: "destructive" });
    }
  });

  // Delete mutation via secure edge function
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('manage-stripe-config', {
        body: { action: 'delete', configType: 'app' }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['app-stripe-config-status'] });
      setSecretKey("");
      setPublishableKey("");
      setIsEnabled(true);
      toast({ title: "Stripe configuration removed" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to remove configuration", description: error.message, variant: "destructive" });
    }
  });

  const handleSave = () => {
    if (!secretKey.trim() && !stripeConfig?.configured) {
      toast({ title: "Please enter a Stripe secret key", variant: "destructive" });
      return;
    }
    if (!publishableKey.trim()) {
      toast({ title: "Please enter a Stripe publishable key", variant: "destructive" });
      return;
    }
    if (secretKey && !secretKey.startsWith('sk_')) {
      toast({ title: "Invalid secret key format", description: "Secret key should start with 'sk_'", variant: "destructive" });
      return;
    }
    if (!publishableKey.startsWith('pk_')) {
      toast({ title: "Invalid publishable key format", description: "Publishable key should start with 'pk_'", variant: "destructive" });
      return;
    }
    saveMutation.mutate();
  };

  if (isCheckingAdmin) {
    return (
      <div className="py-6 space-y-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!isAppAdmin) {
    return (
      <div className="py-6">
        <p className="text-muted-foreground">You don't have permission to access this page.</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate("/profile")}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">App Payment Settings</h1>
          <p className="text-sm text-muted-foreground">Platform-level Stripe configuration</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CreditCard className="h-5 w-5 text-primary" />
              <CardTitle>Stripe Configuration</CardTitle>
            </div>
            {stripeConfig?.configured && (
              <div className="flex items-center gap-2">
                {stripeConfig.isEnabled ? (
                  <span className="flex items-center gap-1 text-sm text-green-600">
                    <CheckCircle2 className="h-4 w-4" /> Active
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-sm text-muted-foreground">
                    <XCircle className="h-4 w-4" /> Disabled
                  </span>
                )}
              </div>
            )}
          </div>
          <CardDescription>
            Configure Stripe API keys to receive payments for app subscriptions and premium features.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {isLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              <Alert className="border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-950">
                <Shield className="h-4 w-4 text-blue-600" />
                <AlertDescription className="text-blue-800 dark:text-blue-200">
                  <strong>Security:</strong> Your secret key is stored securely on the server and is never exposed to the browser. 
                  {stripeConfig?.configured && " Enter a new secret key only if you want to replace the existing one."}
                </AlertDescription>
              </Alert>

              <Alert>
                <AlertDescription>
                  Get your API keys from the{" "}
                  <button 
                    onClick={() => import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://reference.invalid"))}
                    className="text-primary underline font-medium cursor-pointer"
                  >
                    Stripe Dashboard
                  </button>. Use test keys (sk_test_*, pk_test_*) for testing.
                </AlertDescription>
              </Alert>

              <div className="space-y-2">
                <Label htmlFor="publishable-key">Publishable Key</Label>
                <Input
                  id="publishable-key"
                  type="text"
                  placeholder="pk_live_... or pk_test_..."
                  value={publishableKey}
                  onChange={(e) => setPublishableKey(e.target.value)}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="secret-key">
                  Secret Key {stripeConfig?.configured && <span className="text-muted-foreground font-normal">(leave empty to keep current)</span>}
                </Label>
                <div className="relative">
                  <Input
                    id="secret-key"
                    type={showSecretKey ? "text" : "password"}
                    placeholder={stripeConfig?.configured ? "Enter new secret key to replace..." : "sk_live_... or sk_test_..."}
                    value={secretKey}
                    onChange={(e) => setSecretKey(e.target.value)}
                    className="pr-10"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="absolute right-0 top-0 h-full"
                    onClick={() => setShowSecretKey(!showSecretKey)}
                  >
                    {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Your secret key is validated with Stripe before being securely stored.
                </p>
              </div>

              {stripeConfig?.configured && (
                <div className="flex items-center justify-between">
                  <Label htmlFor="enabled">Enable payments</Label>
                  <Switch
                    id="enabled"
                    checked={isEnabled}
                    onCheckedChange={setIsEnabled}
                  />
                </div>
              )}

              <div className="flex gap-3">
                <Button 
                  onClick={handleSave} 
                  disabled={saveMutation.isPending} 
                  className="flex-1"
                >
                  {saveMutation.isPending ? "Saving..." : stripeConfig?.configured ? "Update Configuration" : "Save Configuration"}
                </Button>
                {stripeConfig?.configured && (
                  <Button 
                    variant="outline" 
                    onClick={() => deleteMutation.mutate()}
                    disabled={deleteMutation.isPending}
                  >
                    {deleteMutation.isPending ? "Removing..." : "Remove"}
                  </Button>
                )}
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
