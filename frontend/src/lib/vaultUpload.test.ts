import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  remove: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    rpc: mocks.rpc,
    storage: { from: mocks.from },
  },
}));

import {
  buildVaultStorageUrl,
  compensateVaultUpload,
  reserveVaultStorage,
  settleVaultStorage,
  VAULT_BUCKET,
} from "./vaultUpload";

describe("vault upload safety boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("VITE_SUPABASE_URL", "http://127.0.0.1:54321/");
    mocks.from.mockReturnValue({ remove: mocks.remove });
    mocks.remove.mockResolvedValue({ error: null });
  });

  it("builds an environment-scoped encoded storage URL without a hosted project constant", () => {
    expect(buildVaultStorageUrl("clubs/club 1/report #1.pdf")).toBe(
      "http://127.0.0.1:54321/storage/v1/object/public/photos/clubs/club%201/report%20%231.pdf",
    );
  });

  it("refuses to manufacture a storage URL when the environment is not configured", () => {
    vi.stubEnv("VITE_SUPABASE_URL", "");
    expect(() => buildVaultStorageUrl("file.pdf")).toThrow("Storage is not configured");
  });

  it("does not reserve quota for an unscoped upload", async () => {
    await expect(reserveVaultStorage(null, 500)).resolves.toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("reserves the exact byte count and accepts both row and array RPC responses", async () => {
    mocks.rpc.mockResolvedValueOnce({ data: [{ reservation_id: "reservation-1" }], error: null });
    await expect(reserveVaultStorage("club-1", 1_048_576)).resolves.toBe("reservation-1");
    expect(mocks.rpc).toHaveBeenCalledWith("reserve_vault_storage", {
      _club_id: "club-1",
      _bytes: 1_048_576,
    });

    mocks.rpc.mockResolvedValueOnce({ data: { reservation_id: "reservation-2" }, error: null });
    await expect(reserveVaultStorage("club-1", 1)).resolves.toBe("reservation-2");
  });

  it("turns the server quota rejection into a stable user-facing failure", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "quota_exceeded: club limit" } });
    await expect(reserveVaultStorage("club-1", 10)).rejects.toThrow(
      "Storage limit reached. Delete files or purchase more storage.",
    );
  });

  it("propagates non-quota reservation failures instead of allowing the upload", async () => {
    const failure = { message: "permission denied", code: "42501" };
    mocks.rpc.mockResolvedValue({ data: null, error: failure });
    await expect(reserveVaultStorage("club-1", 10)).rejects.toEqual(failure);
  });

  it("settles committed and rolled-back reservations with the exact state", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    await settleVaultStorage("reservation-1", true);
    await settleVaultStorage("reservation-2", false);
    expect(mocks.rpc).toHaveBeenNthCalledWith(1, "settle_vault_storage", {
      _reservation_id: "reservation-1", _committed: true,
    });
    expect(mocks.rpc).toHaveBeenNthCalledWith(2, "settle_vault_storage", {
      _reservation_id: "reservation-2", _committed: false,
    });
  });

  it("skips settlement without a reservation and keeps cleanup best-effort", async () => {
    await settleVaultStorage(null, false);
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.remove.mockRejectedValueOnce(new Error("storage unavailable"));
    await expect(compensateVaultUpload("clubs/club-1/orphan.pdf")).resolves.toBeUndefined();
    expect(mocks.from).toHaveBeenCalledWith(VAULT_BUCKET);
    expect(mocks.remove).toHaveBeenCalledWith(["clubs/club-1/orphan.pdf"]);
  });
});
