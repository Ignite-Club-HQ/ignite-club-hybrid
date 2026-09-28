import { useState, useEffect, useRef, Suspense } from "react";
import { Navigate, Link, useSearchParams } from "react-router-dom";
import { Flame, Mail, Lock, Loader2, Eye, EyeOff, Fingerprint, CheckCircle2, Circle, XCircle, WifiOff } from "lucide-react";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";

import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const ForgotPasswordDialog = lazyWithRetry(() => import("@/components/ForgotPasswordDialog").then(m => ({ default: m.ForgotPasswordDialog })));
import { usePasskey, isPlatformAuthenticatorAvailable } from "@/hooks/usePasskey";
import { InviteFlowProgress, getInviteFlowContext, clearInviteFlowContext } from "@/components/InviteFlowProgress";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { resolveKeyboardCssHeight } from "@/lib/keyboardCssHeight";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";
import {
  safeSessionGet,
  safeSessionRemove,
  readRedirectParam,
  readAuthIntent,
} from "@/lib/authRedirectStorage";

/**
 * Warm the `/complete-profile` route chunk. Without this, the post-signup
 * transition renders the router's Suspense fallback (a second, differently
 * centred spinner) for a few hundred ms — the visible "flash" between tapping
 * Create Account and the profile screen appearing.
 */
let completeProfilePrefetched = false;
const prefetchCompleteProfile = () => {
  if (completeProfilePrefetched) return;
  completeProfilePrefetched = true;
  import("@/pages/CompleteProfilePage").catch(() => {
    completeProfilePrefetched = false;
  });
};


const passwordRequirements = [
  { test: (p: string) => p.length >= 8, label: "At least 8 characters" },
  { test: (p: string) => /[A-Z]/.test(p), label: "One uppercase letter" },
  { test: (p: string) => /[a-z]/.test(p), label: "One lowercase letter" },
  { test: (p: string) => /[0-9]/.test(p), label: "One number" },
];

const getPasswordStrengthMessage = (password: string): string | null => {
  const failed = passwordRequirements.filter(req => !req.test(password));
  if (failed.length === 0) return null;
  return `Password needs: ${failed.map(r => r.label.toLowerCase()).join(", ")}`;
};

