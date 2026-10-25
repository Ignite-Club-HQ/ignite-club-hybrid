/**
 * Temporary testing aid: collects every blocked ICP fallback into one list so
 * the app shows a single calm summary instead of a stack of red pop-ups.
 * Entries carry only sanitized service/table labels (never URLs or payloads).
 */
export interface TestingIssue {
  key: string;
  label: string;
  title: string;
  explanation: string;
  pages: string[];
  count: number;
  firstSeen: number;
}

const issues = new Map<string, TestingIssue>();
const listeners = new Set<() => void>();
let snapshot: TestingIssue[] = [];

function humanize(name: string): string {
  return name.replace(/[_-]+/g, " ").trim();
}

/** Plain-English description of a blocked-fallback label. */
export function explainBlockedLabel(label: string): { title: string; explanation: string } {
  const [kind, ...rest] = label.split(" ");
  const name = humanize(rest.join(" "));
  switch (kind) {
    case "gallery_notice": {
      const explanations: Record<string, string> = {
        not_configured: "Your photos were saved, but the gallery service has no club notification connection configured. The protected backend update must restore that connection; uploading the photos again will not fix it.",
        refused: "Your photos were saved, but the club service declined the notification request. Its notification permissions or club audience checks need investigation; this does not mean the photo upload failed.",
        denied: "Your photos were saved, but the notification was blocked because access to the account or gallery changed during the upload.",
        capacity: "Your photos were saved, but the gallery notification record limit was reached. An administrator needs to review that limit.",
        unknown: "Your photos were saved, but the app did not receive a confirmed notification result. The notification may already have been queued, so the app has not automatically sent it again.",
      };
      return { title: "Photos saved; notification not confirmed", explanation: explanations[rest.join(" ")] ?? explanations.unknown };
    }
    case "data":
      return {
        title: `“${name}” information isn’t connected yet`,
        explanation: `This screen tried to read or save “${name}” from the old Supabase database. You’re signed in with Internet Identity, so that information should come from ICP instead, and that link is still missing.`,
      };
    case "action":
      return {
        title: `The “${name}” task hasn’t moved to ICP yet`,
        explanation: `This screen asked the old Supabase server to run “${name}”. That task still needs an ICP version before it can work for Internet Identity accounts.`,
      };
    case "coverage":
      return {
        title: `${name.charAt(0).toUpperCase()}${name.slice(1)} isn’t set up for this app version`,
        explanation: `The app doesn’t have its ICP connection details for “${name}”. This usually means the latest backend or web app update hasn’t finished installing.`,
      };
    case "email":
      return {
        title: "The old email sign-in was checked",
        explanation: "Something asked the old email sign-in system about your session, even though you’re signed in with Internet Identity.",
      };
    case "file":
      return {
        title: "A file change went to old storage",
        explanation: "Something tried to change files in the old Supabase storage instead of ICP storage.",
      };
    case "live":
      return {
        title: "Instant live updates aren’t on ICP yet",
        explanation: "Live updates still use the old system, so this screen won’t update by itself. Pull down or reopen it to see the latest.",
      };
    default:
      return {
        title: "An unexpected old-system request was stopped",
        explanation: "The app tried to contact the old Supabase system in a way that isn’t allowed for Internet Identity accounts.",
      };
  }
}

/** Extracts the sanitized label from a blocked-fallback message. */
export function blockedLabelFromMessage(message: string): string {
  const match = /fallback:\s*(.+?)\.?$/.exec(message);
  return (match?.[1] ?? message).trim();
}

function emit() {
  snapshot = Array.from(issues.values()).sort((a, b) => a.firstSeen - b.firstSeen);
  listeners.forEach(listener => listener());
}

export function recordTestingIssue(message: string, page: string): void {
  const label = blockedLabelFromMessage(message);
  const existing = issues.get(label);
  if (existing) {
    existing.count += 1;
    if (!existing.pages.includes(page)) existing.pages = [...existing.pages, page];
    issues.set(label, { ...existing });
  } else {
    issues.set(label, { key: label, label, ...explainBlockedLabel(label), pages: [page], count: 1, firstSeen: Date.now() });
  }
  emit();
}

export function clearTestingIssues(): void {
  issues.clear();
  emit();
}

export function getTestingIssues(): TestingIssue[] {
  return snapshot;
}

export function subscribeTestingIssues(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** One combined support reference for the report form. */
export function testingIssuesDiagnostic(list: TestingIssue[]): string {
  return list.map(issue => `${issue.label} (x${issue.count}; ${issue.pages.join(", ")})`).join("; ");
}
