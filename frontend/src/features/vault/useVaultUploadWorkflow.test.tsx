import { act, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { useVaultUploadWorkflow } from "./useVaultUploadWorkflow";

const upload = vi.hoisted(() => vi.fn());
vi.mock("./vaultUploadService", () => ({ uploadVaultItem: upload }));
vi.mock("sonner", () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

describe("background vault uploads", () => {
  it.each(["photo", "file"] as const)("tracks an in-flight %s upload and clears it after failure", async kind => {
    let rejectUpload: ((error: Error) => void) | undefined;
    upload.mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectUpload = reject; }));
    const queryClient = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
    const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    const { result } = renderHook(() => useVaultUploadWorkflow({
      currentView: { type: "club", clubId: "club-a", clubName: "Club A" },
      getCurrentFolderId: () => "folder-a", userId: "user-a", queryClient,
    }), { wrapper });
    const file = new File(["bytes"], "document.txt", { type: "text/plain" });
    expect(result.current.uploading).toBe(false);
    await act(async () => { await result.current.handleDialogUpload(file, kind); });
    await waitFor(() => expect(result.current.uploading).toBe(true));
    expect(upload).toHaveBeenLastCalledWith(expect.objectContaining({ kind, userId: "user-a", folderId: "folder-a", file }));
    await act(async () => { rejectUpload?.(new Error("Upload denied")); });
    await waitFor(() => expect(result.current.uploading).toBe(false));
    queryClient.clear();
  });
});