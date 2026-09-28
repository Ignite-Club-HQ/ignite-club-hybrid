import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  invoke: vi.fn(),
  toast: vi.fn(),
  refetches: vi.fn(),
  tableResults: new Map<string, any>(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, functions: { invoke: mocks.invoke } },
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock("@/components/EventViewMemberRow", () => ({
  EventViewMemberRow: ({ member, onSendReminder }: any) => (
    <div>
      <span>{member.display_name}</span>
      <button onClick={() => onSendReminder("push", [member.id])}>Remind {member.display_name}</button>
    </div>
  ),
}));
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: any) => <>{children}</>,
  DialogContent: ({ children }: any) => <div>{children}</div>,
  DialogHeader: ({ children }: any) => <div>{children}</div>,
  DialogTitle: ({ children }: any) => <h3>{children}</h3>,
  DialogDescription: ({ children }: any) => <p>{children}</p>,
}));
vi.mock("@/components/ui/tabs", () => ({
  Tabs: ({ children }: any) => <div>{children}</div>,
  TabsList: ({ children }: any) => <div>{children}</div>,
  TabsTrigger: ({ children }: any) => <button>{children}</button>,
  TabsContent: ({ children }: any) => <div>{children}</div>,
}));
vi.mock("@/components/ui/dropdown-menu", () => ({
  DropdownMenu: ({ children }: any) => <div>{children}</div>,
  DropdownMenuTrigger: ({ children }: any) => <>{children}</>,
  DropdownMenuContent: ({ children }: any) => <div>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
  DropdownMenuSeparator: () => <hr />,
}));

import { AttendanceSection } from "./AttendanceSection";

function queryFor(table: string) {
  const result = mocks.tableResults.get(table) ?? { data: null, error: null };
  const chain: any = {};
  for (const method of ["select", "eq", "gte", "order", "limit"]) chain[method] = vi.fn(() => chain);
  chain.maybeSingle = vi.fn(() => Promise.resolve(result));
  Object.defineProperty(chain, "then", {
    value: (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject),
  });
  return chain;
}

function wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      {children}
    </QueryClientProvider>
  );
}

function renderSection(overrides: Partial<React.ComponentProps<typeof AttendanceSection>> = {}) {
  const props: React.ComponentProps<typeof AttendanceSection> = {
    eventId: "event-1",
    isAdmin: true,
    hasMembers: true,
    counts: { going: 1, maybe: 1, notGoing: 1, notResponded: 2 },
    goingContent: <div>Alex attending</div>,
    maybeContent: <div>Blair unsure</div>,
    notGoingContent: <div>Casey unavailable</div>,
    notRespondedContent: <div>Drew awaiting response</div>,
    notRespondedUserIds: ["user-3", "user-4"],
    canSendReminders: true,
    ...overrides,
  };
  return render(<AttendanceSection {...props} />, { wrapper });
}

describe("AttendanceSection permissions and reminder behaviour", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tableResults.clear();
    mocks.tableResults.set("event_views", { data: [], error: null });
    mocks.tableResults.set("event_reminder_log", { data: null, error: null });
    mocks.from.mockImplementation(queryFor);
    mocks.invoke.mockResolvedValue({ data: { pushSent: 2, emailsSent: 0 }, error: null });
  });

  it("does not query sensitive view or reminder data for non-admins", async () => {
    renderSection({ isAdmin: false });

    expect(screen.queryByText(/Remind all non-responders/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Upgrade to Pro/i)).not.toBeInTheDocument();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("shows attendance buckets and preserves the supplied attendee content", () => {
    renderSection();

    expect(screen.getByText("No Response (2)")).toBeInTheDocument();
    expect(screen.getByText("Going (1)")).toBeInTheDocument();
    expect(screen.getByText("Maybe (1)")).toBeInTheDocument();
    expect(screen.getByText("Not Going (1)")).toBeInTheDocument();
    expect(screen.getByText("Alex attending")).toBeInTheDocument();
    expect(screen.getByText("Drew awaiting response")).toBeInTheDocument();
  });

  it("hides empty optional buckets rather than presenting misleading groups", () => {
    renderSection({ counts: { going: 1, maybe: 0, notGoing: 0, notResponded: 0 }, notRespondedUserIds: [] });

    expect(screen.queryByText(/Maybe \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Not Going \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No Response \(/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Remind all/)).not.toBeInTheDocument();
  });

  it("gates on-demand reminders for a free admin without invoking the edge function", () => {
    const onProRequired = vi.fn();
    renderSection({ canSendReminders: false, onProRequired });

    fireEvent.click(screen.getByRole("button", { name: /Upgrade to Pro/i }));
    expect(onProRequired).toHaveBeenCalledOnce();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("uses event-specific player wording for non-social events", () => {
    renderSection({ canSendReminders: false, counts: { going: 0, maybe: 0, notGoing: 0, notResponded: 1 }, notRespondedUserIds: ["player-1"] });
    expect(screen.getByText(/1 player hasn't responded yet/)).toBeInTheDocument();
  });

  it("uses member wording for social events", () => {
    renderSection({ eventType: "social", canSendReminders: false });
    expect(screen.getByText(/2 members haven't responded yet/)).toBeInTheDocument();
  });

  it.each(["push", "email", "both"] as const)("sends %s reminders only to the non-responder IDs", async channel => {
    renderSection();

    const label = channel === "push" ? /Push Notification/i : channel === "email" ? /^Email$/i : /Both \(Push \+ Email\)/i;
    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send-event-view-reminder", {
      body: { eventId: "event-1", userIds: ["user-3", "user-4"], channels: channel },
    }));
  });

  it("scopes the viewed count to addressable event members", async () => {
    mocks.tableResults.set("event_views", { data: [
      { user_id: "member-1", viewed_at: "2026-07-20T10:00:00Z" },
      { user_id: "outsider", viewed_at: "2026-07-20T10:01:00Z" },
    ], error: null });
    renderSection({
      addressableMembers: [
        { id: "member-1", display_name: "Alex" },
        { id: "member-2", display_name: "Blair" },
      ],
      notRespondedUserIds: ["member-2"],
    });

    expect(await screen.findByRole("button", { name: /1 viewed/i })).toBeInTheDocument();
    expect(screen.getByText("Viewed (1)")).toBeInTheDocument();
    expect(screen.getByText("Not opened (1)")).toBeInTheDocument();
  });

  it("sends a per-member reminder only to the selected non-viewer", async () => {
    renderSection({
      addressableMembers: [{ id: "member-1", display_name: "Alex" }],
      notRespondedUserIds: ["member-1"],
    });

    fireEvent.click(await screen.findByRole("button", { name: "Remind Alex" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send-event-view-reminder", {
      body: { eventId: "event-1", userIds: ["member-1"], channels: "push" },
    }));
  });

  it("disables bulk reminders during the server-recorded 24-hour cooldown", async () => {
    mocks.tableResults.set("event_reminder_log", {
      data: { sent_at: new Date(Date.now() - 60_000).toISOString(), recipients_count: 2 }, error: null,
    });
    renderSection();

    const button = await screen.findByRole("button", { name: /Reminded .* ago/i });
    expect(button).toBeDisabled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("surfaces an edge-function failure and restores the reminder action", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "delivery unavailable" } });
    renderSection();
    fireEvent.click(screen.getByRole("button", { name: /Push Notification/i }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Failed to send reminder",
      description: "delivery unavailable",
      variant: "destructive",
    }));
    expect(screen.getByRole("button", { name: /Remind all non-responders/i })).not.toBeDisabled();
  });
});
