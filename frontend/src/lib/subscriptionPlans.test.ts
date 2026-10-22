import { describe, expect, it } from "vitest";
import { CLUB_PRICING, TEAM_PRICING, FREE_MEDIA_BYTES, CLUB_MEDIA_BYTES, TEAM_MEDIA_BYTES, clubQuote, clubProductId, effectiveTeamLimit } from "./subscriptionPlans";
describe("Approved USD subscriptions", () => {
  it.each([
    ["small",3,44.99,489,59.99,649], ["growing",5,64.99,699,84.99,929],
    ["starter",10,109.99,1199,139.99,1539], ["standard",20,209.99,2299,259.99,2849],
  ] as const)("prices %s with its exact team limit", (plan,limit,pm,pa,fm,fa) => {
    expect(CLUB_PRICING.pro[plan]).toEqual({ monthly: pm, annual: pa, teamLimit: limit });
    expect(CLUB_PRICING.proFootball[plan]).toEqual({ monthly: fm, annual: fa, teamLimit: limit });
  });
  it("prices Single Team separately", () => {
    expect(TEAM_PRICING).toEqual({ pro: { monthly:24.99, annual:269 }, proFootball:{ monthly:34.99, annual:379 } });
  });
  it("charges for team 21 without increasing storage", () => {
    expect(clubQuote("pro", "standard", 1, false)).toEqual({ currency:"USD", amount:224.99, teamLimit:21, storageBytes:3221225472 });
    expect(clubQuote("pro", "standard", 1, true).amount).toBe(2464);
    expect(clubQuote("pro_football", "standard", 1, false).amount).toBe(279.99);
    expect(clubQuote("pro_football", "standard", 1, true).amount).toBe(3069);
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