import { useCallback, useEffect, useState } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { resolveDriveTitlesForClub } from "@/features/vault/driveTitleResolution";
import { invalidateVaultCache } from "./vaultQueryKeys";
import { createVaultLinkFile } from "./vaultMutationRepository";
import type { FolderView } from "./useVaultExport";

export type VaultFunctionsInvoke = (
  name: string,
  options: { body: Record<string, unknown> },
) => Promise<{ data: any; error: any }>;

export interface UseVaultDriveLinkWorkflowOptions {
  currentView: FolderView;
  getCurrentFolderId: () => string | null;
  userId: string | undefined;
  queryClient: QueryClient;
  /**
   * Injected rather than imported directly so this hook stays free of a
   * direct Supabase client import — the page (which already imports the
   * client for its own queries) supplies `supabase.functions.invoke` here.
   */
  invokeFunction: VaultFunctionsInvoke;
}

/**
 * Owns Vault's Add Link / Google Drive import/link/title-resolution cluster:
 * the Add Link, Google Drive import, and Link Drive Folder dialog open
 * state; the Drive-title-resolution loading flag and handler; the OAuth
 * callback effects that process a saved error or exchange a saved
 * authorization code (routing to either the pending folder-link flow or the
 * import flow, with each flow's own session-storage token keys); and the
 * add-link mutation.
 *
 * `currentView` stays page-owned (it is also driven by URL/query-param deep
 * links and the root club/team/mini-league picker) — this hook receives it
 * as a readonly input instead of owning it, matching the contract used by
 * the other extracted Vault workflow hooks.
 */
export function useVaultDriveLinkWorkflow({
  currentView,
  getCurrentFolderId,
  userId,
  queryClient,
  invokeFunction,
}: UseVaultDriveLinkWorkflowOptions) {
  const [addLinkDialogOpen, setAddLinkDialogOpen] = useState(false);
  const [googleDriveImportOpen, setGoogleDriveImportOpen] = useState(false);
  const [linkDriveFolderOpen, setLinkDriveFolderOpen] = useState(false);
  const [resolvingDriveTitles, setResolvingDriveTitles] = useState(false);

  const handleResolveDriveTitles = useCallback(async () => {
    const clubId = currentView.type !== "root" ? currentView.clubId : undefined;
    if (!clubId) return;
    setResolvingDriveTitles(true);
    const toastId = toast.loading("Fetching real Google Drive titles…");
    try {
      const summary = await resolveDriveTitlesForClub(clubId, invokeFunction);
      if (!summary || summary.scanned === 0) {
        toast.success("No Google files needed renaming.", { id: toastId });
      } else {
        const parts: string[] = [`${summary.updated} renamed`];
        if (summary.unresolved > 0) parts.push(`${summary.unresolved} unresolved`);
        if (summary.errors > 0) parts.push(`${summary.errors} errors`);
        toast.success(parts.join(" · "), {
          id: toastId,
          description:
            summary.unresolved > 0 && !summary.hasOAuth
              ? "Tip: link a Google Drive folder so private files can be renamed too."
              : undefined,
        });
        invalidateVaultCache(queryClient, ["files"]);
      }
    } catch (err: any) {
      console.error("resolve-drive-titles failed", err);
      toast.error("Couldn't fetch Drive titles", { id: toastId, description: err?.message });
    } finally {
      setResolvingDriveTitles(false);
    }
  }, [currentView, queryClient, invokeFunction]);

  // Handle Google OAuth callback from redirect
  // The OAuth code is now captured in App.tsx before router init
  // This effect just processes any saved errors
  useEffect(() => {
    const savedError = sessionStorage.getItem('googleDriveOAuthError');

    if (savedError) {
      console.error("[GoogleDrive OAuth] Error from Google:", savedError);
      toast.error("Google authentication was cancelled or failed");
      sessionStorage.removeItem('googleDriveOAuthError');
      sessionStorage.removeItem('googleDriveImportPending');
    }
  }, []);

  // Process saved OAuth code
  useEffect(() => {
    const savedCode = sessionStorage.getItem('googleDriveOAuthCode');

    if (savedCode) {
      console.log("[GoogleDrive OAuth] Processing saved code");
      sessionStorage.removeItem('googleDriveOAuthCode');

      const exchangeCode = async () => {
        try {
          const isNative = typeof window !== 'undefined' && !!(window as any).Capacitor?.isNativePlatform?.();
          const redirectUri = isNative ? 'https://reference.invalid' : `${window.location.origin}/vault`;
          console.log("[GoogleDrive OAuth] Exchanging code with redirectUri:", redirectUri);

          const { data, error: exchangeError } = await invokeFunction('google-drive-import?action=exchange-code', {
            body: { code: savedCode, redirectUri },
          });

          if (exchangeError || data?.error) {
            console.error("[GoogleDrive OAuth] Token exchange failed:", data?.error || exchangeError);
            toast.error("Failed to connect to Google Drive");
            return;
          }

          console.log("[GoogleDrive OAuth] Token exchange successful");

          // Determine flow: "link a folder" pending takes precedence over "import"
          const linkPending = sessionStorage.getItem('driveLinkPending');
          if (linkPending) {
            sessionStorage.removeItem('driveLinkPending');
            sessionStorage.setItem('driveLinkAccessToken', data.accessToken);
            if (data.refreshToken) sessionStorage.setItem('driveLinkRefreshToken', data.refreshToken);
            if (data.googleEmail) sessionStorage.setItem('driveLinkGoogleEmail', data.googleEmail);
            setLinkDriveFolderOpen(true);
          } else {
            sessionStorage.setItem('googleDriveAccessToken', data.accessToken);
            // Also stash refresh token + google email so the import dialog can
            // optionally create a sync link for any folder the user imports.
            if (data.refreshToken) sessionStorage.setItem('googleDriveRefreshToken', data.refreshToken);
            if (data.googleEmail) sessionStorage.setItem('googleDriveGoogleEmail', data.googleEmail);
            setGoogleDriveImportOpen(true);
          }
        } catch (err) {
          console.error("[GoogleDrive OAuth] Exception:", err);
          toast.error("Failed to connect to Google Drive");
        } finally {
          sessionStorage.removeItem('googleDriveImportPending');
        }
      };

      exchangeCode();
    }
  }, []); // Only run on mount after the first effect

  const addLinkMutation = useMutation({
    mutationFn: async ({ url, name }: { url: string; name: string }) => {
      await createVaultLinkFile({
        url,
        name,
        userId: userId!,
        folderId: getCurrentFolderId(),
        view: currentView,
      });
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["files"]);
      setAddLinkDialogOpen(false);
      toast.success("Link added successfully!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to add link");
    },
  });

  // Shared by the Drive import and Drive folder-link dialogs: both refresh
  // the same two caches when they finish changing Vault's file/folder set.
  const handleDriveChanged = useCallback(() => {
    invalidateVaultCache(queryClient, ["files"]);
    queryClient.invalidateQueries({ queryKey: ["vault-folders"] });
  }, [queryClient]);

  return {
    addLinkDialogOpen,
    setAddLinkDialogOpen,
    googleDriveImportOpen,
    setGoogleDriveImportOpen,
    linkDriveFolderOpen,
    setLinkDriveFolderOpen,
    resolvingDriveTitles,
    handleResolveDriveTitles,
    addLinkMutation,
    handleDriveChanged,
  };
}
