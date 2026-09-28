import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  invoke: vi.fn(),
  success: vi.fn(),
  error: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: mocks.getSession },
    functions: { invoke: mocks.invoke },
  },
}));
vi.mock("sonner", () => ({ toast: { success: mocks.success, error: mocks.error } }));

import { ReportMessageDialog } from "./ReportMessageDialog";

function renderDialog(onClose = vi.fn()) {
  render(<ReportMessageDialog isOpen onClose={onClose} messageId="message-42" messageType="team" />);
  return { onClose };
}

function chooseReason(label = "Harassment or bullying") {
  fireEvent.click(screen.getByLabelText(label));
}

describe("ReportMessageDialog characterization — authentication and submission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getSession.mockResolvedValue({ data: { session: { user: { id: "reporter-1" } } } });
    mocks.invoke.mockResolvedValue({ data: {}, error: null });
  });

  it("cannot submit until a reason is selected", () => {
    renderDialog();
    expect(screen.getByRole("button", { name: /submit report/i })).toBeDisabled();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated report without invoking the edge function", async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null } });
    renderDialog();
    chooseReason();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("You must be logged in to report a message"));
    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("submits the immutable message identity, human-readable reason, and trimmed details", async () => {
    const { onClose } = renderDialog();
    chooseReason();
    fireEvent.change(screen.getByLabelText(/additional details/i), { target: { value: "  Repeated abuse in team chat.  " } });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send-message-report-email", {
      body: {
        messageId: "message-42",
        messageType: "team",
        reason: "Harassment or bullying",
        additionalDetails: "Repeated abuse in team chat.",
      },
    }));
    expect(mocks.success).toHaveBeenCalledWith("Report submitted successfully. Our team will review it.");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("omits blank optional details from the edge-function request", async () => {
    renderDialog();
    chooseReason("Spam or misleading");
    fireEvent.change(screen.getByLabelText(/additional details/i), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledWith("send-message-report-email", {
      body: expect.objectContaining({ additionalDetails: undefined, reason: "Spam or misleading" }),
    }));
  });

  it("keeps the dialog available and reports an edge-function rejection", async () => {
    mocks.invoke.mockResolvedValue({ data: null, error: { message: "rate limited" } });
    renderDialog();
    chooseReason();
    fireEvent.click(screen.getByRole("button", { name: /submit report/i }));

    await waitFor(() => expect(mocks.error).toHaveBeenCalledWith("Failed to submit report. Please try again."));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("resets report state when cancelled", () => {
    const { onClose } = renderDialog();
    chooseReason();
    fireEvent.change(screen.getByLabelText(/additional details/i), { target: { value: "context" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
