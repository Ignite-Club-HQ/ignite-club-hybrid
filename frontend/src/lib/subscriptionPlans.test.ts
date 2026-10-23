import { describe, expect, it } from "vitest";
import { CLUB_PRICING, TEAM_PRICING, FREE_MEDIA_BYTES, CLUB_MEDIA_BYTES, TEAM_MEDIA_BYTES, clubQuote, clubProductId, effectiveTeamLimit, assertPurchaseCatalogReady, mediaAllowance } from "./subscriptionPlans";
describe("Approved USD subscriptions", () => {
  it.each([
    ["small",3,45,499,60,649], ["growing",5,65,699,85,899],
    ["starter",10,110,1199,140,1499], ["standard",20,210,2299,260,2799],
  ] as const)("prices %s with its exact team limit", (plan,limit,pm,pa,fm,fa) => {
    expect(CLUB_PRICING.pro[plan]).toEqual({ monthly: pm, annual: pa, teamLimit: limit });
    expect(CLUB_PRICING.proFootball[plan]).toEqual({ monthly: fm, annual: fa, teamLimit: limit });
  });
  it("prices Single Team separately", () => {
    expect(TEAM_PRICING).toEqual({ pro: { monthly:15, annual:159 }, proFootball:{ monthly:20, annual:219 } });
  });
  it("charges for team 21 without increasing storage", () => {
    expect(clubQuote("pro", "standard", 1, false)).toEqual({ currency:"USD", amount:220, teamLimit:21, storageBytes:3221225472 });
    expect(clubQuote("pro", "standard", 1, true).amount).toBe(2419);
    expect(clubQuote("pro_football", "standard", 1, false).amount).toBe(275);
    expect(clubQuote("pro_football", "standard", 1, true).amount).toBe(2979);
  });
  it("sets the three nonstacking media allowances", () => {
    expect([FREE_MEDIA_BYTES,TEAM_MEDIA_BYTES,CLUB_MEDIA_BYTES]).toEqual([262144000,1073741824,3221225472]);
  });
  it("requires paid allowance before adding team 21", () => {
    expect(effectiveTeamLimit(null)).toBe(20);
    expect(effectiveTeamLimit({ is_pro:true, team_limit:20 })).toBe(20);
    expect(effectiveTeamLimit({ is_pro:true, team_limit:21 })).toBe(21);
    expect(effectiveTeamLimit({ is_pro:true, team_limit:21, expires_at:"2020-01-01" })).toBe(20);
    expect(effectiveTeamLimit({ is_trial:true, trial_ends_at:"2099-01-01", team_limit:21 })).toBe(20);
  });
  it("binds new SKUs to the purchased total instead of legacy prices", () => {
    expect(clubProductId("pro", "standard", false,1)).toBe("ignite_v2_pro_standard_21_monthly");
    expect(() => clubQuote("pro","small",1,false)).toThrow();
    expect(() => clubQuote("pro","standard",0.5,false)).toThrow();
  });
});
it("does not charge for an unconfigured new plan", () => {
  expect(() => assertPurchaseCatalogReady("ignite_v2_pro_standard_21_monthly", [])).toThrow("not available");
  expect(() => assertPurchaseCatalogReady("ignite_v2_pro_standard_21_monthly", ["ignite_v2_pro_standard_21_monthly"])).not.toThrow();
});

it("preserves active Unlimited grants without granting unlimited to expired promos", () => {
  expect(effectiveTeamLimit({ is_pro:true, plan:"unlimited", team_limit:null })).toBe(100000);
  expect(effectiveTeamLimit({ is_pro:true, plan:"unlimited", team_limit:null, expires_at:"2020-01-01" })).toBe(20);
});
it("scopes Single Team storage and never stacks it onto club Pro", () => {
  expect(mediaAllowance(null, { is_pro:true })).toEqual({ baseBytes:1073741824, limitBytes:1073741824, teamScoped:true, premium:true });
  expect(mediaAllowance({ is_pro:true, plan:"small" }, { is_pro:true }).limitBytes).toBe(3221225472);
});
it("preserves Unlimited promo storage and enforces Free after expiry", () => {
  expect(mediaAllowance({ is_pro:true, plan:"unlimited" }).limitBytes).toBe(5368709120);
  expect(mediaAllowance({ is_pro:true, plan:"unlimited", expires_at:"2020-01-01" }).limitBytes).toBe(262144000);
});
it("keeps legacy club allowances separate from new USD purchases", () => {
  expect(mediaAllowance({ is_pro:true, plan:"standard" }).limitBytes).toBe(5368709120);
  expect(mediaAllowance({ is_pro:true, plan:"standard", pricing_version:"usd_v2" }).limitBytes).toBe(3221225472);
  expect(mediaAllowance({ is_pro:true, plan:"usd_v2_standard" }).limitBytes).toBe(3221225472);
});
it("enforces versioned ICP team bands without inheriting legacy Unlimited", () => {
  expect(effectiveTeamLimit({ is_pro:true, plan:"usd_v2_small", team_limit:21 })).toBe(3);
  expect(effectiveTeamLimit({ is_pro:true, plan:"usd_v2_growing", team_limit:21 })).toBe(5);
  expect(effectiveTeamLimit({ is_pro:true, plan:"usd_v2_starter", team_limit:21 })).toBe(10);
  expect(effectiveTeamLimit({ is_pro:true, plan:"usd_v2_standard", team_limit:20 })).toBe(20);
  expect(effectiveTeamLimit({ is_pro:true, plan:"usd_v2_standard", team_limit:21 })).toBe(21);
  expect(effectiveTeamLimit({ is_pro:true, plan:"usd_v2_standard", team_limit:3 })).toBe(20);
  expect(effectiveTeamLimit({ is_trial:true, trial_ends_at:"2099-01-01", plan:"usd_v2_standard", team_limit:21 })).toBe(20);
});
