import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ admin: true, user: true, loading: false, save: vi.fn(), text: vi.fn() }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: m.user ? { id: "ii-admin" } : null, loading: m.loading }) }));
vi.mock("@/hooks/useIsAppAdmin", () => ({ useIsAppAdmin: () => ({ isAppAdmin: m.admin, isLoading: false }) }));
vi.mock("jspdf", () => ({ jsPDF: class {
  internal = { pageSize: { getWidth: () => 210, getHeight: () => 297 } };
  addPage() {} setFontSize() {} setFont() {} text = m.text;
  setDrawColor() {} line() {} splitTextToSize(line: string) { return [line]; } save = m.save;
} }));
import Page from "./VideoGuideDownloadPage";
function open() {
  render(<MemoryRouter initialEntries={["/guide"]}><Routes><Route path="/guide" element={<Page />} /><Route path="/auth" element={<p>Sign in destination</p>} /></Routes></MemoryRouter>);
}
beforeEach(() => { vi.clearAllMocks(); m.admin = true; m.user = true; m.loading = false; });
describe("Recording guide access and downloads", () => {
  it("requires sign-in", async () => { m.user = false; open(); expect(await screen.findByText("Sign in destination")).toBeInTheDocument(); expect(m.save).not.toHaveBeenCalled(); });
  it("denies non-admins", () => { m.admin = false; open(); expect(screen.getByText("Access Denied")).toBeInTheDocument(); expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument(); });
  it("waits for sign-in restoration before showing downloads", () => { m.loading = true; open(); expect(screen.queryByRole("button", { name: /Download/ })).not.toBeInTheDocument(); });
  it("exports the recording guide as a PDF for a signed-in admin", async () => {
    open(); fireEvent.click(screen.getByRole("button", { name: "Download as PDF (.pdf)" }));
    await waitFor(() => expect(m.save).toHaveBeenCalledWith("VIDEO_RECORDING_GUIDE.pdf")); expect(m.text).toHaveBeenCalled();
  });
  it("downloads text locally without requiring a storage service", async () => {
    const create = vi.fn((_blob: Blob) => "blob:guide"); vi.stubGlobal("URL", { createObjectURL: create, revokeObjectURL: vi.fn() });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    open(); fireEvent.click(screen.getByRole("button", { name: "Download as Text (.txt)" }));
    const blob = create.mock.calls[0]?.[0]; if (!blob) throw new Error("No guide download");
    const text = await new Promise<string>(resolve => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.readAsText(blob); });
    expect(blob.type).toBe("text/plain"); expect(text.length).toBeGreaterThan(1000); expect(click).toHaveBeenCalled(); click.mockRestore();
  });
});