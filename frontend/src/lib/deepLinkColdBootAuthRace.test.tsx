import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Navigate, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  platform: "android",
  resolveLaunchUrl: null as null | ((value: { url: string } | null) => void),
  getLaunchUrl: vi.fn(),
  addListener: vi.fn(),
  genericAuthRenders: 0,
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => true,
    getPlatform: () => mocks.platform,
  },
}));

vi.mock("@capacitor/app", () => ({
  App: {
    getLaunchUrl: mocks.getLaunchUrl,
    addListener: mocks.addListener,
  },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      setSession: vi.fn(),
      exchangeCodeForSession: vi.fn(),
    },
  },
}));

const inviteUrl = "https://igniteclubhq.app/join/p/cold-email-token";

function GenericAuthScreen() {
  mocks.genericAuthRenders += 1;
  return <div>Generic authentication screen</div>;
}

describe.each(["android", "ios"] as const)("%s full cold-boot invite/Auth race", (platform) => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.platform = platform;
    mocks.genericAuthRenders = 0;
    mocks.resolveLaunchUrl = null;
    mocks.getLaunchUrl.mockReset().mockImplementation(() => new Promise((resolve) => {
      mocks.resolveLaunchUrl = resolve;
    }));
    mocks.addListener.mockResolvedValue({ remove: vi.fn() });
  });

  it("never renders generic Auth while the first email launch URL is still resolving", async () => {
    vi.resetModules();
    const [
      { initDeepLinkHandler },
      { default: AppNavigatorBridge },
      { useLaunchIntentPending },
    ] = await Promise.all([
      import("@/lib/deepLinkHandler"),
      import("@/components/AppNavigatorBridge"),
      import("@/hooks/useLaunchIntentPending"),
    ]);
    const ProtectedRoot = () => useLaunchIntentPending()
      ? <div>Native launch intent pending</div>
      : <Navigate to="/auth" replace />;

    // This is the real ordering in main.tsx: native handler initialization
    // starts first, but getLaunchUrl is asynchronous and React mounts without
    // awaiting it.
    initDeepLinkHandler();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppNavigatorBridge />
        <Routes>
          <Route path="/" element={<ProtectedRoot />} />
          <Route path="/auth" element={<GenericAuthScreen />} />
          <Route
            path="/join/p/:token"
            element={<div>Invite create-account screen with breadcrumbs</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => expect(mocks.resolveLaunchUrl).toBeTypeOf("function"));
    mocks.resolveLaunchUrl!({ url: inviteUrl });

    expect(await screen.findByText("Invite create-account screen with breadcrumbs")).toBeVisible();
    expect(screen.queryByText("Generic authentication screen")).not.toBeInTheDocument();
    // A final-route assertion alone is insufficient: the reported regression
    // is that generic Auth wins or flashes during the first cold launch.
    expect(mocks.genericAuthRenders).toBe(0);
  });

  it("does not strand the first tap on generic Auth after a transient launch-URL read failure", async () => {
    vi.resetModules();
    mocks.getLaunchUrl
      .mockReset()
      .mockRejectedValueOnce(new Error("native launch URL temporarily unavailable"))
      .mockResolvedValueOnce({ url: inviteUrl });
    const [
      { initDeepLinkHandler },
      { default: AppNavigatorBridge },
      { useLaunchIntentPending },
    ] = await Promise.all([
      import("@/lib/deepLinkHandler"),
      import("@/components/AppNavigatorBridge"),
      import("@/hooks/useLaunchIntentPending"),
    ]);
    const ProtectedRoot = () => useLaunchIntentPending()
      ? <div>Native launch intent pending</div>
      : <Navigate to="/auth" replace />;

    initDeepLinkHandler();
    render(
      <MemoryRouter initialEntries={["/"]}>
        <AppNavigatorBridge />
        <Routes>
          <Route path="/" element={<ProtectedRoot />} />
          <Route path="/auth" element={<GenericAuthScreen />} />
          <Route
            path="/join/p/:token"
            element={<div>Invite create-account screen with breadcrumbs</div>}
          />
        </Routes>
      </MemoryRouter>,
    );

    // A robust cold-start handoff must retry/retain the launch intent rather
    // than requiring the recipient to tap the email a second time.
    expect(await screen.findByText(
      "Invite create-account screen with breadcrumbs",
      {},
      { timeout: 1_000 },
    )).toBeVisible();
    expect(mocks.getLaunchUrl).toHaveBeenCalledTimes(2);
    expect(mocks.genericAuthRenders).toBe(0);
  });
});
