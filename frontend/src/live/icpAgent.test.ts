import { beforeEach, describe, expect, it, vi } from "vitest";

const createMock = vi.hoisted(() => vi.fn());

vi.mock("@icp-sdk/core/agent", () => ({
  HttpAgent: { create: createMock },
  Actor: { createActor: vi.fn() },
}));

import { clearLiveAgentCache, createLiveAgent } from "./icpAgent";
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
