import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Loader2, Mail, ShieldCheck } from "lucide-react";
import { REGEXP_ONLY_DIGITS } from "input-otp";
import { z } from "zod";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  InputOTP,
  InputOTPGroup,
  InputOTPSlot,
} from "@/components/ui/input-otp";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { usePageTitle } from "@/hooks/usePageTitle";
import { getPasswordResetRedirectUrl } from "@/lib/passwordResetRedirect";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

const emailSchema = z.string().email("Please enter a valid email address");
// Server-side verification is authoritative; this is the last-line client
// gate so we never send anything but a 6-digit numeric token to Supabase.
const SIX_DIGIT_CODE = /^\d{6}$/;

export default function VerifyResetCodePage() {
  usePageTitle("Verify Reset Code");
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-md mx-auto px-4 py-10">
        <div className="rounded-xl border border-primary/20 bg-primary/5 p-6 space-y-4 text-center">
          <ShieldCheck className="h-10 w-10 mx-auto text-muted-foreground" />
          <h1 className="text-lg font-semibold">Reset-code verification is unavailable in ICP lab mode</h1>
          <p className="text-sm text-muted-foreground">
            Supabase recovery codes do not apply to local ICP identities. No code was verified or resent.
          </p>
          <Button variant="outline" onClick={() => navigate("/")}>Go to Home</Button>
        </div>
      </div>
    );
  }

  return <SupabaseVerifyResetCodePage />;
}

function SupabaseVerifyResetCodePage() {

  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState(searchParams.get("email") ?? "");
  const [code, setCode] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [resending, setResending] = useState(false);
  // Synchronous guard: React state updates lag, so a rapid paste/URL flow
  // could otherwise fire verifyOtp() twice before `verifying` flips true.
  const verifyInFlightRef = useRef(false);

  // If both email and code are provided in the URL, attempt verification
  // automatically — but only for a strictly numeric 6-digit token.
  useEffect(() => {
    const urlCode = searchParams.get("code");
    const urlEmail = searchParams.get("email");
    if (urlEmail && urlCode && SIX_DIGIT_CODE.test(urlCode)) {
      setEmail(urlEmail);
      setCode(urlCode);
      void verifyCode(urlEmail, urlCode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const verifyCode = async (emailValue: string, token: string) => {
    // Numeric-code gate BEFORE any Supabase call. Rejects alphabetic,
    // mixed alphanumeric, symbols, blanks, and any length != 6.
    if (!SIX_DIGIT_CODE.test(token)) {
      toast({
        title: "Invalid code",
        description: "Enter the 6-digit numeric code from your email.",
      });
      setCode("");
      return;
    }

    const validation = emailSchema.safeParse(emailValue);
    if (!validation.success) {
      toast({
        title: "Invalid email",
        description: validation.error.errors[0].message,
      });
      return;
    }

    if (verifyInFlightRef.current) return;
    verifyInFlightRef.current = true;
    setVerifying(true);
    try {
      const { error } = await supabase.auth.verifyOtp({
        email: emailValue,
        token,
        type: "recovery",
      });

      if (error) {
        toast({
          title: "Invalid or expired code",
          description: "Double-check the code or request a new one.",
        });
        setCode("");
        return;
      }

      // verifyOtp puts the user in a recovery session — ResetPasswordPage
      // detects the session and shows the new-password form.
      navigate("/reset-password");
    } finally {
      verifyInFlightRef.current = false;
      setVerifying(false);
    }
  };

  const handleCodeChange = (value: string) => {
    setCode(value);
    // input-otp's pattern={REGEXP_ONLY_DIGITS} silently filters non-digit
    // characters at the input layer, but we still gate here for paste flows
    // and defence-in-depth.
    if (value.length === 6 && !verifying && !verifyInFlightRef.current) {
      void verifyCode(email, value);
    }
  };

  const resendCode = async () => {
    const validation = emailSchema.safeParse(email);
    if (!validation.success) {
      toast({
        title: "Invalid email",
        description: validation.error.errors[0].message,
      });
      return;
    }

    setResending(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: getPasswordResetRedirectUrl(email),
    });
    setResending(false);

    if (error) {
      console.error("[VerifyResetCode] resetPasswordForEmail error:", error);
    }

    // Always show success to avoid email enumeration.
    toast({
      title: "Code sent",
      description: "Check your email for a 6-digit code.",
    });
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md space-y-6">
        <div className="flex flex-col items-center text-center space-y-3">
          <div className="p-3 rounded-full bg-primary/10">
            <ShieldCheck className="h-8 w-8 text-primary" />
          </div>
          <div className="space-y-1">
            <h1 className="text-2xl font-semibold tracking-tight">
              Enter your reset code
            </h1>
            <p className="text-sm text-muted-foreground">
              Already have a 6-digit code from your email? Enter it below to
              continue resetting your password.
            </p>
          </div>
        </div>

        <div className="rounded-lg border bg-card p-6 space-y-5 shadow-sm">
          <div className="space-y-2">
            <Label htmlFor="verify-email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="verify-email"
                type="email"
                placeholder="redacted@example.invalid"
                className="pl-10"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={verifying}
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label>6-digit code</Label>
            <div className="flex justify-center pt-1">
              <InputOTP
                maxLength={6}
                pattern={REGEXP_ONLY_DIGITS}
                inputMode="numeric"
                value={code}
                onChange={handleCodeChange}
                disabled={verifying}
                autoFocus={!!email}
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
            </div>
            {verifying && (
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground pt-2">
                <Loader2 className="h-4 w-4 animate-spin" />
                Verifying…
              </div>
            )}
          </div>

          <div className="flex flex-col items-center gap-2 pt-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={resendCode}
              disabled={resending || verifying}
            >
              {resending ? (
                <>
                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                  Sending…
                </>
              ) : (
                "Resend code to this email"
              )}
            </Button>
            <p className="text-xs text-muted-foreground text-center">
              Codes expire 1 hour after they're sent. Check your spam folder if
              it doesn't arrive.
            </p>
          </div>
        </div>

        <div className="flex justify-center">
          <Button variant="ghost" size="sm" asChild>
            <Link to="/auth">
              <ArrowLeft className="h-3 w-3 mr-1" />
              Back to sign in
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
