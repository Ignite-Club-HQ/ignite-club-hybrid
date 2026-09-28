import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  native: true,
  platform: "android",
  launchUrl: null as null | { url: string },
  urlOpenHandler: null as null | ((event: { url: string }) => void | Promise<void>),
  getLaunchUrl: vi.fn(),
  addListener: vi.fn(),
  setSession: vi.fn(),
  exchangeCodeForSession: vi.fn(),
}));

vi.mock("@capacitor/core", () => ({
  Capacitor: {
    isNativePlatform: () => mocks.native,
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
      setSession: mocks.setSession,
      exchangeCodeForSession: mocks.exchangeCodeForSession,
    },
  },
}));

const inviteUrl = "https://igniteclubhq.app/join/p/cold-email-token";
const invitePath = "/join/p/cold-email-token";
const signupInvitePath = `${invitePath}?mode=signup`;

async function loadHandler(platform: "android" | "ios", launchUrl: string | null) {
  vi.resetModules();
  mocks.native = true;
  mocks.platform = platform;
  mocks.launchUrl = launchUrl ? { url: launchUrl } : null;
  mocks.getLaunchUrl.mockResolvedValue(mocks.launchUrl);
  mocks.addListener.mockImplementation((event: string, handler: typeof mocks.urlOpenHandler) => {
    if (event === "appUrlOpen") mocks.urlOpenHandler = handler;
    return Promise.resolve({ remove: vi.fn() });
  });

  const navigator = await import("@/lib/appNavigator");
  const deepLinks = await import("@/lib/deepLinkHandler");
  return { navigator, deepLinks };
}

async function settleLaunchUrl() {
  await vi.waitFor(() => expect(mocks.getLaunchUrl).toHaveBeenCalledOnce());
  await Promise.resolve();
  await Promise.resolve();
}

describe.each(["android", "ios"] as const)("%s emailed invite native entry", (platform) => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    mocks.urlOpenHandler = null;
    mocks.setSession.mockResolvedValue({ data: { user: null }, error: null });
    mocks.exchangeCodeForSession.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("queues the first cold-start email tap until Router mounts, then opens the invite—not generic Auth", async () => {
    const { navigator, deepLinks } = await loadHandler(platform, inviteUrl);
    const navigate = vi.fn();

    deepLinks.initDeepLinkHandler();
    await settleLaunchUrl();

    expect(navigator.getPendingNavigation()).toEqual({ path: signupInvitePath, opts: undefined });
    expect(navigator.getPendingNavigation()?.path).not.toBe("/auth");

    navigator.setAppNavigator(navigate);
    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(signupInvitePath, undefined);
  });

  it("opens the invite immediately from a warm email tap and never detours through Auth", async () => {
    const { navigator, deepLinks } = await loadHandler(platform, null);
    const navigate = vi.fn();
    navigator.setAppNavigator(navigate);
    deepLinks.initDeepLinkHandler();
    await settleLaunchUrl();

    expect(mocks.urlOpenHandler).toBeTypeOf("function");
    await mocks.urlOpenHandler!({ url: inviteUrl });

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(signupInvitePath, undefined);
    expect(navigate).not.toHaveBeenCalledWith("/auth", expect.anything());
  });

  it("processes only one route when the OS delivers launchUrl and appUrlOpen for the same tap", async () => {
    const { navigator, deepLinks } = await loadHandler(platform, inviteUrl);
    const navigate = vi.fn();
    navigator.setAppNavigator(navigate);
    deepLinks.initDeepLinkHandler();
    await settleLaunchUrl();

    await mocks.urlOpenHandler!({ url: inviteUrl });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenLastCalledWith(signupInvitePath, undefined);
  });

  it("allows a genuine later tap on the same email invite after the user has navigated away", async () => {
    let now = 1_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { navigator, deepLinks } = await loadHandler(platform, null);
    const navigate = vi.fn();
    navigator.setAppNavigator(navigate);
    deepLinks.initDeepLinkHandler();
    await settleLaunchUrl();

    await mocks.urlOpenHandler!({ url: inviteUrl });
    expect(navigate).toHaveBeenLastCalledWith(signupInvitePath, undefined);

    // Represent the user leaving the invite route before tapping the same
    // email link again. The second OS open is a new user action, not the
    // launchUrl/appUrlOpen double-delivery from one cold launch.
    navigate("/home");
    now += 4_001;
    navigate.mockClear();
    await mocks.urlOpenHandler!({ url: inviteUrl });

    expect(navigate).toHaveBeenCalledOnce();
    expect(navigate).toHaveBeenCalledWith(signupInvitePath, undefined);
  });
});
