import {afterEach,describe,expect,it,vi} from "vitest";
import {privateProfileSearchRehearsalEnabled} from "./privateProfileSearchMode";
afterEach(()=>vi.unstubAllEnvs());
describe("private search release separation",()=>{
  it("does not activate encrypted search by default",()=>{
    vi.stubEnv("IGNITE_LIVE_PRIVATE_PROFILE_SEARCH_REHEARSAL","");
    expect(privateProfileSearchRehearsalEnabled()).toBe(false);
  });
  it("permits only explicitly enabled local rehearsal",()=>{
    vi.stubEnv("IGNITE_LIVE_PRIVATE_PROFILE_SEARCH_REHEARSAL","1");
    expect(privateProfileSearchRehearsalEnabled()).toBe(["localhost","127.0.0.1","[::1]"].includes(window.location.hostname));
  });
});