const authSchema = z.object({
  email: z.string().email("Please enter a valid email"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

const signupPasswordSchema = z.string()
  .min(8, "Password must be at least 8 characters")
  .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
  .regex(/[a-z]/, "Password must contain at least one lowercase letter")
  .regex(/[0-9]/, "Password must contain at least one number");

// Invite metadata stored by the invite page so the auth page can show a banner
// and pre-fill the invited email. This lives in sessionStorage, not localStorage,
// so it is scoped to the current invite hand-off.
const INVITE_AUTH_CONTEXT_KEY = "inviteAuthContext";

type AppRole = Database["public"]["Enums"]["app_role"];

const roleLabels: Record<AppRole, string> = {
  basic_user: "Basic User",
  club_admin: "Club Admin",
  team_admin: "Team Admin",
  coach: "Coach",
  player: "Player",
  parent: "Parent",
  app_admin: "App Admin",
  league_admin: "League Admin",
  committee_member: "Committee Member",
  association_admin: "Association Admin",
  competition_admin: "Competition Admin",
};

function readInviteAuthContext(): {
  clubName: string | null;
  teamName: string | null;
  invitedEmail: string | null;
  roleLabel: string | null;
} | null {
  const raw = safeSessionGet(INVITE_AUTH_CONTEXT_KEY);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return {
      clubName: typeof parsed.clubName === "string" ? parsed.clubName : null,
      teamName: typeof parsed.teamName === "string" ? parsed.teamName : null,
      invitedEmail: typeof parsed.invitedEmail === "string" ? parsed.invitedEmail : null,
      roleLabel: typeof parsed.roleLabel === "string" ? parsed.roleLabel : null,
    };
  } catch {
    return null;
  }
}

function buildInviteBannerText(context: NonNullable<ReturnType<typeof readInviteAuthContext>>): string {
  const parts: string[] = [];
  if (context.clubName) parts.push(context.clubName);
  if (context.teamName) parts.push(context.teamName);
  const scope = parts.join(" — ");
  const role = context.roleLabel || "member";
  return scope ? `You're joining ${scope} as a ${role}.` : `You're joining as a ${role}.`;
}

/**
 * Sanitize a stored `redirectAfterAuth` value. Only permit same-origin,
 * single-slash-prefixed paths. Rejects external URLs (`https://…`,
 * `//evil.example`), non-string values, and empty/`/`/`/auth` destinations
 * that would either loop or leak away from the app origin.
 */
function sanitizeRedirectAfterAuth(raw: string | null): string | null {
  if (!raw || typeof raw !== "string") return null;
  if (!raw.startsWith("/")) return null;
  if (raw.startsWith("//")) return null; // protocol-relative
  if (raw.startsWith("/\\")) return null;
  if (raw === "/" || raw === "/auth" || raw.startsWith("/auth?") || raw.startsWith("/auth#")) return null;
  return raw;
}

export default function AuthPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [forgotPasswordOpen, setForgotPasswordOpen] = useState(false);
  const [biometricsAvailable, setBiometricsAvailable] = useState(false);
  const [biometricsChecked, setBiometricsChecked] = useState(false);
  const [hibpStatus, setHibpStatus] = useState<'idle' | 'checking' | 'safe' | 'compromised'>('idle');
  const [nativeKeyboardHeight, setNativeKeyboardHeight] = useState(0);
  const [nativeKeyboardVisible, setNativeKeyboardVisible] = useState(false);
  const signInScrollRef = useRef<HTMLDivElement | null>(null);
  // Synchronous submission lock — guards against double taps in one task.
  const authInFlightRef = useRef(false);

  // Invite metadata persisted by the invite page so the auth page can pre-fill
  // the email and show a banner.
  const [inviteAuthContext, setInviteAuthContext] = useState<NonNullable<ReturnType<typeof readInviteAuthContext>> | null>(null);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [confirmPasswordError, setConfirmPasswordError] = useState<string | null>(null);
  const [termsError, setTermsError] = useState<string | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);

  const isNativePlatform = Capacitor.isNativePlatform();
  const { isOnline } = useOnlineStatus();
  
  // The URL is the source of truth for the invite hand-off (mode / next /
  // invite). sessionStorage is NOT consulted for auth-mode intent any more —
  // it raced with the mount-time cleanup and dumped invite users on Sign In.
  const [searchParams] = useSearchParams();
  const authIntent = readAuthIntent(window.location.search);

  // `?mode=signup` / `?mode=signin` decides the visible tab; default Sign In.
  const modeParam = searchParams.get("mode");
  const defaultView: "signin" | "signup" =
    modeParam === "signup" || modeParam === "signin"
      ? modeParam
      : authIntent.mode ?? "signin";
  const [authMode, setAuthMode] = useState<"signin" | "signup">(defaultView);

  // Keep the tab in sync if the URL mode changes while mounted (e.g. a second
  // deep link arriving via soft SPA navigation).
  useEffect(() => {
    if (modeParam === "signup" || modeParam === "signin") {
      setAuthMode(modeParam);
    }
  }, [modeParam]);


  // Check if we're actively in an invite flow - only valid if there's a pending redirect
  // URL param is a fallback for webviews where sessionStorage writes are blocked.
  const redirectParam = readRedirectParam(window.location.search);
  const redirectAfterAuth = safeSessionGet("redirectAfterAuth") ?? redirectParam;

  useEffect(() => {
    console.log("[SignupFlow] Arrived at /auth", {
      mode: authIntent.mode,
      next: authIntent.next,
      invite: authIntent.invite ? "present" : null,
      storedRedirect: safeSessionGet("redirectAfterAuth"),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Read invite metadata from sessionStorage on mount. This pre-fills the email
  // and drives the invite banner and locked-email UI.
  useEffect(() => {
    const context = readInviteAuthContext();
    if (context) {
      setInviteAuthContext(context);
      if (context.invitedEmail) {
        setEmail(context.invitedEmail);
      }
    }
  }, []);

  
  // Invite flow context is trusted as-is. It is NOT invalidated just because
  // `redirectAfterAuth` is missing — in restricted webviews that storage write
  // fails, and discarding the context there was what dropped invite users onto
  // a plain Sign In screen. It is cleared only on explicit cancel or once the
  // profile is completed.
  const [inviteFlowContext] = useState(() => getInviteFlowContext());

  // Show invite flow progress whenever an invite flow is active.
  const isInInviteFlow = inviteFlowContext?.active === true;

  
  // HIBP compromised password check (k-anonymity — only first 5 chars of SHA1 sent)
  useEffect(() => {
    if (authMode !== 'signup' || !password || password.length < 8) {
      setHibpStatus('idle');
      return;
    }
    setHibpStatus('checking');
    const timer = setTimeout(async () => {
      try {
        const buffer = new TextEncoder().encode(password);
        const hashBuffer = await crypto.subtle.digest('SHA-1', buffer);
        const hash = Array.from(new Uint8Array(hashBuffer))
          .map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();
        const prefix = hash.slice(0, 5);
        const suffix = hash.slice(5);
        const res = await fetch(`https://reference.invalid`);
        const text = await res.text();
        const found = text.split('\n').some(line => line.split(':')[0] === suffix);
        setHibpStatus(found ? 'compromised' : 'safe');
      } catch {
        setHibpStatus('idle'); // Don't block user if API is unavailable
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [password, authMode]);

  // Invite flow context is intentionally NOT cleared on mount. A missing
  // `redirectAfterAuth` is not proof of staleness (blocked storage), and
  // clearing it here used to destroy the invite hand-off. Clearing happens on
  // explicit cancel of the flow or after the profile is completed.


  
  const { toast } = useToast();
  const {
    user,
    profile,
    initialized,
    profileLoading,
    profileResolved,
    profileError,
    signIn,
    signUp,
    signInWithGoogle,
    loading: authLoading,
  } = useAuth();

  // Post-auth navigation target is resolved exactly once, in an effect, so
  // that the pending `redirectAfterAuth` in sessionStorage is consumed
  // synchronously with committing the target into React state. Reading +
  // removing during render (React Router 7's <Navigate> defers navigation to
  // useEffect) previously produced a race: an extra render after removal
  // would see empty storage and fall through to `/`, overwriting the intended
  // destination before the first <Navigate> had committed.
  const [postAuthTarget, setPostAuthTarget] = useState<string | null>(null);

  // Warm the profile-completion chunk while the user is still filling the form
  // so the hand-off after signup paints without an intermediate loader.
  useEffect(() => {
    if (authMode !== "signup") return;
    const id = window.setTimeout(prefetchCompleteProfile, 300);
    return () => window.clearTimeout(id);
  }, [authMode]);



  // Resolve the post-auth destination exactly once, after auth + profile
  // state has settled. Consuming `redirectAfterAuth` here (rather than during
  // render) guarantees the pending destination is removed on the same commit
  // as the target is stored in React state, so a subsequent re-render cannot
  // observe empty storage and mistakenly default to `/`.
  useEffect(() => {
    if (postAuthTarget) return;
    if (!user) return;
    // Wait until auth is fully settled — matches shouldHoldAuthenticatedRedirect.
    if (!initialized || profileLoading) return;
    if (!profileResolved && !profileError) return;

    if (profileError) {
      setPostAuthTarget("/");
      return;
    }

    const stored = safeSessionGet("redirectAfterAuth") ?? redirectParam;
    const safe = sanitizeRedirectAfterAuth(stored);
    if (safe) {
      safeSessionRemove("redirectAfterAuth");
      safeSessionRemove(INVITE_AUTH_CONTEXT_KEY);
      console.log("[AuthPage] Authenticated, redirecting to:", safe);
      setPostAuthTarget(safe);
      return;
    }
    // Storage held nothing usable — clear any garbage/hostile value so a
    // later sign-in can't inherit it.
    if (stored) safeSessionRemove("redirectAfterAuth");

    const createdAt = user.created_at ? new Date(user.created_at).getTime() : 0;
    const isFreshSignup = createdAt > 0 && Date.now() - createdAt < 10 * 60 * 1000;
    if (!profile?.display_name || (isFreshSignup && !profile?.avatar_url)) {
      console.log("[AuthPage] Authenticated, redirecting to complete-profile", {
        hasName: !!profile?.display_name,
        hasAvatar: !!profile?.avatar_url,
        isFreshSignup,
      });
      setPostAuthTarget("/complete-profile");
      return;
    }

    console.log("[AuthPage] Authenticated, redirecting to home");
    clearInviteFlowContext();
    safeSessionRemove(INVITE_AUTH_CONTEXT_KEY);
    setPostAuthTarget("/");
  }, [
    user,
    initialized,
    profileLoading,
    profileResolved,
    profileError,
    profile,
    postAuthTarget,
    redirectParam,
  ]);

  const { 
    isAvailable, 
    isRegistered,
    nativeBiometricInfo,
    loading: passkeyLoading, 
    authenticateWithPasskey,
    storeCredentialsForNativeBiometric 
  } = usePasskey();
  
  // Check if biometrics are available (for showing the passkey button)
  useEffect(() => {
    let cancelled = false;
    const checkBiometrics = async () => {
      try {
        const available = await isPlatformAuthenticatorAvailable();
        if (cancelled) return;
        setBiometricsAvailable(available);
      } finally {
        if (!cancelled) setBiometricsChecked(true);
      }
    };
    checkBiometrics();
    return () => { cancelled = true; };
  }, []);

  // On native, usePasskey resolves `nativeBiometricInfo` asynchronously; treat
  // null as "still checking" so the button slot doesn't pop in late.
  const passkeyResolved = isNativePlatform ? nativeBiometricInfo !== null : true;
  const biometricSlotReady = biometricsChecked && passkeyResolved;
  const showBiometricButton = biometricSlotReady && biometricsAvailable && isRegistered;
  // Reserve the button slot on native until checks resolve so the layout
  // doesn't shift up/down when the biometric button finally renders.
  const reserveBiometricSlot = isNativePlatform && !biometricSlotReady;

  useEffect(() => {
    if (!isNativePlatform) return;

    let keyboardShowListener: { remove: () => void } | undefined;
    let keyboardHideListener: { remove: () => void } | undefined;

    // Proactively dismiss any keyboard that may have been open on the
    // previous screen (e.g. user tapped Sign Out from a focused input on
    // Account). Without this, Android can fire a stale `keyboardDidShow`
    // shortly after AuthPage mounts, which would otherwise yank the auth
    // shell upward (justify-start, no translate-y, compact logo).
    Keyboard.hide().catch(() => {});

    // Only treat the keyboard as "open for this page" when one of the
    // AuthPage inputs is actually focused. Spurious system events that
    // fire while focus is elsewhere (or on no element) must not shift
    // the layout.
    const isAuthInputFocused = () => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return false;
      const tag = el.tagName;
      if (tag !== "INPUT" && tag !== "TEXTAREA") return false;
      return signInScrollRef.current?.contains(el) ?? false;
    };

    Keyboard.addListener('keyboardDidShow', ({ keyboardHeight }) => {
      if (!isAuthInputFocused()) return;
      // Single source of truth: Capacitor's reported `keyboardHeight`,
      // normalised to CSS px (Android reports device px — the raw value
      // over-pads the layout by ~dpr×, leaving a blank gap above the keyboard).
      // Do NOT mix in `visualViewport.height` — the app runs with
      // `Keyboard.resize: 'none'`, so `visualViewport` either doesn't shrink
      // on Android (→ under-report → keyboard covers form) or shrinks
      // partially on some OEM WebViews (→ Math.min collapses to that partial
      // value → same bug).
      const safe = resolveKeyboardCssHeight(keyboardHeight || 0);
      setNativeKeyboardHeight(safe);
      setNativeKeyboardVisible(true);
    }).then(handle => {
      keyboardShowListener = handle;
    });

    Keyboard.addListener('keyboardDidHide', () => {
      setNativeKeyboardHeight(0);
      setNativeKeyboardVisible(false);
    }).then(handle => {
      keyboardHideListener = handle;
    });

    return () => {
      keyboardShowListener?.remove();
      keyboardHideListener?.remove();
    };
  }, [isNativePlatform]);

  useEffect(() => {
    if (!isNativePlatform || !nativeKeyboardVisible || typeof window === "undefined") {
      return;
    }

    let timeoutId: number | undefined;

    const resetViewportScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      signInScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    };

    const frameId = window.requestAnimationFrame(() => {
      resetViewportScroll();
      timeoutId = window.setTimeout(resetViewportScroll, 80);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [isNativePlatform, nativeKeyboardVisible]);

  useEffect(() => {
    if (typeof window === "undefined") return;

    let timeoutId: number | undefined;

    const resetAuthViewport = () => {
      setNativeKeyboardHeight(0);
      setNativeKeyboardVisible(false);

      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }

      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      signInScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    };

    const frameId = window.requestAnimationFrame(() => {
      resetAuthViewport();
      timeoutId = window.setTimeout(resetAuthViewport, 80);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, []);

  const isSignInMode = authMode === "signin";
  const isFormKeyboardOpen = isNativePlatform && nativeKeyboardVisible;
  const isSignInKeyboardOpen = isSignInMode && isFormKeyboardOpen;
  const isSignupKeyboardOpen = !isSignInMode && isFormKeyboardOpen;
  const isAndroid = isNativePlatform && !/(iPhone|iPad|iPod)/i.test(navigator.userAgent);
  // Android auth must not subtract the keyboard height from `100vh`: on modern
  // WebViews the CSS viewport may already be keyboard-reduced even when
  // Keyboard.resize is `none`, so subtracting again causes the huge blank-gap /
  // clipped-button bug. Use the app's locked viewport var instead of raw `vh`
  // so OEM resize drift doesn't collapse the shell mid-keyboard animation.
  const authViewportHeight = isFormKeyboardOpen && nativeKeyboardHeight > 0
    ? isAndroid
      ? 'var(--visual-vh, 100vh)'
      : `calc(var(--stable-vh, 100dvh) - ${nativeKeyboardHeight}px)`
    : isAndroid
      ? 'var(--visual-vh, 100vh)'
      : 'var(--stable-vh, 100dvh)';
  const authShellStyle = {
    height: authViewportHeight,
    paddingTop: 'var(--safe-area-top, env(safe-area-inset-top, 0px))',
    paddingBottom: isFormKeyboardOpen
      ? '0px'
      : 'var(--safe-area-bottom, env(safe-area-inset-bottom, 0px))',
  };
  
  // Determine button text based on platform
  const getBiometricButtonText = () => {
    if (nativeBiometricInfo) {
      switch (nativeBiometricInfo.biometryType) {
        case 'faceId':
          return 'Sign in with Face ID';
        case 'touchId':
          return 'Sign in with Touch ID';
        case 'fingerprint':
          return 'Sign in with Fingerprint';
        case 'iris':
          return 'Sign in with Iris';
        default:
          return 'Sign in with Biometrics';
      }
    }
    return 'Sign in with Face ID / Touch ID';
  };
  


  if (authLoading) {
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-3" style={authShellStyle}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Checking authentication...</p>
      </div>
    );
  }

  const shouldHoldAuthenticatedRedirect = !!user && (!initialized || profileLoading || (!profileResolved && !profileError));

  if (shouldHoldAuthenticatedRedirect) {
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-3" style={authShellStyle}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Finishing sign in...</p>
      </div>
    );
  }

  if (user && postAuthTarget) {
    return <Navigate to={postAuthTarget} replace />;
  }

  if (user) {
    // Auth is resolved but the post-auth target hasn't been committed yet.
    // The resolver effect below runs on the same commit as this render, so
    // the very next render will pick a target. Show the "Finishing sign in"
    // loader instead of rendering the sign-in form to a logged-in user.
    return (
      <div className="flex flex-col items-center justify-center bg-background gap-3" style={authShellStyle}>
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-muted-foreground">Finishing sign in...</p>
      </div>
    );
  }


  const handleAuth = async (mode: "signin" | "signup") => {
    // Clear any previous inline errors.
    setEmailError(null);
    setPasswordError(null);
    setConfirmPasswordError(null);
    setTermsError(null);
    setAuthError(null);

    // For signin, use basic validation
    if (mode === "signin") {
      const validation = authSchema.safeParse({ email, password });
      if (!validation.success) {
        validation.error.errors.forEach((err) => {
          const field = err.path[0];
          if (field === "email") setEmailError(err.message);
          if (field === "password") setPasswordError(err.message);
        });
        return;
      }
    } else {
      // For signup, validate email first
      const emailValidation = z.string().email("Please enter a valid email").safeParse(email);
      if (!emailValidation.success) {
        setEmailError(emailValidation.error.errors[0].message);
        return;
      }
      
      // Then validate password with stronger requirements
      const passwordValidation = signupPasswordSchema.safeParse(password);
      if (!passwordValidation.success) {
        const strengthMessage = getPasswordStrengthMessage(password);
        setPasswordError(strengthMessage || passwordValidation.error.errors[0].message);
        return;
      }
      
      if (password !== confirmPassword) {
        setConfirmPasswordError("Please ensure both passwords are identical.");
        return;
      }
      
      if (!acceptedTerms) {
        setTermsError("You must accept the Terms of Service and Privacy Policy to create an account.");
        return;
      }
    }

    // Synchronous in-flight lock: React state updates are async, so two taps
    // in the same browser task could both pass a `loading` check and fire two
    // signup requests on Android/iOS.
    if (authInFlightRef.current) return;
    authInFlightRef.current = true;
    setLoading(true);
    prefetchCompleteProfile();


    try {
      const result = mode === "signin"
        ? await signIn(email, password)
        : await signUp(email, password);
      const { error } = result;
      const needsEmailConfirmation =
        mode === "signup" && (result as { needsEmailConfirmation?: boolean }).needsEmailConfirmation === true;

      console.log("[SignupFlow] auth response", {
        mode,
        hasError: !!result.error,
        errorMessage: result.error?.message,
        needsEmailConfirmation,
      });




    if (error) {
      const message = error.message;
      if (message.includes("already registered")) {
        setEmailError("This email is already registered. Please sign in.");
        switchToSignIn();
      } else if (message.includes("Invalid login")) {
        setEmailError("Invalid email or password. Please try again.");
      } else if (message.includes("Email not confirmed")) {
        setEmailError("Please verify your email before signing in.");
      } else if (
        message.includes("Network") ||
        message.includes("fetch") ||
        /load failed/i.test(message) ||
        /timed? out/i.test(message)
      ) {
        setAuthError("We couldn't reach the server. Check your connection and try again.");
      } else if (message.toLowerCase().includes("weak") || message.toLowerCase().includes("easy to guess") || message.toLowerCase().includes("pwned")) {
        setPasswordError("This password is too common or has appeared in data breaches. Please choose a more unique password.");
      } else {
        setAuthError(message);
      }
    } else if (needsEmailConfirmation) {
      // Signup succeeded but Supabase requires email verification, so no
      // session exists yet and no redirect will happen. Tell the user instead
      // of leaving the form looking like nothing happened.
      toast({
        title: "Confirm your email to finish",
        description: `We've sent a confirmation link to ${email}. Open it on this device to continue joining.`,
      });
    } else {

      // Success! On native platforms, offer to save credentials for biometric login
      // Do a fresh check for biometric availability to avoid stale state issues on iOS
      if (mode === "signin" && Capacitor.isNativePlatform()) {
        try {
          // Import dynamically to avoid issues
          const { checkNativeBiometricAvailability } = await import('@/lib/nativeBiometrics');
          const freshBiometricInfo = await checkNativeBiometricAvailability();
          console.log('[AuthPage] Fresh biometric check:', freshBiometricInfo);
          
          if (freshBiometricInfo.isAvailable && !freshBiometricInfo.hasCredentials) {
            // Store credentials for future biometric login (silently)
            await storeCredentialsForNativeBiometric(email, password);
          }
        } catch (e) {
          console.log('[AuthPage] Biometric enrollment check failed:', e);
        }
      }
    }
    } catch (err) {
      // The auth dependency rejected instead of returning `{ error }` (e.g.
      // TypeError: Load failed on mobile). Surface an inline error and allow
      // a retry rather than leaving the form stuck in a loading state.
      console.error("[SignupFlow] auth call threw", err);
      setAuthError("We couldn't reach the server. Check your connection and try again.");
    } finally {
      authInFlightRef.current = false;
      setLoading(false);
    }
  };


  const handleGoogleSignIn = async () => {
    setGoogleLoading(true);
    const { error } = await signInWithGoogle();
    setGoogleLoading(false);
    
    if (error) {
      let message = error.message;
      if (message.includes("Network") || message.includes("fetch")) {
        message = "Please check your internet connection and try again.";
      }
      toast({
        title: useIcpLab ? "Unable to sign in with Internet Identity" : "Unable to sign in with Google",
        description: message,
      });
      if (useIcpLab) setAuthError(message);
    }
  };

  const handleBiometricSignIn = async () => {
    // Always use discoverable credentials - let the browser show ALL available passkeys
    console.log('[AuthPage] handleBiometricSignIn - using discoverable credentials');
    const result = await authenticateWithPasskey(); // No email = discoverable mode
    
    if (!result.success) {
      toast({
        title: "Biometric sign in failed",
        description: result.error || "Please try again or use your password.",
      });
    }
  };

  const switchToSignUp = () => {
    setAuthMode("signup");
    // Clear password fields when switching
    setPassword("");
    setConfirmPassword("");
  };

  const switchToSignIn = () => {
    setAuthMode("signin");
    // Clear password fields when switching
    setPassword("");
    setConfirmPassword("");
  };

  const shouldLowerDefaultSignIn = isSignInMode && isNativePlatform && !isSignInKeyboardOpen;
  const signInViewportClassName = isSignInMode
    ? isSignInKeyboardOpen
      ? `justify-start pb-4`
      : 'justify-center py-8'
    : 'overflow-y-auto';
  const signInStackClassName = isSignInMode
    ? isSignInKeyboardOpen
      ? 'space-y-4 py-2'
      : `${shouldLowerDefaultSignIn ? 'translate-y-4' : ''} space-y-8 py-6`
    : isSignupKeyboardOpen
      ? 'space-y-4 py-2'
      : 'space-y-8 py-8 my-auto';
  const signInCardContentClassName = isSignInKeyboardOpen ? 'space-y-3' : 'space-y-4';
  const signInFormClassName = isSignInKeyboardOpen ? 'space-y-3' : 'space-y-4';
  const signInFieldClassName = isSignInKeyboardOpen ? 'space-y-1.5' : 'space-y-2';
  const signupCardContentClassName = isSignupKeyboardOpen ? 'space-y-3' : 'space-y-4';
  const signupFormClassName = isSignupKeyboardOpen ? 'space-y-3' : 'space-y-4';
  const signupFieldClassName = isSignupKeyboardOpen ? 'space-y-1.5' : 'space-y-2';
  const authCardClassName = isAndroid && isFormKeyboardOpen
    ? 'border-border/50 bg-card/95'
    : 'border-border/50 bg-card/50 backdrop-blur-sm';

  if (useIcpLab) {
    // Same branding shell as the Supabase screen below (logo, "Ignite"
    // heading, offline banner, card container) — the only difference is
    // that the card offers Internet Identity passkey sign-in instead of
    // email/password + Google, since ICP mode has no username/password
    // concept.
    return (
      <div
        className="flex flex-col bg-background overflow-hidden"
        style={authShellStyle}
      >
        <div className="flex-1 flex flex-col items-center justify-center overflow-y-auto px-4 py-8">
          <div className="w-full max-w-md space-y-8 py-6">
            <div className="flex flex-col items-center gap-3 mt-4">
              <div className="rounded-2xl bg-primary glow-emerald p-4">
                <Flame className="h-10 w-10 text-primary-foreground" />
              </div>
              <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
            </div>

            {!isOnline && (
              <div
                role="alert"
                aria-live="polite"
                className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
              >
                <WifiOff className="h-5 w-5 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
                <div className="space-y-1">
                  <p className="font-medium">You're offline</p>
                  <p className="text-muted-foreground text-xs leading-relaxed">
                    Signing in needs an internet connection. Reconnect to Wi-Fi or mobile data and try again. Once you've signed in on this device, you'll stay signed in even when offline.
                  </p>
                </div>
              </div>
            )}

            <Card className={authCardClassName}>
              <CardHeader className="pb-2 gap-1">
                <h2 className="font-semibold text-center text-xl">Sign In</h2>
              </CardHeader>
              <CardContent className="space-y-4">
                <CardDescription className="text-center">
                  Sign in with your Internet Identity passkey.
                </CardDescription>
                {authError && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
                    {authError}
                  </div>
                )}
                <Button
                  type="button"
                  className="w-full gap-2"
                  onClick={handleGoogleSignIn}
                  disabled={googleLoading || authLoading}
                >
                  {googleLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Fingerprint className="h-4 w-4" />}
                  Continue with Internet Identity
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col bg-background overflow-hidden ${isNativePlatform ? 'fixed inset-0' : ''}`}
      data-lock-keyboard-scroll="true"
      style={authShellStyle}
    >

      {/* Show progress indicator if in invite flow */}
      {isInInviteFlow && (
        <InviteFlowProgress 
          currentStep="auth" 
          isIOS={inviteFlowContext?.isIOS}
          isExistingUser={false}
          className="fixed top-0 left-0 right-0"
        />
      )}
      
      <div
        ref={signInScrollRef}
        className={`flex-1 flex flex-col items-center overflow-y-auto px-4 ${signInViewportClassName} ${isInInviteFlow ? 'pt-16' : ''}`}
      >
      <div className={`w-full max-w-md ${signInStackClassName}`}>
        {/* Logo — compacts when keyboard is open on native sign-in */}
        <div className={`flex flex-col items-center transition-all duration-200 ${isFormKeyboardOpen ? 'gap-1 mt-2' : 'gap-3 mt-4'}`}>
          <div className={`rounded-2xl bg-primary glow-emerald transition-all duration-200 ${isFormKeyboardOpen ? 'p-2' : 'p-4'}`}>
            <Flame className={`text-primary-foreground transition-all duration-200 ${isFormKeyboardOpen ? 'h-5 w-5' : 'h-10 w-10'}`} />
          </div>
          {!isFormKeyboardOpen && (
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
          )}
        </div>

        {!isOnline && (
          <div
            role="alert"
            aria-live="polite"
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-foreground"
          >
            <WifiOff className="h-5 w-5 shrink-0 mt-0.5 text-destructive" aria-hidden="true" />
            <div className="space-y-1">
              <p className="font-medium">You're offline</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                Signing in needs an internet connection. Reconnect to Wi-Fi or mobile data and try again. Once you've signed in on this device, you'll stay signed in even when offline.
              </p>
            </div>
          </div>
        )}

        <Card className={authCardClassName}>
          {authMode === "signin" ? (
            <>
              <CardHeader className={`${isSignInKeyboardOpen ? 'pb-1 pt-5' : 'pb-2'} gap-1`}>
                <h2 className={`font-semibold text-center ${isSignInKeyboardOpen ? 'text-lg' : 'text-xl'}`}>Sign In</h2>
                {inviteAuthContext && (
                  <CardDescription className="text-center text-primary font-medium">
                    {buildInviteBannerText(inviteAuthContext)}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className={signInCardContentClassName}>
                {!isSignInKeyboardOpen && (
                  <CardDescription className="text-center">
                    Welcome back! Sign in to your account.
                  </CardDescription>
                )}
                <form
                  className={signInFormClassName}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAuth("signin");
                  }}
                >
                  {authError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {authError}
                    </div>
                  )}
                  <div className={signInFieldClassName}>
                    <Label htmlFor="signin-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-email"
                        type="email"
                        placeholder="redacted@example.invalid"
                        className="pl-10"
                        value={email}
                        disabled={!!inviteAuthContext?.invitedEmail}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setEmailError(null);
                          setAuthError(null);
                        }}
                      />
                    </div>
                    {emailError && <p className="text-xs text-destructive mt-1">{emailError}</p>}
                  </div>
                  <div className={signInFieldClassName}>
                    <div className="flex items-center justify-between">
                      <Label htmlFor="signin-password">Password</Label>
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => setForgotPasswordOpen(true)}
                      >
                        Forgot password?
                      </button>
                    </div>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signin-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setPasswordError(null);
                          setAuthError(null);
                        }}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {passwordError && <p className="text-xs text-destructive mt-1">{passwordError}</p>}
                  </div>
                  
                  <Button 
                    type="submit"
                    className="w-full" 
                    disabled={loading || googleLoading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : inviteAuthContext ? "Sign in & join" : "Sign In"}
                  </Button>
                  
                  {inviteAuthContext && (
                    <div className="text-center text-sm text-muted-foreground">
                      Need an account?{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={switchToSignUp}
                      >
                        Create one
                      </button>
                    </div>
                  )}
                  
                  {!isSignInKeyboardOpen && (
                    <>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">Or</span>
                        </div>
                      </div>
                      
                      {/* Hide Google sign-in on native apps - OAuth redirects outside the app */}
                      {!Capacitor.isNativePlatform() && (
                        <Button 
                          type="button"
                          variant="outline" 
                          className="w-full gap-2" 
                          onClick={handleGoogleSignIn}
                          disabled={loading || googleLoading || passkeyLoading}
                        >
                          {googleLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <svg className="h-4 w-4" viewBox="0 0 24 24">
                                <path
                                  fill="#4285F4"
                                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                                />
                                <path
                                  fill="#34A853"
                                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                                />
                                <path
                                  fill="#FBBC05"
                                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                                />
                                <path
                                  fill="#EA4335"
                                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                                />
                              </svg>
                              Continue with Google
                            </>
                          )}
                        </Button>
                      )}
                      
                      {showBiometricButton ? (
                        <Button 
                          type="button"
                          variant="outline" 
                          className="w-full gap-2" 
                          onClick={handleBiometricSignIn}
                          disabled={loading || googleLoading || passkeyLoading}
                        >
                          {passkeyLoading ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <>
                              <Fingerprint className="h-4 w-4" />
                              {getBiometricButtonText()}
                            </>
                          )}
                        </Button>
                      ) : reserveBiometricSlot ? (
                        // Placeholder reserves the biometric button's height on
                        // native so the layout doesn't shift when the async
                        // availability checks resolve. Matches Button h-10.
                        <div className="w-full h-10" aria-hidden="true" />
                      ) : null}
                    </>
                  )}

                  {/* Sign up link */}
                  {!inviteAuthContext && !isSignInKeyboardOpen && (
                    <div className="text-center text-sm text-muted-foreground pt-2">
                      Don't have an account?{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={switchToSignUp}
                      >
                        Sign up here
                      </button>
                    </div>
                  )}
                </form>
              </CardContent>
            </>
          ) : (
            <>
              <CardHeader className={`${isSignupKeyboardOpen ? 'pb-1 pt-5' : 'pb-2'} gap-1`}>
                <h2 className={`font-semibold text-center ${isSignupKeyboardOpen ? 'text-lg' : 'text-xl'}`}>Create Account</h2>
                {inviteAuthContext && (
                  <CardDescription className="text-center text-primary font-medium">
                    {buildInviteBannerText(inviteAuthContext)}
                  </CardDescription>
                )}
              </CardHeader>
              <CardContent className={signupCardContentClassName}>
                {!isSignupKeyboardOpen && (
                  <CardDescription className="text-center">
                    Create an account to get started.
                  </CardDescription>
                )}
                <form
                  className={signupFormClassName}
                  onSubmit={(e) => {
                    e.preventDefault();
                    handleAuth("signup");
                  }}
                >
                  {authError && (
                    <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                      {authError}
                    </div>
                  )}
                  <div className={signupFieldClassName}>
                    <Label htmlFor="signup-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-email"
                        type="email"
                        placeholder="redacted@example.invalid"
                        className="pl-10"
                        value={email}
                        disabled={!!inviteAuthContext?.invitedEmail}
                        onChange={(e) => {
                          setEmail(e.target.value);
                          setEmailError(null);
                          setAuthError(null);
                        }}
                      />
                    </div>
                    {emailError && <p className="text-xs text-destructive mt-1">{emailError}</p>}
                  </div>
                  <div className={signupFieldClassName}>
                    <Label htmlFor="signup-password">Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-password"
                        type={showPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={password}
                        onChange={(e) => {
                          setPassword(e.target.value);
                          setPasswordError(null);
                          setAuthError(null);
                        }}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        tabIndex={-1}
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {passwordError && <p className="text-xs text-destructive mt-1">{passwordError}</p>}
                    {password && (() => {
                      const unmet = passwordRequirements.filter((req) => !req.test(password));
                      const collapseChecklist = unmet.length === 0 && hibpStatus !== 'compromised';
                      if (collapseChecklist) {
                        return (
                          <div className={`flex items-center gap-2 text-xs ${isSignupKeyboardOpen ? 'mt-1' : 'mt-2'}`}>
                            {hibpStatus === 'checking'
                              ? <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin flex-shrink-0" />
                              : <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                            <span className="text-primary">
                              {hibpStatus === 'checking' ? 'Checking password…' : 'Password meets all requirements'}
                            </span>
                          </div>
                        );
                      }
                      return (
                        <div className={`${isSignupKeyboardOpen ? 'space-y-0.5 mt-1' : 'space-y-1 mt-2'}`}>
                          {passwordRequirements.map((req, idx) => {
                            const met = req.test(password);
                            return (
                              <div key={idx} className="flex items-center gap-2 text-xs">
                                {met
                                  ? <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />
                                  : <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />
                                }
                                <span className={met ? 'text-primary' : 'text-muted-foreground'}>
                                  {req.label}
                                </span>
                              </div>
                            );
                          })}
                          {/* HIBP compromised password check */}
                          <div className="flex items-center gap-2 text-xs">
                            {hibpStatus === 'checking' && <Loader2 className="h-3.5 w-3.5 text-muted-foreground animate-spin flex-shrink-0" />}
                            {hibpStatus === 'safe' && <CheckCircle2 className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                            {hibpStatus === 'compromised' && <XCircle className="h-3.5 w-3.5 text-destructive flex-shrink-0" />}
                            {hibpStatus === 'idle' && <Circle className="h-3.5 w-3.5 text-muted-foreground/40 flex-shrink-0" />}
                            <span className={
                              hibpStatus === 'safe' ? 'text-primary' :
                              hibpStatus === 'compromised' ? 'text-destructive' :
                              'text-muted-foreground'
                            }>
                              {hibpStatus === 'compromised' ? 'Password found in data breaches — choose another' : 'Not a known compromised password'}
                            </span>
                          </div>
                        </div>
                      );
                    })()}
                  </div>
                  <div className={signupFieldClassName}>
                    <Label htmlFor="signup-confirm-password">Confirm Password</Label>
                    <div className="relative">
                      <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        id="signup-confirm-password"
                        type={showConfirmPassword ? "text" : "password"}
                        placeholder="••••••••"
                        className="pl-10 pr-10"
                        value={confirmPassword}
                        onChange={(e) => {
                          setConfirmPassword(e.target.value);
                          setConfirmPasswordError(null);
                          setAuthError(null);
                        }}
                        onFocus={(e) => {
                          const el = e.currentTarget;
                          // Keyboard opening reflows the viewport; nudge the field
                          // into view so the user can see what they're typing.
                          const bring = () => el.scrollIntoView({ block: "center", behavior: "smooth" });
                          requestAnimationFrame(bring);
                          setTimeout(bring, 350);
                        }}
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                        tabIndex={-1}
                      >
                        {showConfirmPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {confirmPasswordError && <p className="text-xs text-destructive mt-1">{confirmPasswordError}</p>}
                  </div>
                  
                  <div className="flex items-start gap-2 pt-1">
                    <Checkbox
                      id="accept-terms"
                      checked={acceptedTerms}
                      onCheckedChange={(checked) => {
                        setAcceptedTerms(checked === true);
                        setTermsError(null);
                        setAuthError(null);
                      }}
                      className="mt-0.5 shrink-0"
                    />
                    <label htmlFor="accept-terms" className="text-xs text-muted-foreground leading-snug cursor-pointer flex-1">
                      I agree to the{" "}
                      <Link to="/terms" {...(!Capacitor.isNativePlatform() ? { target: "_blank" } : {})} className="text-primary hover:underline">Terms of Service</Link>
                      {" "}and{" "}
                      <Link to="/privacy" {...(!Capacitor.isNativePlatform() ? { target: "_blank" } : {})} className="text-primary hover:underline">Privacy Policy</Link>
                    </label>
                  </div>
                  {termsError && <p className="text-xs text-destructive -mt-1">{termsError}</p>}

                  <Button 
                    type="submit"
                    className="w-full" 
                    disabled={loading || googleLoading}
                  >
                    {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : inviteAuthContext ? "Create account & join" : "Create Account"}
                  </Button>

                  {inviteAuthContext && (
                    <div className="text-center text-sm text-muted-foreground">
                      Already have an account?{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={switchToSignIn}
                      >
                        Sign in
                      </button>
                    </div>
                  )}
                  
                  {/* Hide Google sign-up on native apps - OAuth redirects outside the app */}
                  {!Capacitor.isNativePlatform() && (
                    <>
                      <div className="relative">
                        <div className="absolute inset-0 flex items-center">
                          <span className="w-full border-t" />
                        </div>
                        <div className="relative flex justify-center text-xs uppercase">
                          <span className="bg-card px-2 text-muted-foreground">Or</span>
                        </div>
                      </div>
                      
                      <Button 
                        type="button"
                        variant="outline" 
                        className="w-full gap-2" 
                        onClick={handleGoogleSignIn}
                        disabled={loading || googleLoading}
                      >
                        {googleLoading ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <>
                            <svg className="h-4 w-4" viewBox="0 0 24 24">
                              <path
                                fill="#4285F4"
                                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
                              />
                              <path
                                fill="#34A853"
                                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                              />
                              <path
                                fill="#FBBC05"
                                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                              />
                              <path
                                fill="#EA4335"
                                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                              />
                            </svg>
                            Continue with Google
                          </>
                        )}
                      </Button>
                    </>
                  )}

                  {/* Sign in link - only shown when NOT in invite flow */}
                  {!inviteAuthContext && !isSignupKeyboardOpen && (
                    <div className="text-center text-sm text-muted-foreground pt-2">
                      Already have an account?{" "}
                      <button
                        type="button"
                        className="text-primary hover:underline font-medium"
                        onClick={switchToSignIn}
                      >
                        Sign in here
                      </button>
                    </div>
                  )}
                </form>
              </CardContent>
            </>
          )}
        </Card>

        {/* Forgot Password Dialog */}
        <Suspense fallback={null}>
        <ForgotPasswordDialog 
          open={forgotPasswordOpen} 
          onOpenChange={setForgotPasswordOpen}
          defaultEmail={email}
        />
        </Suspense>

        {/* Footer Links — hidden when keyboard is open on native sign-in */}
        {!isFormKeyboardOpen && (
          <div className="text-center text-xs text-muted-foreground space-y-2">
            <div className="flex justify-center gap-4">
              {Capacitor.isNativePlatform() ? (
                <>
                  <Link to="/terms" className="hover:text-foreground hover:underline">Terms</Link>
                  <Link to="/privacy" className="hover:text-foreground hover:underline">Privacy</Link>
                  <Link to="/cancellation" className="hover:text-foreground hover:underline">Cancellation</Link>
                </>
              ) : (
                <>
                  <a href="https://reference.invalid" onClick={(e) => { e.preventDefault(); import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://reference.invalid")); }} className="hover:text-foreground hover:underline cursor-pointer">Terms</a>
                  <a href="https://reference.invalid" onClick={(e) => { e.preventDefault(); import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://reference.invalid")); }} className="hover:text-foreground hover:underline cursor-pointer">Privacy</a>
                  <a href="https://reference.invalid" onClick={(e) => { e.preventDefault(); import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl("https://reference.invalid")); }} className="hover:text-foreground hover:underline cursor-pointer">Cancellation</a>
                </>
              )}
            </div>
            {!Capacitor.isNativePlatform() && (
              <div className="flex justify-center gap-4">
                <a href="mailto:redacted@example.invalid" className="hover:text-foreground hover:underline">Contact</a>
                <a href="mailto:redacted@example.invalid" className="hover:text-foreground hover:underline">Support</a>
              </div>
            )}
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
