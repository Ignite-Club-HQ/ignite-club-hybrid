/**
 * Regression tests for AccountPage — covers session validation guards on
 * `delete-account` and `export-user-data` and safe download/cleanup on
 * export.
 */

import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, fireEvent, act } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
const icp = vi.hoisted(() => ({ identity: vi.fn(), erase: vi.fn(), export: vi.fn() }));
vi.mock("@/live/internetIdentityAuth", () => ({ getCurrentInternetIdentity: icp.identity }));
vi.mock("@/live/accountData", () => ({ eraseMyIcpAccount: icp.erase, exportMyIcpAccountData: icp.export }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase" }));

// ---- mocks ----------------------------------------------------------------
const toastFn = vi.fn();
vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastFn }),
}));

const signOutFn = vi.fn();
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" }, signOut: signOutFn }),
}));

let getSessionResult: { data: { session: any }; error: any } = {
  data: { session: { access_token: "valid-token" } },
  error: null,
};
const invokeFn = vi.fn();

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: { getSession: () => Promise.resolve(getSessionResult) },
    functions: { invoke: (...args: any[]) => invokeFn(...args) },
  },
}));

vi.mock("@/lib/safeOpenUrl", () => ({ safeOpenUrl: vi.fn() }));

// Stub fetch for the export endpoint.
const fetchFn = vi.fn();
(global as any).fetch = fetchFn;

// Stub URL.createObjectURL / revokeObjectURL
const createUrlFn = vi.fn(() => "blob:mock");
const revokeUrlFn = vi.fn();
(global as any).URL.createObjectURL = createUrlFn;
(global as any).URL.revokeObjectURL = revokeUrlFn;

import AccountPage from "./AccountPage";

const setHref = (relative: string) => {
  const url = new URL(relative, "http://localhost");
  if (!url.searchParams.has("backend")) url.searchParams.set("backend", "supabase");
  window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
};

function renderPage() {
  setHref("/account");
  return render(
    <MemoryRouter>
      <AccountPage />
    </MemoryRouter>
  );
}

beforeEach(() => {
  icp.identity.mockReset();
  icp.erase.mockReset();
  icp.export.mockReset();
  toastFn.mockReset();
  invokeFn.mockReset();
  signOutFn.mockReset();
  fetchFn.mockReset();
  createUrlFn.mockClear();
  revokeUrlFn.mockClear();
  getSessionResult = {
    data: { session: { access_token: "valid-token" } },
    error: null,
  };
});

const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";

describe.runIf(!supabaseMode)("AccountPage — ICP erasure", () => {
  async function confirmDeletion() {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Delete My Account$/ }));
    fireEvent.click(await screen.findByRole("button", { name: /yes, delete my account/i }));
  }
  it("erases the signed-in identity and signs out only on success", async () => {
    const identity = { principal: "own" };
    icp.identity.mockResolvedValue(identity);
    icp.erase.mockResolvedValue({ note: "Identity erased; shared club records retained" });
    await confirmDeletion();
    await waitFor(() => expect(signOutFn).toHaveBeenCalledTimes(1));
    expect(icp.erase).toHaveBeenCalledWith(identity);
    expect(invokeFn).not.toHaveBeenCalled();
  });
  it("does not erase or sign out when the identity is unavailable", async () => {
    icp.identity.mockResolvedValue(null);
    await confirmDeletion();
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Session expired" })));
    expect(icp.erase).not.toHaveBeenCalled();
    expect(signOutFn).not.toHaveBeenCalled();
    expect(invokeFn).not.toHaveBeenCalled();
  });
  it("keeps the user signed in when canister erasure is denied", async () => {
    icp.identity.mockResolvedValue({ principal: "own" });
    icp.erase.mockRejectedValue(new Error("Erasure denied"));
    await confirmDeletion();
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Failed to erase account" })));
    expect(signOutFn).not.toHaveBeenCalled();
  });
});

