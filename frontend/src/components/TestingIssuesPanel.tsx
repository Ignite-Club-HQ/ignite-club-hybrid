import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ChevronDown, ChevronUp, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { requestGapReport } from "@/lib/gapFeedback";
import { getTestingIssues, subscribeTestingIssues, testingIssuesDiagnostic } from "@/lib/testingIssues";

/**
 * Temporary testing summary: one calm card listing every problem found so far,
 * in plain English, instead of a separate red pop-up per problem.
 */
export default function TestingIssuesPanel() {
  const issues = useSyncExternalStore(subscribeTestingIssues, getTestingIssues, getTestingIssues);
  const [hiddenCount, setHiddenCount] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const total = issues.reduce((sum, issue) => sum + issue.count, 0);
  const lastLength = useRef(0);

  // Re-show only when a new kind of problem appears after hiding.
  useEffect(() => {
    if (issues.length > lastLength.current && lastLength.current > 0 && hiddenCount > 0) setHiddenCount(0);
    lastLength.current = issues.length;
  }, [issues.length, hiddenCount]);

  if (issues.length === 0 || hiddenCount === issues.length) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-3 z-[60] mx-auto max-w-lg rounded-2xl border border-border bg-card text-card-foreground shadow-lg"
      style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 5.5rem)" }}
    >
      <div className="flex items-start gap-3 p-4">
        <Info className="mt-0.5 h-5 w-5 shrink-0 text-warning" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="font-semibold leading-snug">
            {issues.length === 1 ? "One part of the app isn’t working yet" : `${issues.length} parts of the app aren’t working yet`}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Everything else keeps working. Testing details are below.
          </p>
        </div>
        <button
          type="button"
          aria-label="Hide"
          onClick={() => { setHiddenCount(issues.length); setExpanded(false); }}
          className="rounded-full p-1 text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {expanded && (
        <ul className="max-h-[45vh] space-y-3 overflow-y-auto border-t border-border px-4 py-3">
          {issues.map(issue => (
            <li key={issue.key} className="rounded-xl bg-muted/60 p-3">
              <p className="text-sm font-medium">{issue.title}</p>
              <p className="mt-1 text-sm text-muted-foreground">{issue.explanation}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                Seen {issue.count} {issue.count === 1 ? "time" : "times"} on {issue.pages.map(p => (p === "/" ? "Home" : p)).join(", ")}
              </p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-2">
        <Button variant="ghost" size="sm" onClick={() => setExpanded(v => !v)}>
          {expanded ? <ChevronUp className="mr-1 h-4 w-4" /> : <ChevronDown className="mr-1 h-4 w-4" />}
          {expanded ? "Hide details" : `Show why (${total})`}
        </Button>
        <Button variant="outline" size="sm" onClick={() => requestGapReport(testingIssuesDiagnostic(issues))}>
          Report {issues.length === 1 ? "this" : "these"}
        </Button>
      </div>
    </div>
  );
}
