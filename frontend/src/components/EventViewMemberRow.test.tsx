import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ open, children }: any) => open ? <div>{children}</div> : null,
  DrawerContent: ({ children }: any) => <div>{children}</div>,
  DrawerHeader: ({ children }: any) => <div>{children}</div>,
  DrawerTitle: ({ children }: any) => <h3>{children}</h3>,
}));
vi.mock("@/components/ui/tooltip", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
  TooltipTrigger: ({ children }: any) => <>{children}</>,
  TooltipContent: ({ children }: any) => <div>{children}</div>,
}));

import { EventViewMemberRow } from "./EventViewMemberRow";

const member = {
  id: "member-1",
  display_name: "Alex Morgan",
  avatar_url: null,
  hasViewed: false,
};

function renderRow(overrides: Partial<React.ComponentProps<typeof EventViewMemberRow>> = {}) {
  const props: React.ComponentProps<typeof EventViewMemberRow> = {
    member,
    variant: "not-viewed",
    pushDisabled: false,
    noPushSetup: false,
    isBusy: false,
    onSendReminder: vi.fn(),
    onNudge: vi.fn(),
    ...overrides,
  };
  const result = render(<EventViewMemberRow {...props} />);
  return { ...result, props };
}

function openActions() {
  fireEvent.click(screen.getByText("Alex Morgan"));
}

describe("EventViewMemberRow reminder controls", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each([
    ["Send Push Notification", "push"],
    ["Send Email Reminder", "email"],
    ["Send Both (Push + Email)", "both"],
  ] as const)("targets only this member for %s", (buttonName, channel) => {
    const { props } = renderRow();
    openActions();
    fireEvent.click(screen.getByRole("button", { name: buttonName }));

    expect(props.onSendReminder).toHaveBeenCalledWith(channel, ["member-1"]);
  });

  it("does not expose reminder actions for a member who already responded", () => {
    const { props } = renderRow({ hasResponded: true });
    openActions();

    expect(screen.queryByRole("button", { name: "Send Push Notification" })).not.toBeInTheDocument();
    expect(props.onSendReminder).not.toHaveBeenCalled();
    expect(screen.getByText("Has responded")).toBeInTheDocument();
  });

  it("disables every delivery action while a request is in flight", () => {
    renderRow({ isBusy: true });
    openActions();

    expect(screen.getByRole("button", { name: "Send Push Notification" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send Email Reminder" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send Both (Push + Email)" })).toBeDisabled();
  });

  it("must not offer push delivery when event push notifications are disabled", () => {
    const { props } = renderRow({ pushDisabled: true });
    openActions();

    expect(screen.getByText("Event push notifications disabled")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Send Push Notification" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send Email Reminder" })).toBeEnabled();
    expect(props.onSendReminder).not.toHaveBeenCalled();
  });

  it("must not offer push delivery when the member has no push setup", () => {
    renderRow({ noPushSetup: true });
    openActions();

    expect(screen.getAllByText("No push notifications set up")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Send Push Notification" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send Email Reminder" })).toBeEnabled();
  });

  it("allows a no-push member to be nudged with their exact identity", () => {
    const { props } = renderRow({ noPushSetup: true });
    openActions();
    fireEvent.click(screen.getByRole("button", { name: "Nudge to Enable Push" }));

    expect(props.onNudge).toHaveBeenCalledWith("member-1", "Alex Morgan");
  });

  it("offers link sharing only when a share callback was supplied", () => {
    const onShareLink = vi.fn();
    renderRow({ onShareLink });
    openActions();
    fireEvent.click(screen.getByRole("button", { name: "Share via Link" }));
    expect(onShareLink).toHaveBeenCalledOnce();
  });

  it("shows a viewed timestamp only for viewed rows", () => {
    const viewedAt = "2026-07-20T10:00:00Z";
    const expectedDate = new Date(viewedAt).toLocaleDateString();
    renderRow({ member: { ...member, hasViewed: true, viewedAt }, variant: "viewed" });
    expect(screen.getByText(expectedDate)).toBeInTheDocument();
  });

  it("uses a safe fallback for a member without a display name", () => {
    renderRow({ member: { ...member, display_name: null } });
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText("?")).toBeInTheDocument();
  });
});
