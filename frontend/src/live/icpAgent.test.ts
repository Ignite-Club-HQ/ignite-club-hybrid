import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());
const createActorMock = vi.hoisted(() => vi.fn());

vi.mock("@icp-sdk/core/agent", () => ({
  HttpAgent: { create: createMock },
  Actor: { createActor: createActorMock },
}));

import { clearLiveAgentCache, createLiveActor, createLiveAgent, isIngressExpiryError } from "./icpAgent";
import type { IcpTargetConfig } from "./targetRegistry";
import type { Identity } from "@icp-sdk/core/agent";

function target(alias = "ic-mainnet"): IcpTargetConfig {
  return {
    provider: "icp",
    alias,
    host: "https://icp0.io",
    canisterIds: {},
  } as IcpTargetConfig;
}

function identity(principalText: string): Identity {
  return {
    getPrincipal: () => ({ toText: () => principalText }),
  } as unknown as Identity;
}

describe("createLiveAgent caching", () => {
  beforeEach(() => {
    createMock.mockReset();
    createMock.mockResolvedValue({ fake: "agent" });
    clearLiveAgentCache();
  });

  it("reuses one agent for the same target and identity", async () => {
    const id = identity("aaaaa-bb");
    const first = await createLiveAgent(target(), id);
    const second = await createLiveAgent(target(), id);
    expect(second).toBe(first);
    expect(createMock).toHaveBeenCalledTimes(1);
  });

  it("builds separate agents for different principals", async () => {
    await createLiveAgent(target(), identity("aaaaa-bb"));
    await createLiveAgent(target(), identity("ccccc-dd"));
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("builds separate agents for different targets", async () => {
    const id = identity("aaaaa-bb");
    await createLiveAgent(target("ic-mainnet"), id);
    await createLiveAgent(target("cloud-engine"), id);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("clears the cache on sign-out", async () => {
    const id = identity("aaaaa-bb");
    await createLiveAgent(target(), id);
    clearLiveAgentCache();
    await createLiveAgent(target(), id);
    expect(createMock).toHaveBeenCalledTimes(2);
  });

  it("does not cache a failed handshake", async () => {
    createMock.mockRejectedValueOnce(new Error("network down"));
    const id = identity("aaaaa-bb");
    await expect(createLiveAgent(target(), id)).rejects.toThrow("network down");
    await createLiveAgent(target(), id);
    expect(createMock).toHaveBeenCalledTimes(2);
  });
});

describe("ingress expiry recovery", () => {
  const expiryError = new Error(
    "Invalid request expiry: Specified ingress_expiry not within expected range: Minimum allowed expiry: 2026-10-24 01:46:06.033610877 UTC",
  );

  function agentWithSync() {
    const syncTime = vi.fn().mockResolvedValue(undefined);
    createMock.mockResolvedValue({ fake: "agent", syncTime });
    return syncTime;
  }

  function actorTarget(): IcpTargetConfig {
    return { ...target(), canisterIds: { messaging: "jcdfe-vqaaa-aaaal-qxloq-cai" } } as IcpTargetConfig;
  }

  async function actorFor(methods: Record<string, (...args: unknown[]) => Promise<unknown>>) {
    createActorMock.mockReturnValue(methods);
    const { actor } = await createLiveActor<Record<string, (...args: unknown[]) => Promise<unknown>>>(
      actorTarget(),
      identity("aaaaa-bb"),
      "messaging",
      "Messaging",
      vi.fn() as never,
    );
    return actor;
  }

  beforeEach(() => {
    createMock.mockReset();
    createActorMock.mockReset();
    clearLiveAgentCache();
  });

  it("recognizes the replica's expiry rejection", () => {
    expect(isIngressExpiryError(expiryError)).toBe(true);
    expect(isIngressExpiryError(new Error("Conversation access forbidden"))).toBe(false);
    expect(isIngressExpiryError("ingress_expiry not within expected range")).toBe(true);
  });

  it("re-syncs the agent clock and retries once after an expiry rejection", async () => {
    const syncTime = agentWithSync();
    const send = vi.fn().mockRejectedValueOnce(expiryError).mockResolvedValue("sent");
    const actor = await actorFor({ send_message: send });
    await expect(actor.send_message("hi")).resolves.toBe("sent");
    expect(syncTime).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("never retries a non-expiry rejection", async () => {
    const syncTime = agentWithSync();
    const denied = new Error("Conversation access forbidden");
    const send = vi.fn().mockRejectedValue(denied);
    const actor = await actorFor({ send_message: send });
    await expect(actor.send_message("hi")).rejects.toBe(denied);
    expect(syncTime).not.toHaveBeenCalled();
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("retries only once when the expiry rejection persists", async () => {
    const syncTime = agentWithSync();
    const send = vi.fn().mockRejectedValue(expiryError);
    const actor = await actorFor({ send_message: send });
    await expect(actor.send_message("hi")).rejects.toBe(expiryError);
    expect(syncTime).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("shares one in-flight re-sync across concurrent failing calls", async () => {
    let releaseSync: () => void = () => {};
    const syncTime = vi.fn().mockImplementation(() => new Promise<void>((resolve) => { releaseSync = resolve; }));
    createMock.mockResolvedValue({ fake: "agent", syncTime });
    const send = vi.fn().mockRejectedValueOnce(expiryError).mockResolvedValue("sent");
    const read = vi.fn().mockRejectedValueOnce(expiryError).mockResolvedValue("read");
    const actor = await actorFor({ send_message: send, list_messages: read });
    const first = actor.send_message("hi");
    const second = actor.list_messages();
    await vi.waitFor(() => expect(syncTime).toHaveBeenCalledTimes(1));
    releaseSync();
    await expect(first).resolves.toBe("sent");
    await expect(second).resolves.toBe("read");
    expect(syncTime).toHaveBeenCalledTimes(1);
  });
});
