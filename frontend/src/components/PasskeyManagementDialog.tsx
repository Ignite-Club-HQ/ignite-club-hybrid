import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Fingerprint, Smartphone, Monitor, Tablet, Trash2, Loader2, Plus, AlertCircle } from "lucide-react";
import { format } from "date-fns";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { usePasskey } from "@/hooks/usePasskey";

interface Passkey {
  id: string;
  device_type: string | null;
  created_at: string;
  last_used_at: string | null;
}

interface PasskeyManagementDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getDeviceIcon(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case 'ios':
    case 'android':
      return Smartphone;
    case 'macos':
    case 'windows':
      return Monitor;
    case 'ipad':
      return Tablet;
    default:
      return Fingerprint;
  }
}

function getDeviceName(deviceType: string | null) {
  switch (deviceType?.toLowerCase()) {
    case 'ios':
      return 'iPhone';
    case 'android':
      return 'Android Device';
    case 'macos':
      return 'Mac';
    case 'windows':
      return 'Windows PC';
    case 'ipad':
      return 'iPad';
    default:
      return 'Unknown Device';
  }
}

/**
 * Safely extract a user-facing message from an unknown error value.
 *
 * Supabase's PostgREST client commonly rejects with plain objects such as
 * `{ message: "Delete denied", code: "..." }` (not Error instances). Reading
 * only `error instanceof Error ? error.message : fallback` swallows those
 * messages and shows "Please try again." to the user.
 *
 * Rules:
 *   - Error instances → return `.message`.
 *   - Plain objects with a non-empty string `message` → return it.
 *   - Everything else (null, undefined, arrays, numbers, objects with
 *     non-string message, empty strings) → return the caller's fallback.
 *   - Never stringify unknown objects — that risks leaking stack traces,
 *     tokens or diagnostic fields into the UI.
 */
export function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    return error.message && error.message.trim() !== "" ? error.message : fallback;
  }
  if (error && typeof error === "object") {
    const msg = (error as { message?: unknown }).message;
    if (typeof msg === "string" && msg.trim() !== "") return msg;
  }
  return fallback;
}

