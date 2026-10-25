import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ submit: vi.fn(), invoke: vi.fn(), success: vi.fn(), warning: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "member", user_metadata: {} } }) }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_: string, providers: { icp: (ctx: object) => Promise<void> }) => providers.icp({}) }));
vi.mock("@/live/features/insights", () => ({ submitLiveFeedback: mocks.submit }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { functions: { invoke: mocks.invoke }, from: vi.fn(() => { throw new Error("ICP must not insert Supabase feedback"); }) } }));
vi.mock("sonner", () => ({ toast: { success: mocks.success, warning: mocks.warning, error: vi.fn() } }));
vi.mock("@/components/ui/responsive-dialog", () => ({
  ResponsiveDialog: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveDialogContent: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveDialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  ResponsiveDialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  ResponsiveDialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
import { FeedbackDialog } from "./FeedbackDialog";
beforeEach(() => { vi.clearAllMocks(); mocks.submit.mockResolvedValue({}); mocks.invoke.mockResolvedValue({ error: null }); });
describe("ICP support feedback", () => {
  it("saves on-chain before sending through the existing support-only email workflow", async () => {
    render(<FeedbackDialog open onOpenChange={vi.fn()} gapDiagnostic="coverage events" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
    await waitFor(() => expect(mocks.invoke).toHaveBeenCalledTimes(1));
    expect(mocks.submit).toHaveBeenCalledWith({}, "bug", "Something isn’t working", expect.stringContaining("coverage events"), null);
    expect(mocks.invoke).toHaveBeenCalledWith("send-feedback-email", { body: { type: "bug", title: "Something isn’t working", description: "Support reference: coverage events", userEmail: null, userName: "Ignite member" } });
    expect(mocks.submit.mock.invocationCallOrder[0]).toBeLessThan(mocks.invoke.mock.invocationCallOrder[0]);
  });
  it("does not send email when saving feedback fails", async () => {
    mocks.submit.mockRejectedValue(new Error("denied"));
    render(<FeedbackDialog open onOpenChange={vi.fn()} gapDiagnostic="coverage events" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Submit Feedback" })).not.toBeDisabled());
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("discloses email failure without claiming delivery or retrying saved feedback", async () => {
    mocks.invoke.mockResolvedValue({ error: new Error("not configured") });
    render(<FeedbackDialog open onOpenChange={vi.fn()} gapDiagnostic="coverage events" />);
    fireEvent.click(screen.getByRole("button", { name: "Submit Feedback" }));
    await waitFor(() => expect(mocks.warning).toHaveBeenCalled());
    expect(mocks.success).not.toHaveBeenCalled();
    expect(mocks.submit).toHaveBeenCalledTimes(1);
  });
});