describe.runIf(!supabaseMode)("AccountPage — ICP data export", () => {
  async function clickExport() {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /download my data/i }));
  }

  it("exports caller-scoped data as JSON and revokes the download URL", async () => {
    const identity = { principal: "own" };
    icp.identity.mockResolvedValue(identity);
    icp.export.mockResolvedValue({ backend: "icp", account: { id: "account-1" } });
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    await clickExport();

    await waitFor(() => expect(icp.export).toHaveBeenCalledWith(identity));
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Data exported" })));
    expect(createUrlFn).toHaveBeenCalledTimes(1);
    expect(revokeUrlFn).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(fetchFn).not.toHaveBeenCalled();
    expect(invokeFn).not.toHaveBeenCalled();
    click.mockRestore();
  });

  it("does not export or download when the identity is unavailable", async () => {
    icp.identity.mockResolvedValue(null);
    await clickExport();
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Session expired" })));
    expect(icp.export).not.toHaveBeenCalled();
    expect(createUrlFn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("reports export failures without creating a download", async () => {
    icp.identity.mockResolvedValue({ principal: "own" });
    icp.export.mockRejectedValue(new Error("Export denied"));
    await clickExport();
    await waitFor(() => expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Export failed", variant: "destructive" })));
    expect(createUrlFn).not.toHaveBeenCalled();
    expect(revokeUrlFn).not.toHaveBeenCalled();
    expect(signOutFn).not.toHaveBeenCalled();
  });

  it("revokes the object URL when starting the download throws", async () => {
    icp.identity.mockResolvedValue({ principal: "own" });
    icp.export.mockResolvedValue({ backend: "icp" });
    const append = document.body.appendChild.bind(document.body);
    const spy = vi.spyOn(document.body, "appendChild").mockImplementation(((node: any) => {
      if (node?.tagName === "A") throw new Error("download failed");
      return append(node);
    }) as any);

    await clickExport();

    await waitFor(() => expect(createUrlFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(revokeUrlFn).toHaveBeenCalledTimes(1));
    expect(toastFn).toHaveBeenCalledWith(expect.objectContaining({ title: "Export failed", variant: "destructive" }));
    spy.mockRestore();
  });
});

// ============================================================================
// DELETE ACCOUNT
// ============================================================================
describe.runIf(supabaseMode)("AccountPage — delete account session validation", () => {
  async function clickDeleteAndConfirm() {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /^Delete My Account$/ }));
    const confirm = await screen.findByRole("button", {
      name: /yes, delete my account/i,
    });
    fireEvent.click(confirm);
  }


  it("valid session sends the exact bearer token and signs out on valid deletionDate", async () => {
    invokeFn.mockResolvedValue({
      data: { deletionDate: new Date(Date.now() + 30 * 86400_000).toISOString() },
      error: null,
    });
    await clickDeleteAndConfirm();
    await waitFor(() => expect(invokeFn).toHaveBeenCalledTimes(1));
    expect(invokeFn).toHaveBeenCalledWith(
      "delete-account",
      expect.objectContaining({
        headers: { Authorization: "Bearer valid-token" },
      })
    );
    await waitFor(() => expect(signOutFn).toHaveBeenCalledTimes(1));
  });

  it("missing session does not invoke delete-account and does not signOut", async () => {
    getSessionResult = { data: { session: null }, error: null };
    await clickDeleteAndConfirm();
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(invokeFn).not.toHaveBeenCalled();
    expect(signOutFn).not.toHaveBeenCalled();
  });

  it("undefined access token does not invoke delete-account", async () => {
    getSessionResult = { data: { session: { access_token: undefined } }, error: null };
    await clickDeleteAndConfirm();
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(invokeFn).not.toHaveBeenCalled();
    expect(signOutFn).not.toHaveBeenCalled();
  });

  it("empty and whitespace access tokens are rejected", async () => {
    for (const bad of ["", "   "]) {
      invokeFn.mockReset();
      signOutFn.mockReset();
      getSessionResult = { data: { session: { access_token: bad } }, error: null };
      const { unmount } = renderPage();
      fireEvent.click(screen.getByRole("button", { name: /^Delete My Account$/ }));
      const confirm = await screen.findByRole("button", {
        name: /yes, delete my account/i,
      });
      fireEvent.click(confirm);
      await waitFor(() => expect(toastFn).toHaveBeenCalled());
      expect(invokeFn).not.toHaveBeenCalled();
      expect(signOutFn).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("backend failure does not call signOut", async () => {
    invokeFn.mockResolvedValue({ data: null, error: { message: "boom" } });
    await clickDeleteAndConfirm();
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(signOutFn).not.toHaveBeenCalled();
  });

  it("invalid deletionDate string is rejected and does not signOut", async () => {
    invokeFn.mockResolvedValue({ data: { deletionDate: "not-a-date" }, error: null });
    await clickDeleteAndConfirm();
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );
    expect(signOutFn).not.toHaveBeenCalled();
  });

  it("missing deletionDate is rejected and does not signOut", async () => {
    invokeFn.mockResolvedValue({ data: {}, error: null });
    await clickDeleteAndConfirm();
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(signOutFn).not.toHaveBeenCalled();
  });

  it("failure re-enables the trigger button (guard resets on error)", async () => {
    invokeFn.mockResolvedValue({ data: null, error: { message: "boom" } });
    await clickDeleteAndConfirm();
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    // Trigger button should be back to its enabled "Delete My Account" label.
    const triggers = await screen.findAllByRole("button", {
      name: /^Delete My Account$/,
    });
    expect((triggers[0] as HTMLButtonElement).disabled).toBe(false);
  });
});

// ============================================================================
// EXPORT DATA
// ============================================================================
describe.runIf(supabaseMode)("AccountPage — export data session validation", () => {
  async function clickExport() {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /download my data/i }));
  }

  function zipResponse(size = 42) {
    const blob = new Blob([new Uint8Array(size)], { type: "application/zip" });
    return {
      ok: true,
      status: 200,
      headers: { get: (h: string) => (h.toLowerCase() === "content-type" ? "application/zip" : null) },
      blob: async () => blob,
      json: async () => ({}),
    } as any;
  }

  it("valid session sends the exact bearer token and creates one download", async () => {
    fetchFn.mockResolvedValue(zipResponse());
    await clickExport();
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    const [, opts] = fetchFn.mock.calls[0];
    expect(opts.headers.Authorization).toBe("Bearer valid-token");
    await waitFor(() => expect(createUrlFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(revokeUrlFn).toHaveBeenCalledTimes(1));
  });

  it("missing session does not call fetch or create a download", async () => {
    getSessionResult = { data: { session: null }, error: null };
    await clickExport();
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(fetchFn).not.toHaveBeenCalled();
    expect(createUrlFn).not.toHaveBeenCalled();
  });

  it("undefined/empty/whitespace tokens are rejected", async () => {
    for (const bad of [undefined, "", "   "]) {
      fetchFn.mockReset();
      createUrlFn.mockClear();
      getSessionResult = { data: { session: { access_token: bad } }, error: null };
      const { unmount } = renderPage();
      fireEvent.click(screen.getByRole("button", { name: /download my data/i }));
      await waitFor(() => expect(toastFn).toHaveBeenCalled());
      expect(fetchFn).not.toHaveBeenCalled();
      expect(createUrlFn).not.toHaveBeenCalled();
      unmount();
    }
  });

  it("session lookup error stops before fetch", async () => {
    getSessionResult = { data: { session: null }, error: new Error("nope") };
    await clickExport();
    await waitFor(() => expect(toastFn).toHaveBeenCalled());
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("failed export does not create a download and reports the error", async () => {
    fetchFn.mockResolvedValue({
      ok: false,
      status: 500,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "server exploded" }),
      blob: async () => new Blob([]),
    } as any);
    await clickExport();
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );
    expect(createUrlFn).not.toHaveBeenCalled();
    expect(revokeUrlFn).not.toHaveBeenCalled();
  });

  it("401 from backend is surfaced as session expired", async () => {
    fetchFn.mockResolvedValue({
      ok: false,
      status: 401,
      headers: { get: () => "application/json" },
      json: async () => ({ error: "unauth" }),
    } as any);
    await clickExport();
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Session expired",
          variant: "destructive",
        })
      )
    );
    expect(createUrlFn).not.toHaveBeenCalled();
  });

  it("unexpected content type or empty response fails safely", async () => {
    fetchFn.mockResolvedValue({
      ok: true,
      status: 200,
      headers: { get: () => "text/html" },
      blob: async () => new Blob(["<html/>"], { type: "text/html" }),
      json: async () => ({}),
    } as any);
    await clickExport();
    await waitFor(() =>
      expect(toastFn).toHaveBeenCalledWith(
        expect.objectContaining({ variant: "destructive" })
      )
    );
    // Even if URL was created before validation, it must be revoked.
    // Our implementation validates before creating, so createUrl not called.
    expect(createUrlFn).not.toHaveBeenCalled();
  });

  it("object URL is revoked even when download step throws", async () => {
    // Force appendChild to throw AFTER createObjectURL runs.
    const origAppend = document.body.appendChild.bind(document.body);
    const spy = vi
      .spyOn(document.body, "appendChild")
      .mockImplementation(((node: any) => {
        if (node?.tagName === "A") throw new Error("dom fail");
        return origAppend(node);
      }) as any);
    fetchFn.mockResolvedValue(zipResponse());
    await clickExport();
    await waitFor(() => expect(createUrlFn).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(revokeUrlFn).toHaveBeenCalledTimes(1));
    spy.mockRestore();
  });

  it("prevents duplicate export requests while one is pending", async () => {
    let resolveFetch: (v: any) => void = () => {};
    fetchFn.mockImplementation(
      () => new Promise((r) => { resolveFetch = r; })
    );
    renderPage();
    const btn = screen.getByRole("button", { name: /download my data/i });
    fireEvent.click(btn);
    // Allow the async session-check microtask to advance so setExportingData
    // has flushed before the second click.
    await Promise.resolve();
    await Promise.resolve();
    fireEvent.click(btn);
    fireEvent.click(btn);
    await waitFor(() => expect(fetchFn).toHaveBeenCalledTimes(1));
    await act(async () => {
      resolveFetch(zipResponse());
    });
  });
});

describe.runIf(!supabaseMode)("AccountPage — ICP account boundaries", () => {
  it("offers canister account actions without starting a Supabase request", () => {
    renderPage();
    expect(invokeFn).not.toHaveBeenCalled();
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
