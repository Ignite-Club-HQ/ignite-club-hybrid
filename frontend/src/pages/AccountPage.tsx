import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Loader2, FileText, Shield, DatabaseBackup, Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { safeOpenUrl } from "@/lib/safeOpenUrl";
import { requireAccessToken, SessionExpiredError, SESSION_EXPIRED_MESSAGE } from "@/lib/requireAccessToken";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function AccountPage() {
  const { user, signOut } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const navigate = useNavigate();
  const { toast } = useToast();
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [exportingData, setExportingData] = useState(false);

  const handleDeleteAccount = async () => {
    if (useIcpLab) {
      toast({ title: "Account deletion is disabled in ICP lab mode" });
      return;
    }
    if (deletingAccount) return;
    setDeletingAccount(true);

    let token: string;
    try {
      token = await requireAccessToken();
    } catch (err) {
      // Missing/expired session — do NOT invoke delete-account, do NOT
      // sign the user out, keep them on the page.
      toast({
        title: "Session expired",
        description: err instanceof SessionExpiredError ? err.message : SESSION_EXPIRED_MESSAGE,
        variant: "destructive",
      });
      setDeletingAccount(false);
      return;
    }

    try {
      const response = await supabase.functions.invoke('delete-account', {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (response.error) {
        toast({
          title: "Failed to schedule account deletion",
          description: response.error.message,
          variant: "destructive",
        });
        setDeletingAccount(false);
        return;
      }

      // Only sign out after the backend confirms scheduling AND returns a
      // valid ISO deletion date. A missing/invalid date is treated as a
      // failure so we never claim success or sign the user out on a
      // malformed response.
      const rawDate = response.data?.deletionDate;
      const parsed = rawDate ? new Date(rawDate) : null;
      if (!parsed || Number.isNaN(parsed.getTime())) {
        toast({
          title: "Failed to schedule account deletion",
          description: "The server returned an invalid response. Please try again.",
          variant: "destructive",
        });
        setDeletingAccount(false);
        return;
      }

      toast({
        title: "Account scheduled for deletion",
        description: `Your account will be permanently deleted on ${parsed.toLocaleDateString()}. Log back in within 30 days to recover it.`,
      });

      await signOut();
    } catch (err) {
      toast({
        title: "Failed to schedule account deletion",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
      setDeletingAccount(false);
    }
  };

  const handleExportData = async () => {
    if (useIcpLab) {
      toast({ title: "Data export is disabled in ICP lab mode" });
      return;
    }
    if (exportingData) return;
    setExportingData(true);

    let token: string;
    try {
      token = await requireAccessToken();
    } catch (err) {
      toast({
        title: "Session expired",
        description: err instanceof SessionExpiredError ? err.message : SESSION_EXPIRED_MESSAGE,
        variant: "destructive",
      });
      setExportingData(false);
      return;
    }

    let objectUrl: string | null = null;
    try {
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/export-user-data`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        let errorMessage = 'Export failed';
        try {
          const errorData = await response.json();
          if (typeof errorData?.error === 'string') errorMessage = errorData.error;
        } catch {
          // ignore JSON parse errors
        }
        if (response.status === 401) {
          throw new SessionExpiredError();
        }
        throw new Error(errorMessage);
      }

      // Validate the response actually contains a downloadable ZIP before
      // creating a download link and reporting success.
      const contentType = response.headers.get('content-type') || '';
      const blob = await response.blob();
      const looksLikeZip =
        contentType.toLowerCase().includes('zip') || blob.type.toLowerCase().includes('zip');
      if (!looksLikeZip || blob.size === 0) {
        throw new Error('The server returned an unexpected response. Please try again.');
      }

      objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `ignite-data-export-${new Date().toISOString().split('T')[0]}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast({
        title: "Data exported",
        description: "Your data has been downloaded as a ZIP file with CSV files inside.",
      });
    } catch (err) {
      const isSessionExpired = err instanceof SessionExpiredError;
      toast({
        title: isSessionExpired ? "Session expired" : "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    } finally {
      // Always revoke any created object URL, including after failures
      // that happen after URL creation.
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setExportingData(false);
    }
  };

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-2xl font-bold">Account & Privacy</h1>
      </div>

      {/* Legal Links Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Legal
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <button 
            onClick={() => navigate("/privacy")}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors w-full text-left"
          >
            <Shield className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Privacy Policy</p>
              <p className="text-xs text-muted-foreground">How we handle your data</p>
            </div>
          </button>
          <button 
            onClick={() => navigate("/terms")}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors w-full text-left"
          >
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Terms of Service</p>
              <p className="text-xs text-muted-foreground">Usage terms and conditions</p>
            </div>
          </button>
          <button 
            onClick={() => navigate("/cancellation")}
            className="flex items-center gap-3 p-3 rounded-lg hover:bg-muted transition-colors w-full text-left"
          >
            <FileText className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">Cancellation Policy</p>
              <p className="text-xs text-muted-foreground">How to cancel your subscription</p>
            </div>
          </button>
        </CardContent>
      </Card>

      {/* Export Data Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <DatabaseBackup className="h-5 w-5" />
            Export Your Data
          </CardTitle>
          <CardDescription>
            Download a copy of all your personal data
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Export includes your profile, roles, RSVPs, uploaded photos, comments, feedback, and more.
          </p>
          <Button 
            variant="outline" 
            onClick={handleExportData}
            disabled={exportingData}
          >
            {exportingData ? (
              <>
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                Exporting...
              </>
            ) : (
              <>
                <Download className="h-4 w-4 mr-2" />
                Download My Data
              </>
            )}
          </Button>
        </CardContent>
      </Card>

      {/* Delete Account Card */}
      <Card className="border-destructive/50">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <Trash2 className="h-5 w-5" />
            Delete Account
          </CardTitle>
          <CardDescription>
            Schedule your account for deletion with a 30-day recovery period
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm space-y-2">
            <p>When you delete your account:</p>
            <ul className="list-disc list-inside text-muted-foreground space-y-1">
              <li>Your account will be scheduled for deletion in 30 days</li>
              <li>You can recover your account by logging back in within 30 days</li>
              <li>After 30 days, all your data will be permanently deleted</li>
              <li>This includes profile, roles, RSVPs, photos, and messages</li>
            </ul>
          </div>
          
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={deletingAccount}>
                {deletingAccount ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="h-4 w-4 mr-2" />
                    Delete My Account
                  </>
                )}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Are you sure?</AlertDialogTitle>
                <AlertDialogDescription>
                  Your account will be scheduled for permanent deletion. You have 30 days to recover it by logging back in.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteAccount} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Yes, delete my account
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </CardContent>
      </Card>
    </div>
  );
}
