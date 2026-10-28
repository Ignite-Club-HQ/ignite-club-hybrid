import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, Stethoscope, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { ClubAccessStep } from "@/live/clubAccessCheck";

/** Read-only self check: shows each step that builds the signed-in person's
 * club list, then refreshes club pages so a stale saved list is replaced. */
export function ClubAccessCheckCard() {
  const queryClient = useQueryClient();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<ClubAccessStep[] | null>(null);
  const run = async () => {
    setRunning(true);
    try {
      const { runClubAccessCheck } = await import("@/live/clubAccessCheck");
      setSteps(await runClubAccessCheck());
      void queryClient.invalidateQueries();
    } catch (e) {
      setSteps([{ name: "Check", ok: false, detail: String((e as Error)?.message ?? e), ms: 0 }]);
    } finally { setRunning(false); }
  };
  return (
    <Card>
      <CardContent className="p-4 space-y-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary/10"><Stethoscope className="h-5 w-5 text-primary" /></div>
          <div className="min-w-0 flex-1">
            <span className="font-medium">Check my club access</span>
            <p className="text-xs text-muted-foreground">Read-only. Shows why clubs might not be appearing.</p>
          </div>
          <Button variant="outline" size="sm" onClick={run} disabled={running}>
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : "Run"}
          </Button>
        </div>
        {steps && (
          <ul className="space-y-2">
            {steps.map((s, i) => (
              <li key={i} className="flex gap-2 text-xs">
                {s.ok ? <CheckCircle2 className="h-4 w-4 shrink-0 text-primary" /> : <XCircle className="h-4 w-4 shrink-0 text-destructive" />}
                <div className="min-w-0">
                  <span className="font-medium">{s.name}</span>{s.ms ? <span className="text-muted-foreground"> · {(s.ms / 1000).toFixed(1)}s</span> : null}
                  <p className="font-mono break-all text-muted-foreground">{s.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
