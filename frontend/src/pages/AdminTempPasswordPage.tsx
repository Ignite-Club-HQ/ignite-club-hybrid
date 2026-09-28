import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, KeyRound, Loader2, Copy, Check, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { PageLoading } from "@/components/ui/page-loading";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

function generatePassword(): string {
  // High-entropy random password to satisfy HIBP/strength checks
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const nums = "23456789";
  const syms = "!@#$%^&*?";
  const all = upper + lower + nums + syms;
  const rand = (n: number) => {
    const buf = new Uint32Array(n);
    crypto.getRandomValues(buf);
    return buf;
  };
  const pickFrom = (s: string, r: number) => s[r % s.length];
  const r = rand(20);
  // Guarantee one of each class
  let pw =
    pickFrom(upper, r[0]) +
    pickFrom(lower, r[1]) +
    pickFrom(nums, r[2]) +
    pickFrom(syms, r[3]);
  // Add 14 more random chars from full set => 18 total
  for (let i = 0; i < 14; i++) pw += pickFrom(all, r[i + 4]);
  // Shuffle
  const arr = pw.split("");
  const r2 = rand(arr.length);
  return arr
    .map((c, i) => ({ c, k: r2[i] }))
    .sort((a, b) => a.k - b.k)
    .map((x) => x.c)
    .join("");
}

export default function AdminTempPasswordPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-md mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <KeyRound className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Temporary passwords are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Supabase password administration does not apply to ICP identities. No credential was generated or changed.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseAdminTempPasswordPage />;
}

function SupabaseAdminTempPasswordPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState(() => generatePassword());
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const { data: isAppAdmin, isLoading } = useQuery({
    queryKey: ["is-app-admin", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .eq("role", "app_admin")
        .maybeSingle();
      return !!data;
    },
    enabled: !!user?.id,
  });

  if (isLoading) return <PageLoading />;

  if (!isAppAdmin) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-2xl font-bold">Set Temp Password</h1>
        </div>
        <p className="text-muted-foreground text-center py-8">Access denied. App admin role required.</p>
      </div>
    );
  }

  const handleSubmit = async () => {
    if (!email.trim() || password.length < 8) {
      toast({ title: "Enter a valid email and 8+ char password" });
      return;
    }

    setLoading(true);
    setResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("admin-set-temp-password", {
        body: { email: email.trim(), password },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setResult({ email: data.email, password });
      toast({ title: "Password set", description: `Active immediately for ${data.email}` });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      toast({ title: "Failed to set password", description: msg });
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (!result) return;
    await navigator.clipboard.writeText(
      `Email: ${result.email}\nTemp password: ${result.password}\n\nLog in and change it from Profile → Account.`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="py-6 space-y-6 max-w-xl mx-auto">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Set Temp Password</h1>
          <p className="text-sm text-muted-foreground">For users locked out of their account</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <KeyRound className="h-5 w-5 text-primary" />
            Reset a user's password
          </CardTitle>
          <CardDescription>
            Sets an immediately-active password. Send it to the user via a secure channel and ask
            them to change it from Profile → Account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email">User's email</Label>
            <Input
              id="email"
              type="email"
              placeholder="redacted@example.invalid"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={loading}
              autoComplete="off"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password">Temporary password</Label>
            <div className="flex gap-2">
              <Input
                id="password"
                type="text"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={loading}
                autoComplete="off"
                className="font-mono"
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setPassword(generatePassword())}
                disabled={loading}
                title="Regenerate"
              >
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Min 8 characters. Auto-generated; edit if needed.</p>
          </div>

          <Button className="w-full" onClick={handleSubmit} disabled={loading}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Set Password"}
          </Button>

          {result && (
            <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
              <p className="text-sm font-medium text-primary">✓ Password active for {result.email}</p>
              <div className="font-mono text-sm bg-background border rounded p-3 break-all">
                {result.password}
              </div>
              <Button variant="outline" size="sm" onClick={handleCopy} className="w-full">
                {copied ? (
                  <><Check className="h-4 w-4 mr-2" /> Copied</>
                ) : (
                  <><Copy className="h-4 w-4 mr-2" /> Copy email + password</>
                )}
              </Button>
              <p className="text-xs text-muted-foreground">
                Share via secure channel (e.g. SMS or in-person). The user can log in immediately
                and should change it from Profile → Account.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
