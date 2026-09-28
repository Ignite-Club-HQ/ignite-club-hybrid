import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Flame, Lock, Loader2, CheckCircle, CheckCircle2, Circle, XCircle, Mail } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";
import { resolveKeyboardCssHeight } from "@/lib/keyboardCssHeight";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { getPasswordResetRedirectUrl } from "@/lib/passwordResetRedirect";
import { z } from "zod";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

const emailSchema = z.string().email("Please enter a valid email address");

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

const passwordSchema = z.object({
  password: z.string()
    .min(8, "Password must be at least 8 characters")
    .regex(/[A-Z]/, "Password must contain at least one uppercase letter")
    .regex(/[a-z]/, "Password must contain at least one lowercase letter")
    .regex(/[0-9]/, "Password must contain at least one number"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

export default function ResetPasswordPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-md mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Lock className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Password recovery is unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Supabase password recovery does not apply to local ICP identities. No recovery request was sent.
            </p>
            <Button variant="outline" onClick={() => navigate("/")}>Go to Home</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseResetPasswordPage />;
}

function SupabaseResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Explicit recovery-session lifecycle. The password form MUST NOT render
  // until we've confirmed a real recovery session exists (PKCE code exchange,
  // existing recovery session, OTP verification, or PASSWORD_RECOVERY event).
  const [recoverySessionStatus, setRecoverySessionStatus] = useState<
    "checking" | "valid" | "invalid"
  >("checking");
  const [showOtpRecovery, setShowOtpRecovery] = useState(false);
  const [otpEmail, setOtpEmail] = useState("");
  const [otpEmailError, setOtpEmailError] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [breachedPasswords, setBreachedPasswords] = useState<Set<string>>(new Set());
  const [hibpStatus, setHibpStatus] = useState<'idle' | 'checking' | 'safe' | 'compromised'>('idle');
  const [nativeKeyboardVisible, setNativeKeyboardVisible] = useState(false);
  const [nativeKeyboardHeight, setNativeKeyboardHeight] = useState(0);
  const resetScrollRef = useRef<HTMLDivElement>(null);
  const otpEmailInputRef = useRef<HTMLInputElement>(null);
  const mountedRef = useRef(true);
  const sendOtpInFlightRef = useRef(false);
  const verifyOtpInFlightRef = useRef(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);
  const isNativePlatform = Capacitor.isNativePlatform();
  const isNativeAndroid = isNativePlatform && Capacitor.getPlatform() === "android";

  useEffect(() => {
    let cancelled = false;

    const markInvalid = (message: string) => {
      if (cancelled || !mountedRef.current) return;
      setError(message);
      setRecoverySessionStatus("invalid");
    };
    const markValid = () => {
      if (cancelled || !mountedRef.current) return;
      setError(null);
      setRecoverySessionStatus("valid");
    };

    const establishRecoverySession = async () => {
      try {
        // Case 1: PKCE flow — Supabase puts ?code=... in the URL search params
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const errorDescription =
          url.searchParams.get("error_description") ||
          new URLSearchParams(url.hash.replace(/^#/, "")).get("error_description");

        if (errorDescription) {
          markInvalid(decodeURIComponent(errorDescription));
          return;
        }

        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) {
            console.error("[ResetPassword] exchangeCodeForSession error:", exchangeError);
            markInvalid("Invalid or expired reset link. Please request a new password reset.");
            return;
          }
          // Clean the URL so a refresh doesn't try to re-exchange the code
          window.history.replaceState({}, document.title, "/reset-password");
          markValid();
          return;
        }

        // Case 2: implicit/hash flow — Supabase auto-detects via detectSessionInUrl.
        // Give the SDK a brief window to process tokens in the URL hash before
        // we conclude there's no session (avoids a flash of the error UI).
        await new Promise((resolve) => setTimeout(resolve, 600));
        if (cancelled) return;

        const { data: { session } } = await supabase.auth.getSession();
        if (session) {
          markValid();
        } else {
          markInvalid("Invalid or expired reset link. Please request a new password reset.");
        }
      } catch (err) {
        console.error("[ResetPassword] session setup failed:", err);
        markInvalid("Invalid or expired reset link. Please request a new password reset.");
      }
    };

    establishRecoverySession();

    // Also listen for PASSWORD_RECOVERY in case the SDK fires it after our check
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY" && !cancelled && mountedRef.current) {
        setError(null);
        setRecoverySessionStatus("valid");
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, []);

  // HIBP compromised password check (k-anonymity — only first 5 chars of SHA1 sent)
  useEffect(() => {
    if (!password || password.length < 8) {
      setHibpStatus('idle');
      return;
    }
    if (breachedPasswords.has(password)) {
      setHibpStatus('compromised');
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
        setHibpStatus('idle');
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [password, breachedPasswords]);

  useEffect(() => {
    if (!isNativePlatform) return;

    let keyboardShowListener: { remove: () => void } | undefined;
    let keyboardHideListener: { remove: () => void } | undefined;

    Keyboard.addListener("keyboardDidShow", ({ keyboardHeight }) => {
      setNativeKeyboardHeight(resolveKeyboardCssHeight(keyboardHeight || 0));
      setNativeKeyboardVisible(true);
    }).then((handle) => {
      keyboardShowListener = handle;
    });

    Keyboard.addListener("keyboardDidHide", () => {
      setNativeKeyboardHeight(0);
      setNativeKeyboardVisible(false);
    }).then((handle) => {
      keyboardHideListener = handle;
    });

    return () => {
      keyboardShowListener?.remove();
      keyboardHideListener?.remove();
    };
  }, [isNativePlatform]);

  useEffect(() => {
    if (!isNativePlatform || !nativeKeyboardVisible || typeof window === "undefined") return;

    let timeoutId: number | undefined;
    const resetViewportScroll = () => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
      resetScrollRef.current?.scrollTo({ top: 0, behavior: "auto" });
    };

    const frameId = window.requestAnimationFrame(() => {
      resetViewportScroll();
      timeoutId = window.setTimeout(resetViewportScroll, 80);
    });

    return () => {
      window.cancelAnimationFrame(frameId);
      if (timeoutId) window.clearTimeout(timeoutId);
    };
  }, [isNativePlatform, nativeKeyboardVisible]);

  const resetViewportHeight = nativeKeyboardVisible && nativeKeyboardHeight > 0
    ? isNativeAndroid
      ? "100vh"
      : `calc(var(--stable-vh, 100dvh) - ${nativeKeyboardHeight}px)`
    : "var(--stable-vh, 100dvh)";
  const resetShellStyle = {
    height: resetViewportHeight,
    paddingTop: "var(--safe-area-top, env(safe-area-inset-top, 0px))",
    paddingBottom: nativeKeyboardVisible
      ? "0px"
      : "var(--safe-area-bottom, env(safe-area-inset-bottom, 0px))",
  };
  const resetViewportClassName = nativeKeyboardVisible
    ? "justify-start overflow-y-auto py-3"
    : "justify-center py-4";
  const resetStackClassName = nativeKeyboardVisible
    ? "space-y-4 py-2"
    : "space-y-8 py-6 animate-slide-up";

  const sendRecoveryCode = async () => {
    const validation = emailSchema.safeParse(otpEmail);
    if (!validation.success) {
      const message = validation.error.errors[0].message;
      if (mountedRef.current) setOtpEmailError(message);
      otpEmailInputRef.current?.focus();
      toast({
        title: "Invalid email",
        description: message,
      });
      return;
    }

    // Prevent duplicate send-code requests while one is active.
    if (sendOtpInFlightRef.current) return;
    sendOtpInFlightRef.current = true;

    if (mountedRef.current) {
      setOtpEmailError(null);
      setSendingOtp(true);
    }
    try {
      // Fail closed: any thrown exception or Supabase error is treated the
      // same — we do NOT show "Code sent" and do NOT reveal whether the email
      // belongs to an account.
      let sendError: unknown = null;
      try {
        const { error } = await supabase.auth.resetPasswordForEmail(otpEmail, {
          redirectTo: getPasswordResetRedirectUrl(otpEmail),
        });
        sendError = error ?? null;
      } catch (thrown) {
        sendError = thrown;
      }

      if (sendError) {
        console.error("[ResetPassword] resetPasswordForEmail error:", sendError);
        if (!mountedRef.current) return;
        toast({
          title: "Unable to send code",
          description:
            "We couldn't send the verification code. Check your connection and try again.",
        });
        // Stay on the recovery-code interface, keep Send code enabled, allow retry.
        return;
      }

      if (!mountedRef.current) return;
      toast({
        title: "Code sent",
        description: "Check your email for a 6-digit code.",
      });
    } finally {
      sendOtpInFlightRef.current = false;
      if (mountedRef.current) setSendingOtp(false);
    }
  };

  const verifyRecoveryCode = async (token: string) => {
    // Never invoke Supabase with an empty or malformed email — verifyOtp with
    // an empty email silently fails and confuses the user.
    const validation = emailSchema.safeParse(otpEmail);
    if (!validation.success) {
      const message = validation.error.errors[0].message;
      if (mountedRef.current) setOtpEmailError(message);
      otpEmailInputRef.current?.focus();
      toast({
        title: "Enter your email",
        description: "We need your email to verify the code.",
      });
      // Do NOT clear the entered code — user may want to retry after fixing email.
      return;
    }

    // Prevent concurrent verify calls.
    if (verifyOtpInFlightRef.current) return;
    verifyOtpInFlightRef.current = true;

    if (mountedRef.current) setVerifyingOtp(true);
    try {
      const { error: verifyError } = await supabase.auth.verifyOtp({
        email: otpEmail,
        token,
        type: "recovery",
      });
      if (verifyError) {
        if (!mountedRef.current) return;
        toast({
          title: "Invalid or expired code",
          description: "Double-check the code or request a new one.",
        });
        setOtpCode("");
        return;
      }
      if (!mountedRef.current) return;
      // Now in a real recovery session — flip status to valid so the form renders.
      setError(null);
      setShowOtpRecovery(false);
      setOtpCode("");
      setRecoverySessionStatus("valid");
    } finally {
      verifyOtpInFlightRef.current = false;
      if (mountedRef.current) setVerifyingOtp(false);
    }
  };

  const handleOtpChange = (value: string) => {
    setOtpCode(value);
    if (value.length === 6 && !verifyingOtp && !verifyOtpInFlightRef.current) {
      void verifyRecoveryCode(value);
    }
  };

  const handleResetPassword = async () => {
    // Synchronous guard: refuse to call updateUser() unless the recovery
    // session has been confirmed. Supabase remains the authoritative security
    // boundary, but this prevents the form from ever submitting during the
    // checking / invalid states.
    if (recoverySessionStatus !== "valid") {
      return;
    }

    const validation = passwordSchema.safeParse({ password, confirmPassword });
    if (!validation.success) {
      const strengthMessage = getPasswordStrengthMessage(password);
      toast({
        title: "Please check your password",
        description: strengthMessage || validation.error.errors[0].message,
      });
      return;
    }


    setLoading(true);
    
    const { error } = await supabase.auth.updateUser({
      password: password,
    });

    setLoading(false);

    if (error) {
      const msg = error.message || "";
      const isWeak = /weak|pwned|breach|compromis|easy to guess/i.test(msg);
      if (isWeak) {
        setBreachedPasswords((prev) => new Set(prev).add(password));
      }
      toast({
        title: isWeak ? "Password too common" : "Unable to reset password",
        description: isWeak
          ? "This password has appeared in known data breaches. Please choose a different, more unique password (e.g. add extra words or symbols)."
          : msg,
      });
    } else {
      // Update stored biometric credentials so next biometric sign-in uses the new password
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (Capacitor.isNativePlatform()) {
          const { storeCredentialsForBiometric, hasStoredCredentials } = await import("@/lib/nativeBiometrics");
          const { data: { user } } = await supabase.auth.getUser();
          const email = user?.email;
          if (email && (await hasStoredCredentials())) {
            await storeCredentialsForBiometric(email, password);
          }
        }
      } catch (e) {
        console.log("[ResetPassword] Failed to update biometric credentials:", e);
      }

      setSuccess(true);
      toast({
        title: "Password updated!",
        description: "Your password has been reset successfully.",
      });
      // Redirect to home after a short delay
      setTimeout(() => navigate("/"), 2000);
    }

  };

  if (recoverySessionStatus === "checking") {
    return (
      <div
        className="flex flex-col bg-background overflow-hidden"
        data-lock-keyboard-scroll="true"
        style={resetShellStyle}
      >
        <div
          ref={resetScrollRef}
          className={`flex-1 flex flex-col items-center px-4 ${resetViewportClassName}`}
        >
          <div className={`w-full max-w-md ${resetStackClassName}`}>
            <div className="flex flex-col items-center gap-3">
              <div className="p-4 rounded-2xl bg-primary glow-emerald">
                <Flame className="h-10 w-10 text-primary-foreground" />
              </div>
              <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
            </div>
            <Card
              className="border-border/50 bg-card/50 backdrop-blur-sm"
              data-testid="reset-password-checking"
            >
              <CardContent className="pt-6 text-center space-y-3">
                <Loader2 className="h-8 w-8 text-primary animate-spin mx-auto" />
                <p className="text-sm text-muted-foreground">
                  Verifying your reset link…
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    );
  }

  if (recoverySessionStatus === "invalid") {
    return (
      <div className="flex flex-col bg-background overflow-hidden" data-lock-keyboard-scroll="true" style={resetShellStyle}>
        <div ref={resetScrollRef} className={`flex-1 flex flex-col items-center px-4 ${resetViewportClassName}`}>
        <div className={`w-full max-w-md ${resetStackClassName}`}>
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-2xl bg-primary glow-emerald">
              <Flame className="h-10 w-10 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
          </div>

          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            {!showOtpRecovery ? (
              <CardContent className="pt-6 text-center space-y-4">
                <p className="text-muted-foreground">{error}</p>
                <p className="text-xs text-muted-foreground">
                  Email link scanners sometimes consume reset links before you click them.
                  Use a 6-digit code instead — it can't be triggered by scanners.
                </p>
                <Button
                  onClick={() => setShowOtpRecovery(true)}
                  className="w-full"
                >
                  Use a 6-digit code instead
                </Button>
                <Button
                  variant="outline"
                  onClick={() => navigate("/auth")}
                  className="w-full"
                >
                  Back to Sign In
                </Button>
              </CardContent>
            ) : (
              <>
                <CardHeader>
                  <CardTitle>Reset with a code</CardTitle>
                  <CardDescription>
                    We'll email you a 6-digit code. Enter it below to reset your password.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="otp-email">Email</Label>
                    <div className="relative">
                      <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                      <Input
                        ref={otpEmailInputRef}
                        id="otp-email"
                        type="email"
                        placeholder="redacted@example.invalid"
                        className="pl-10"
                        value={otpEmail}
                        aria-invalid={otpEmailError ? "true" : undefined}
                        aria-describedby={otpEmailError ? "otp-email-error" : undefined}
                        onChange={(e) => {
                          setOtpEmail(e.target.value);
                          if (otpEmailError) setOtpEmailError(null);
                        }}
                      />
                    </div>
                    {otpEmailError && (
                      <p
                        id="otp-email-error"
                        className="text-xs text-destructive"
                      >
                        {otpEmailError}
                      </p>
                    )}
                  </div>

                  <Button
                    onClick={sendRecoveryCode}
                    disabled={sendingOtp}
                    className="w-full"
                    variant="outline"
                  >
                    {sendingOtp ? <Loader2 className="h-4 w-4 animate-spin" /> : "Send code"}
                  </Button>

                  <div className="flex flex-col items-center gap-3 pt-2">
                    <Label className="text-sm">Enter the 6-digit code</Label>
                    <InputOTP
                      maxLength={6}
                      value={otpCode}
                      onChange={handleOtpChange}
                      disabled={verifyingOtp}
                    >
                      <InputOTPGroup>
                        <InputOTPSlot index={0} />
                        <InputOTPSlot index={1} />
                        <InputOTPSlot index={2} />
                        <InputOTPSlot index={3} />
                        <InputOTPSlot index={4} />
                        <InputOTPSlot index={5} />
                      </InputOTPGroup>
                    </InputOTP>
                    {verifyingOtp && (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Verifying…
                      </div>
                    )}
                  </div>

                  <Button
                    variant="ghost"
                    onClick={() => {
                      setShowOtpRecovery(false);
                      setOtpCode("");
                    }}
                    className="w-full"
                  >
                    Back
                  </Button>
                </CardContent>
              </>
            )}
          </Card>
        </div>
        </div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="flex flex-col bg-background overflow-hidden" data-lock-keyboard-scroll="true" style={resetShellStyle}>
        <div ref={resetScrollRef} className={`flex-1 flex flex-col items-center px-4 ${resetViewportClassName}`}>
        <div className={`w-full max-w-md ${resetStackClassName}`}>
          <div className="flex flex-col items-center gap-3">
            <div className="p-4 rounded-2xl bg-primary glow-emerald">
              <Flame className="h-10 w-10 text-primary-foreground" />
            </div>
            <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>
          </div>
          
          <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
            <CardContent className="pt-6 text-center space-y-4">
              <CheckCircle className="h-12 w-12 text-primary mx-auto" />
              <p className="text-foreground font-medium">Password reset successful!</p>
              <p className="text-sm text-muted-foreground">Redirecting you to the app...</p>
            </CardContent>
          </Card>
        </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col bg-background overflow-hidden" data-lock-keyboard-scroll="true" style={resetShellStyle}>
      <div ref={resetScrollRef} className={`flex-1 flex flex-col items-center px-4 ${resetViewportClassName}`}>
      <div className={`w-full max-w-md ${resetStackClassName}`}>
        <div className={`flex flex-col items-center transition-all duration-200 ${nativeKeyboardVisible ? "gap-1 mt-1" : "gap-3"}`}>
          <div className={`rounded-2xl bg-primary glow-emerald transition-all duration-200 ${nativeKeyboardVisible ? "p-2" : "p-4"}`}>
            <Flame className={`text-primary-foreground transition-all duration-200 ${nativeKeyboardVisible ? "h-5 w-5" : "h-10 w-10"}`} />
          </div>
          {!nativeKeyboardVisible && <h1 className="text-3xl font-bold text-gradient-emerald">Ignite</h1>}
          {!nativeKeyboardVisible && <p className="text-sm font-medium text-muted-foreground">Club HQ</p>}
        </div>

        <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
          <CardHeader>
            <CardTitle>Reset Your Password</CardTitle>
            <CardDescription>
              Enter your new password below.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="new-password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
              </div>
              {password && (
                <div className="space-y-1 mt-2">
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
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirm-password"
                  type="password"
                  placeholder="••••••••"
                  className="pl-10"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                />
              </div>
            </div>
            <Button 
              className="w-full" 
              onClick={handleResetPassword}
              disabled={loading}
            >
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Reset Password"}
            </Button>
          </CardContent>
        </Card>
      </div>
      </div>
    </div>
  );
}
