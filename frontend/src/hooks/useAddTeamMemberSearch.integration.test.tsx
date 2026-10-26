import {beforeEach,describe,expect,it,vi} from "vitest";
import {renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
const mocks=vi.hoisted(()=>({search:vi.fn(),route:vi.fn(),pending:vi.fn(),roles:vi.fn(),teams:vi.fn()}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:"viewer"}})}));
vi.mock("@/live/featureRouter",()=>({withFeatureBackend:mocks.route}));
vi.mock("@/live/loadBackendRouting",()=>({isFeatureRoutedToIcp:()=>true}));
vi.mock("@/live/features/membership",()=>({searchLiveInvitableProfiles:mocks.search,listLiveRoleGrants:mocks.roles,listLiveMembershipTeams:mocks.teams}));
vi.mock("@/live/features/club",()=>({listLivePendingInvitesByClub:mocks.pending}));
import {useAddTeamMemberSearch} from "./useAddTeamMemberSearch";
const context={target:{canisterIds:{club_domain:"original"}},identity:{}};
beforeEach(()=>{vi.clearAllMocks();mocks.search.mockResolvedValue([{id:"person",display_name:"Paul",avatar_ref:null}]);mocks.route.mockImplementation(async(_,providers)=>providers.icp(context));mocks.pending.mockResolvedValue([]);mocks.roles.mockResolvedValue([]);mocks.teams.mockResolvedValue([]);});
function mount(open=true,second=""){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {client,...renderHook(()=>useAddTeamMemberSearch({supabase:{},open,mode:"single",clubId:"club-a",teamId:"team-a",debouncedNameInput:"Paul",debouncedSecondParentSearch:second,selectedUser:null,selectedSecondParent:null,bulkMembers:[]}),{wrapper})};
}
describe("actual team member picker connection",()=>{
  it("routes the mounted picker to its exact club and forwards cancellation",async()=>{
    const mounted=mount();await waitFor(()=>expect(mounted.result.current.filteredResults[0]?.display_name).toBe("Paul"));
    expect(mocks.search).toHaveBeenCalledWith(context,"Paul",8,{clubId:"club-a",signal:expect.any(AbortSignal)});
    expect(mocks.route).toHaveBeenCalledWith("membership",expect.anything(),{clubId:"club-a"});
    expect(mounted.client.getQueryCache().getAll().some(query=>query.queryKey.includes("viewer"))).toBe(true);
  });
  it("uses the same scoped gateway for the second-parent picker",async()=>{
    mount(true,"Jane");await waitFor(()=>expect(mocks.search).toHaveBeenCalledWith(context,"Jane",5,{clubId:"club-a",signal:expect.any(AbortSignal)}));
  });
  it("does not start person searches while the picker is closed",async()=>{
    const mounted=mount(false,"Jane");await waitFor(()=>expect(mounted.result.current.filteredResults).toEqual([]));expect(mocks.search).not.toHaveBeenCalled();
  });
});