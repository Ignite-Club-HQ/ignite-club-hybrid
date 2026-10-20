import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  rpc: vi.fn(),
  from: vi.fn(),
  getUser: vi.fn(),
  update: vi.fn(),
  setLiveEventRsvp: vi.fn(),
  setLiveRsvpNote: vi.fn(),
  context: { identity: {}, target: {} },
  navigate: vi.fn(),
  toast: vi.fn(),
  haptic: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: (...args: unknown[]) => mocks.from(...args),
    auth: { getUser: (...args: unknown[]) => mocks.getUser(...args) },
  },
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.mode === "icp" ? providers.icp(mocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  setLiveEventRsvp: (...args: unknown[]) => mocks.setLiveEventRsvp(...args),
  setLiveRsvpNote: (...args: unknown[]) => mocks.setLiveRsvpNote(...args),
}));
vi.mock("react-router-dom", () => ({ useNavigate: () => mocks.navigate }));
vi.mock("@/hooks/use-toast", () => ({ toast: mocks.toast }));
vi.mock("@/lib/haptics", () => ({ hapticImpactLight: mocks.haptic }));
vi.mock("@/components/rsvp/RsvpNoteSheet", () => ({
  RsvpNoteSheet: ({ open, onSave }: { open: boolean; onSave: (note: string) => Promise<void> }) =>
    open ? <button onClick={() => void onSave("I'll be there")}>Save note</button> : null,
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "11111111-1111-4111-8111-111111111111" } }) }));

import { InlineRsvpActions } from "./InlineRsvpActions";

const STORAGE_KEY = "ignite_inline_rsvp_answered";
const supabaseMode = mocks.mode === "supabase";

