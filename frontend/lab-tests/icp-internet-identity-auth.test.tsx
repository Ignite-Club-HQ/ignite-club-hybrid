import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import { IcpAuthProvider, useAuth } from "../src/hooks/useAuth";
import {
  resetInternetIdentityAuthForTests,
  setInternetIdentityAccountProvisionerForTests,
  setInternetIdentityAuthClientFactoryForTests,
} from "../src/lab/internetIdentityAuth";

const rootKey = "00".repeat(133);
const userPrincipal = Principal.fromText("2ibo7-dia");
const identity = { getPrincipal: () => userPrincipal } as any;

function Harness() {
  const auth = useAuth();
  const signIn = async () => {
    await auth.signInWithGoogle();
  };
  return (
    <div>
      <p data-testid="principal">{auth.user?.id ?? "signed-out"}</p>
      <p data-testid="restoration">{auth.sessionRestoration}</p>
      <button type="button" onClick={signIn}>Sign in</button>
      <button type="button" onClick={() => void auth.signOut()}>Sign out</button>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
  resetInternetIdentityAuthForTests();
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    if (url.endsWith("/icp/api/v2/lab-config")) {
      return new Response(JSON.stringify({
        network: "local",
        canisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
        identityAccessCanisterId: "rrkah-fqaaa-aaaaa-aaaaq-cai",
        internetIdentityCanisterId: "rdmx6-jaaaa-aaaaa-aaadq-cai",
        internetIdentityAuthorizeUrl: "http://id.ai.localhost:4943/authorize",
        rootKey,
      }), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`Unexpected network request: ${url}`);
  }) as typeof fetch;
});

afterEach(() => {
  cleanup();
  localStorage.clear();
  resetInternetIdentityAuthForTests();
});

describe("ICP Internet Identity auth provider", () => {
  it("signs in with local Internet Identity and provisions the signed principal", async () => {
    const signIn = vi.fn(async () => identity);
    const signOut = vi.fn(async () => {});
    const provision = vi.fn(async () => {});
    let providerCanister = "";

    setInternetIdentityAuthClientFactoryForTests((options) => {
      providerCanister = options.identityProvider.canisterId;
      return {
        isAuthenticated: () => false,
        getIdentity: async () => identity,
        signIn,
        signOut,
        dispose: vi.fn(),
      };
    });
    setInternetIdentityAccountProvisionerForTests(provision);

    render(<IcpAuthProvider><Harness /></IcpAuthProvider>);

    expect(screen.getByTestId("principal").textContent).toBe("signed-out");
    expect(screen.getByTestId("restoration").textContent).toBe("signed_out");

    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(screen.getByTestId("principal").textContent).toBe(userPrincipal.toText()));
    expect(providerCanister).toBe("rdmx6-jaaaa-aaaaa-aaadq-cai");
    expect(signIn).toHaveBeenCalledWith({ returnTo: "/" });
    expect(provision).toHaveBeenCalledWith(identity, userPrincipal.toText());
    expect(JSON.parse(localStorage.getItem("ignite_icp_internet_identity_session") ?? "{}")).toEqual({
      principal: userPrincipal.toText(),
      provider: "internet-identity",
    });

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByTestId("principal").textContent).toBe("signed-out"));
    expect(signOut).toHaveBeenCalled();
  });

  it("rejects anonymous Internet Identity sessions instead of authenticating", async () => {
    const anonymousIdentity = { getPrincipal: () => Principal.anonymous() } as any;
    setInternetIdentityAuthClientFactoryForTests(() => ({
      isAuthenticated: () => false,
      getIdentity: async () => anonymousIdentity,
      signIn: async () => anonymousIdentity,
      signOut: async () => {},
    }));
    setInternetIdentityAccountProvisionerForTests(vi.fn(async () => {}));

    let error: Error | null = null;
    function FailureHarness() {
      const auth = useAuth();
      return <button type="button" onClick={async () => { error = (await auth.signInWithGoogle()).error; }}>Sign in</button>;
    }

    render(<IcpAuthProvider><FailureHarness /></IcpAuthProvider>);
    fireEvent.click(screen.getByRole("button", { name: "Sign in" }));

    await waitFor(() => expect(error?.message).toMatch(/anonymous principal/i));
    expect(localStorage.getItem("ignite_icp_internet_identity_session")).toBeNull();
  });
});
