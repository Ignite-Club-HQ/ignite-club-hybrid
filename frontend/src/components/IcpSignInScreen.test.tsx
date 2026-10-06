import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { IcpSignInScreen, externalChromeHref } from "./IcpSignInScreen";

const chrome = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0.0.0 Mobile Safari/537.36";
const safari = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
const props = { shellStyle: {}, onContinue: vi.fn(), busy: false, preparing: false, native: false, online: true, error: null };

afterEach(() => { cleanup(); vi.unstubAllGlobals(); sessionStorage.clear(); vi.clearAllMocks(); });
function ua(value: string) { vi.stubGlobal("navigator", { userAgent: value }); }

describe("Consumer ICP sign-in", () => {
  it.each([chrome, safari])("shows one clear action without browser warnings in a normal browser", (userAgent) => {
    ua(userAgent);
    render(<IcpSignInScreen {...props} />);
    expect(screen.getByRole("heading", { name: "Welcome to Ignite" })).toBeInTheDocument();
    expect(screen.getByText("Sign in or create your account to continue.")).toBeInTheDocument();
    expect(screen.getByText("Powered by Internet Identity")).toBeInTheDocument();
    expect(screen.getByText("New to Ignite? Just continue — we'll create your account automatically.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Browser sign-in guidance")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Continue securely" }));
    expect(props.onContinue).toHaveBeenCalledOnce();
  });
  it.each(["FBAN/Messenger", "FBAV/400", "Messenger/500", "Instagram 300", "; wv)"])("warns only when an embedded browser is detected: %s", (marker) => {
    ua(`${safari} ${marker}`);
    render(<IcpSignInScreen {...props} />);
    expect(screen.getByText("Open Ignite in your browser")).toBeInTheDocument();
    expect(screen.getByText("Secure sign-in may not work inside this app. Open this page in Chrome or Safari to continue.")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Open in browser" })).not.toBeInTheDocument();
  });
  it("does not mislabel the installed native app's WebView as an incompatible social browser", () => {
    ua(`${chrome}; wv)`);
    render(<IcpSignInScreen {...props} native />);
    expect(screen.queryByLabelText("Browser sign-in guidance")).not.toBeInTheDocument();
  });
  it("keeps the PWA action independent of standalone mode", () => {
    ua(chrome);
    vi.stubGlobal("matchMedia", () => ({ matches: true }));
    render(<IcpSignInScreen {...props} />);
    expect(screen.getByRole("button", { name: "Continue securely" })).toBeEnabled();
  });
  it("shows a simple busy state and disables repeated clicks", () => {
    ua(chrome);
    render(<IcpSignInScreen {...props} busy />);
    expect(screen.getByRole("button", { name: "Signing you in…" })).toBeDisabled();
  });
  it("keeps the primary label while the provider warms up", () => {
    ua(chrome);
    render(<IcpSignInScreen {...props} preparing />);
    expect(screen.getByRole("button", { name: "Continue securely" })).toBeDisabled();
  });
  it("preserves a storage-only invite destination in the external-browser URL", () => {
    ua(`${chrome} FBAV/400`);
    vi.stubGlobal("window", { location: { href: "https://ignite.example/auth?auth=icp&invite=token" } });
    sessionStorage.setItem("redirectAfterAuth", "/invite/token?join=1#club");
    const href = externalChromeHref();
    expect(href).toContain("package=com.android.chrome");
    expect(href).toContain("invite=token");
    expect(href).toContain("next=%2Finvite%2Ftoken%3Fjoin%3D1%23club");
  });
});