describe("InlineRsvpActions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    mocks.rpc.mockResolvedValue({ data: [{ inserted_count: 1 }], error: null });
    mocks.getUser.mockResolvedValue({ data: { user: { id: "11111111-1111-4111-8111-111111111111" } } });
    mocks.from.mockImplementation(() => ({
      update: (payload: unknown) => {
        mocks.update(payload);
        const chain = { eq: () => chain, is: async () => ({ error: null }) };
        return chain;
      },
    }));
    mocks.setLiveEventRsvp.mockResolvedValue(undefined);
    mocks.setLiveRsvpNote.mockResolvedValue(undefined);
  });

  it.runIf(supabaseMode).each([
    ["Going", "going"],
    ["Maybe", "maybe"],
    ["Can't", "not_going"],
  ])("submits the %s response with the exact event and status", async (buttonLabel, status) => {
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);

    fireEvent.click(screen.getByRole("button", { name: buttonLabel }));

    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith("quick_rsvp_from_dm", {
      _event_id: "event-1",
      _status: status,
    }));
    expect(mocks.haptic).toHaveBeenCalledOnce();
    expect(await screen.findByText(`You marked ${buttonLabel}`)).toBeInTheDocument();
  });

  it.runIf(supabaseMode)("disables every response while the RPC is in flight and prevents duplicate submissions", async () => {
    let resolveRpc!: (value: any) => void;
    mocks.rpc.mockReturnValue(new Promise(resolve => { resolveRpc = resolve; }));
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(screen.getByRole("button", { name: "Going" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Maybe" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Can't" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    expect(mocks.rpc).toHaveBeenCalledOnce();

    resolveRpc({ data: [{ inserted_count: 1 }], error: null });
    expect(await screen.findByText("You marked Going")).toBeInTheDocument();
  });

  it("persists a successful answer under only the originating message", async () => {
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    await screen.findByText("You marked Maybe");

    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ "message-1": "maybe" });
  });

  it("restores an answered message without issuing another mutation", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "message-1": "not_going" }));
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);

    expect(screen.getByText("You marked Can't")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Going" })).not.toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("ignores malformed persisted state and still lets the member respond", () => {
    localStorage.setItem(STORAGE_KEY, "not-json");
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);

    expect(screen.getByRole("button", { name: "Going" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Maybe" })).toBeEnabled();
  });

  it("synchronizes an answer received from another browser tab", () => {
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "message-1": "going" }));

    act(() => window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY })));

    expect(screen.getByText("You marked Going")).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("ignores unrelated storage events", () => {
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "message-1": "going" }));

    act(() => window.dispatchEvent(new StorageEvent("storage", { key: "different-key" })));

    expect(screen.queryByText("You marked Going")).not.toBeInTheDocument();
  });

  it.runIf(supabaseMode)("does not persist success when the RPC fails and permits a retry", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: null, error: { message: "RSVP denied" } });
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Couldn't save RSVP",
      description: "RSVP denied",
      variant: "destructive",
    }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Going" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledTimes(2));
  });

  it.runIf(supabaseMode)("reports an idempotent response when the server says no row was inserted", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ inserted_count: 0 }], error: null });
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "You've already RSVP'd for this event",
      description: undefined,
    }));
    expect(screen.getByText("You marked Going")).toBeInTheDocument();
  });

  it.runIf(supabaseMode)("explains when the RPC updates the member and their children", async () => {
    mocks.rpc.mockResolvedValue({ data: [{ inserted_count: 3 }], error: null });
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Marked Going",
      description: "Updated 3 responses (you + kids).",
    }));
  });

  it("opens the exact event after a stored response", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ "message-1": "going" }));
    render(<InlineRsvpActions eventId="event-42" messageId="message-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Open event" }));
    expect(mocks.navigate).toHaveBeenCalledWith("/events/event-42");
  });

  it("removes its cross-tab listener when unmounted", () => {
    const remove = vi.spyOn(window, "removeEventListener");
    const { unmount } = render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    unmount();

    expect(remove).toHaveBeenCalledWith("storage", expect.any(Function));
  });

  it.runIf(!supabaseMode)("saves an ICP self-RSVP and note through the events canister", async () => {
    render(<InlineRsvpActions eventId="event-icp" messageId="message-icp" />);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    await waitFor(() => expect(mocks.setLiveEventRsvp).toHaveBeenCalledWith(
      mocks.context,
      "event-icp",
      "11111111-1111-4111-8111-111111111111",
      "going",
    ));
    expect(screen.getByText("You marked Going")).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Add a note" }));
    fireEvent.click(await screen.findByRole("button", { name: "Save note" }));
    await waitFor(() => expect(mocks.setLiveRsvpNote).toHaveBeenCalledWith(
      mocks.context,
      "event-icp",
      "11111111-1111-4111-8111-111111111111",
      "I'll be there",
    ));
    expect(mocks.from).not.toHaveBeenCalled();
    expect(mocks.getUser).not.toHaveBeenCalled();
  });

  it.runIf(!supabaseMode).each([
    ["Going", "going"],
    ["Maybe", "maybe"],
    ["Can't", "not_going"],
  ] as const)("submits the ICP %s response for the exact event", async (label, status) => {
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    fireEvent.click(screen.getByRole("button", { name: label }));

    await waitFor(() => expect(mocks.setLiveEventRsvp).toHaveBeenCalledWith(
      mocks.context,
      "event-1",
      "11111111-1111-4111-8111-111111111111",
      status,
    ));
    expect(screen.getByText(`You marked ${label}`)).toBeInTheDocument();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.runIf(!supabaseMode)("disables other ICP responses and prevents a duplicate while a canister write is pending", async () => {
    let complete!: () => void;
    mocks.setLiveEventRsvp.mockImplementationOnce(() => new Promise<void>((resolve) => {
      complete = resolve;
    }));
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Going" }));
    expect(screen.getByRole("button", { name: "Going" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Maybe" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Can't" })).toBeDisabled();
    expect(mocks.setLiveEventRsvp).toHaveBeenCalledOnce();
    complete();

    expect(await screen.findByText("You marked Going")).toBeInTheDocument();
    expect(mocks.setLiveEventRsvp).toHaveBeenCalledOnce();
  });

  it.runIf(!supabaseMode)("does not persist a denied ICP RSVP and allows a retry", async () => {
    mocks.setLiveEventRsvp.mockRejectedValueOnce(new Error("RSVP denied"));
    render(<InlineRsvpActions eventId="event-1" messageId="message-1" />);
    fireEvent.click(screen.getByRole("button", { name: "Going" }));

    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith({
      title: "Couldn't save RSVP",
      description: "RSVP denied",
      variant: "destructive",
    }));
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.getByRole("button", { name: "Maybe" })).toBeEnabled();

    fireEvent.click(screen.getByRole("button", { name: "Maybe" }));
    await waitFor(() => expect(mocks.setLiveEventRsvp).toHaveBeenCalledTimes(2));
    expect(await screen.findByText("You marked Maybe")).toBeInTheDocument();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!)).toEqual({ "message-1": "maybe" });
  });
});
