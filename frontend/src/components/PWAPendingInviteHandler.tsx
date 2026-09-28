import { useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { setInviteFlowContext, getInviteFlowContext } from "@/components/InviteFlowProgress";

/**
 * This component checks if there's a pending invite stored from a PWA installation.
 * When a user installs the PWA from an invite link, we store the invite URL in localStorage.
 * When they open the PWA (in standalone mode), this component redirects them to that invite.
 */
export function PWAPendingInviteHandler() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Only run in standalone mode (PWA)
    const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
    if (!isStandalone) return;

    // Check for pending invite
    const pendingInvite = localStorage.getItem("pwa_pending_invite");
    if (!pendingInvite) return;

    // Only redirect if we're on the home page or root
    // Don't redirect if already on the invite page or auth page
    if (location.pathname === "/" || location.pathname === "") {
      console.log("[PWA] Resuming pending invite:", pendingInvite);
      
      // Get existing invite flow context (already in localStorage)
      const existingContext = getInviteFlowContext();
      
      // Clear the pending invite so we don't redirect again
      localStorage.removeItem("pwa_pending_invite");
      
      // Only proceed if the invite flow context is still active
      // This prevents redirecting to stale/used invite links
      if (!existingContext?.active) {
        console.log("[PWA] Invite flow context is not active, skipping redirect");
        return;
      }
      
      // Set auto-join flag so after auth they join automatically
      try {
        sessionStorage.setItem("autoJoinAfterAuth", "true");
      } catch {
        /* storage blocked — the URL carries the intent */
      }

      // Update invite flow context to continue from auth step (post-install)
      // Preserve existing context data but update the step
      setInviteFlowContext({
        ...existingContext,
        active: true,
        inviteToken: pendingInvite.split("?")[0].split("/").pop() || undefined,
        currentStep: "auth", // Resume at auth step since install is complete
      });

      // The signup intent travels in the URL — sessionStorage is unreliable in
      // restricted webviews and raced with AuthPage's mount cleanup.
      const [base, query = ""] = pendingInvite.split("?");
      const params = new URLSearchParams(query);
      if (!params.has("mode")) params.set("mode", "signup");
      const destination = `${base}?${params.toString()}`;

      navigate(destination, { replace: true });

    }
  }, [navigate, location.pathname]);

  return null;
}
