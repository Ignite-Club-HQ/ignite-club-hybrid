import { describe, expect, it, vi } from "vitest";
import { Principal } from "@icp-sdk/core/principal";
import { GROUP_DOMAINS } from "./groupRouting";
import type { FeatureBackendContext } from "./featureRouter";
import type { AccountRegistrySnapshot } from "./accountAuthorityRegistry";
import { createPrivateProfileAuthorityResolver } from "./privateProfileAuthority";

const p = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
function fixture() {
  const subnet = p(100);
  const groups = ["g1", "g2"].map((id, n) => ({ id, target_alias: "mainnet", domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canister: p(1 + n * 20 + i) })) }));
  const snapshot: AccountRegistrySnapshot = { revision: 8n, groups, placements: groups.map(group => ({ group_id: group.id, deployment_id: "ignite", deployment_revision: 3n, host: "https://icp-api.io", network_kind: "public_mainnet", primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false, domains: group.domains.map(row => ({ ...row, subnet })) })) };
  const authority = groups[1].domains.find(row => row.domain === "pii_access_control")?.canister.toText() ?? "";
  const binding = { targetAlias: "mainnet", deploymentId: "ignite", deploymentRevision: 3n, host: "https://icp-api.io", networkKind: "public_mainnet", registryRevision: 8n, requiredClubAuthorities: [groups[0].domains[0].canister.toText()] };
  const ctx = { identity: { getPrincipal: () => p(90) }, target: { alias: "mainnet", host: binding.host, networkKind: "public_mainnet", canisterIds: { pii_access_control: p(11).toText(), club_domain: p(1).toText() } } } as FeatureBackendContext;
  const read = vi.fn(async () => snapshot);
  return { ctx, snapshot, authority, binding, read, resolve: createPrivateProfileAuthorityResolver(ctx, binding, read) };
}

describe("original private-profile authority rehearsal", () => {
  it("preserves original encryption authority and identity without changing the current group", async () => {
    const f = fixture();
    const lease = await f.resolve(f.authority);
    expect(lease.context.target.canisterIds.pii_access_control).toBe(f.authority);
    expect(lease.context.identity).toBe(f.ctx.identity);
    expect(lease.context.target.canisterIds.club_domain).toBe(f.ctx.target.canisterIds.club_domain);
    expect(f.ctx.target.canisterIds.pii_access_control).not.toBe(f.authority);
    await lease.confirm();
    expect(f.read).toHaveBeenCalledTimes(2);
  });
  it("never contacts a reference authority absent from the complete registry", async () => {
    const f = fixture();
    await expect(f.resolve(p(120).toText())).rejects.toThrow("verified deployment");
  });
  it("rejects foreign deployment, incomplete inventories and unapproved subnets", async () => {
    const foreign = fixture(); foreign.snapshot.placements[1].deployment_id = "foreign";
    await expect(foreign.resolve(foreign.authority)).rejects.toThrow("Foreign");
    const missing = fixture(); missing.snapshot.placements[1].domains.pop();
    await expect(missing.resolve(missing.authority)).rejects.toThrow("Incomplete");
    const subnet = fixture(); subnet.snapshot.placements[1].domains[0].subnet = p(110);
    await expect(subnet.resolve(subnet.authority)).rejects.toThrow("Unapproved");
  });
  it("refuses ambiguous reused PII authorities across groups", async () => {
    const f = fixture();
    const original = f.snapshot.groups[0].domains[10].canister;
    f.snapshot.groups[1].domains[10].canister = original;
    f.snapshot.placements[1].domains[10].canister = original;
    await expect(f.resolve(original.toText())).rejects.toThrow("Ambiguous");
  });
  it("does not repin after inventory revision changes during decryption", async () => {
    const f = fixture(); const lease = await f.resolve(f.authority);
    f.snapshot.revision = 9n;
    await expect(lease.confirm()).rejects.toThrow("stale");
  });
  it("rejects changed domains even at an unchanged claimed revision", async () => {
    const f = fixture(); const lease = await f.resolve(f.authority);
    f.snapshot.groups[1].domains[2].canister = p(115);
    f.snapshot.placements[1].domains[2].canister = p(115);
    await expect(lease.confirm()).rejects.toThrow("inventory changed");
  });
  it("retires an opening inventory if the identity object changes", async () => {
    const f = fixture(); f.ctx.identity = { getPrincipal: () => p(90) } as FeatureBackendContext["identity"];
    await expect(f.resolve(f.authority)).rejects.toThrow("identity changed");
    expect(f.read).not.toHaveBeenCalled();
  });
  it("rejects a host change before confirming a previously resolved route", async () => {
    const f = fixture(); const lease = await f.resolve(f.authority);
    f.ctx.target.host = "https://foreign.invalid";
    await expect(lease.confirm()).rejects.toThrow("deployment");
  });
});