export function PasskeyManagementDialog({ open, onOpenChange }: PasskeyManagementDialogProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { registerPasskey, removeAccount, storeCredentialsForNativeBiometric, loading: registerLoading } = usePasskey();
  const isNative = Capacitor.isNativePlatform();
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [showNativePrompt, setShowNativePrompt] = useState(false);
  const [nativePassword, setNativePassword] = useState("");
  const [nativeSaving, setNativeSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      document.body.style.pointerEvents = "";
      setConfirmDeleteId(null);
      setShowNativePrompt(false);
      setNativePassword("");
    }

    return () => {
      document.body.style.pointerEvents = "";
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      document.body.style.pointerEvents = "";
    }
  }, [open, confirmDeleteId, showNativePrompt]);



  const {
    data: passkeys,
    isLoading,
    isError: passkeysErrored,
    refetch: refetchPasskeys,
  } = useQuery({
    queryKey: ["user-passkeys", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_passkeys")
        .select("id, device_type, created_at, last_used_at")
        .eq("user_id", user!.id)
        .order("created_at", { ascending: false });

      if (error) throw error;
      return data as Passkey[];
    },
    enabled: !!user && open,
  });

  const handleDelete = async (passkeyId: string) => {
    // Close the confirmation dialog first to prevent UI freeze
    setConfirmDeleteId(null);
    setDeletingId(passkeyId);
    
    try {
      const { error } = await supabase
        .from("user_passkeys")
        .delete()
        .eq("id", passkeyId)
        .eq("user_id", user!.id);

      if (error) throw error;

      // Check if this was the last passkey for this user
      const remainingPasskeys = passkeys?.filter(p => p.id !== passkeyId) || [];
      if (remainingPasskeys.length === 0 && user?.email) {
        // Remove from local storage if no passkeys left
        removeAccount(user.email);
      }

      toast({
        title: "Passkey removed",
        description: "The passkey has been deleted from your account.",
      });

      await queryClient.invalidateQueries({ queryKey: ["user-passkeys"] });
    } catch (error: unknown) {
      toast({
        title: "Failed to remove passkey",
        description: getErrorMessage(error, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setDeletingId(null);
    }
  };

  const handleAddPasskey = async () => {
    if (isNative) {
      setNativePassword("");
      setConfirmDeleteId(null);
      setShowNativePrompt(true);
      return;
    }
    const result = await registerPasskey();
    if (result.success) {
      toast({
        title: "Passkey added!",
        description: "You can now sign in with this device's biometrics.",
      });
      queryClient.invalidateQueries({ queryKey: ["user-passkeys"] });
    } else {
      toast({
        title: "Failed to add passkey",
        description: result.error || "Please try again.",
        variant: "destructive",
      });
    }
  };

  const handleNativeSave = async () => {
    if (!user?.email || !nativePassword) return;
    setNativeSaving(true);
    try {
      // Verify password before storing
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: user.email,
        password: nativePassword,
      });
      if (signInError) throw new Error("Incorrect password");

      const result = await storeCredentialsForNativeBiometric(user.email, nativePassword);
      if (!result.success) throw new Error(result.error || "Failed to enable biometrics");

      toast({
        title: "Biometric login enabled",
        description: "You can now sign in with your device's biometrics.",
      });
      setShowNativePrompt(false);
      setNativePassword("");
      await queryClient.invalidateQueries({ queryKey: ["user-passkeys"] });
    } catch (err: unknown) {
      toast({
        title: "Failed to enable biometrics",
        description: getErrorMessage(err, "Please try again."),
        variant: "destructive",
      });
    } finally {
      setNativeSaving(false);
    }
  };


  const handleConfirmDelete = () => {
    if (confirmDeleteId) {
      handleDelete(confirmDeleteId);
    }
  };

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      setConfirmDeleteId(null);
      setShowNativePrompt(false);
      setNativePassword("");
      document.body.style.pointerEvents = "";
    }
    onOpenChange(nextOpen);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={handleDialogOpenChange} modal={false}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Fingerprint className="h-5 w-5" />
              {showNativePrompt ? "Enable biometric login" : "Manage Passkeys"}
            </DialogTitle>
            <DialogDescription>
              {showNativePrompt
                ? "Enter your password to securely store credentials for biometric sign-in on this device."
                : "View and manage your registered biometric login devices."}
            </DialogDescription>
          </DialogHeader>

          {showNativePrompt ? (
            <div className="space-y-3 mt-2">
              <Label htmlFor="passkey-native-password">Password</Label>
              <Input
                id="passkey-native-password"
                type="password"
                autoComplete="current-password"
                value={nativePassword}
                onChange={(e) => setNativePassword(e.target.value)}
                disabled={nativeSaving}
              />
              <div className="flex gap-2 justify-end pt-2">
                <Button variant="ghost" onClick={() => { setShowNativePrompt(false); setNativePassword(""); }} disabled={nativeSaving}>
                  Cancel
                </Button>
                <Button onClick={handleNativeSave} disabled={nativeSaving || !nativePassword}>
                  {nativeSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Enable"}
                </Button>
              </div>
            </div>
          ) : confirmDeleteId ? (
            <div className="space-y-4 mt-4">
              <div className="rounded-md border border-destructive/30 bg-destructive/5 p-4">
                <p className="font-medium mb-1">Remove Passkey?</p>
                <p className="text-sm text-muted-foreground">
                  This will remove the passkey from your account. You won't be able to use this device's biometrics to sign in until you add it again.
                </p>
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" onClick={() => setConfirmDeleteId(null)} disabled={!!deletingId}>
                  Cancel
                </Button>
                <Button
                  onClick={handleConfirmDelete}
                  disabled={!!deletingId}
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                >
                  {deletingId ? <Loader2 className="h-4 w-4 animate-spin" /> : "Remove"}
                </Button>
              </div>
            </div>
          ) : (
          <div className="space-y-4 mt-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : passkeysErrored ? (
              // Query failed — DO NOT claim the user has no passkeys. Show a
              // neutral error state with a Retry that re-runs the same query.
              // Hide "Add New Passkey" so nothing implies the current list is
              // authoritative.
              <div className="text-center py-8" role="alert">
                <AlertCircle className="h-12 w-12 mx-auto text-destructive mb-3" />
                <p className="font-medium">Unable to load your passkeys.</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Check your connection and try again.
                </p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => refetchPasskeys()}
                >
                  Retry
                </Button>
              </div>
            ) : passkeys && passkeys.length > 0 ? (
              <div className="space-y-3">
                {passkeys.map((passkey) => {
                  const DeviceIcon = getDeviceIcon(passkey.device_type);
                  const isDeleting = deletingId === passkey.id;
                  
                  return (
                    <Card key={passkey.id} className="relative">
                      <CardContent className="p-4">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center">
                              <DeviceIcon className="h-5 w-5 text-muted-foreground" />
                            </div>
                            <div>
                              <p className="font-medium">
                                {getDeviceName(passkey.device_type)}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Added {format(new Date(passkey.created_at), "MMM d, yyyy")}
                              </p>
                              {passkey.last_used_at && (
                                <p className="text-xs text-muted-foreground">
                                  Last used {format(new Date(passkey.last_used_at), "MMM d, yyyy")}
                                </p>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            {passkey.device_type && (
                              <Badge variant="secondary" className="text-xs">
                                {passkey.device_type}
                              </Badge>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-destructive hover:text-destructive hover:bg-destructive/10"
                              onClick={() => setConfirmDeleteId(passkey.id)}
                              disabled={isDeleting}
                            >
                              {isDeleting ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <div className="text-center py-8">
                <Fingerprint className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
                <p className="text-muted-foreground">
                  No passkeys registered yet.
                </p>
              </div>
            )}

            {/* Only offer "Add New Passkey" when we successfully know the
                current list. On error, the user retries first. */}
            {!passkeysErrored && (
              <Button
                onClick={handleAddPasskey}
                disabled={registerLoading}
                className="w-full"
              >
                {registerLoading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Setting up...
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Add New Passkey
                  </>
                )}
              </Button>
            )}
          </div>
          )}
        </DialogContent>
      </Dialog>
    </>

  );
}
