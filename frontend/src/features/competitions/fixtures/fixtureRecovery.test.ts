import {describe,it,expect} from "vitest";
import {reserveFixtureIntent,clearFixtureIntent} from "./fixtureRecovery";
describe("fixture interruption recovery",()=>{
  it("retains exact request and operation across reloads",()=>{localStorage.clear();const input={home:"h",away:"a",date:"2026-10-25"};expect(reserveFixtureIntent(localStorage,"account|g2|c",input,()=>"original").operation).toBe("original");expect(reserveFixtureIntent(localStorage,"account|g2|c",input,()=>"duplicate").operation).toBe("original")});
  it("blocks changed input until the original result is resolved",()=>{localStorage.clear();reserveFixtureIntent(localStorage,"scope",{away:"a"},()=>"original");expect(()=>reserveFixtureIntent(localStorage,"scope",{away:"b"},()=>"new")).toThrow("original fixture");clearFixtureIntent(localStorage,"scope");expect(reserveFixtureIntent(localStorage,"scope",{away:"b"},()=>"new").operation).toBe("new")});
});