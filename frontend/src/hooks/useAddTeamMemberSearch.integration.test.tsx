import {beforeEach,describe,expect,it,vi} from "vitest";
import {renderHook,waitFor} from "@testing-library/react";
import {QueryClient,QueryClientProvider} from "@tanstack/react-query";
import type {ReactNode} from "react";
const mocks=vi.hoisted(()=>({search:vi.fn(),route:vi.fn(),pending:vi.fn(),roles:vi.fn(),teams:vi.fn(),roster:vi.fn(),names:vi.fn()}));
vi.mock("@/live/messagingCandidates",()=>({fetchLiveMessagingCandidates:mocks.roster}));
vi.mock("@/live/clubScopedNames",()=>({unlockClubScopedNames:mocks.names}));
vi.mock("@/hooks/useAuth",()=>({useAuth:()=>({user:{id:"viewer"}})}));
vi.mock("@/live/featureRouter",()=>({withFeatureBackend:mocks.route}));
vi.mock("@/live/loadBackendRouting",()=>({isFeatureRoutedToIcp:()=>true}));
vi.mock("@/live/features/membership",()=>({searchLiveInvitableProfiles:mocks.search,listLiveRoleGrants:mocks.roles,listLiveMembershipTeams:mocks.teams}));
vi.mock("@/live/features/club",()=>({listLivePendingInvitesByClub:mocks.pending}));
import {useAddTeamMemberSearch} from "./useAddTeamMemberSearch";
const context={target:{canisterIds:{club_domain:"original"}},identity:{}};
beforeEach(()=>{vi.clearAllMocks();mocks.search.mockResolvedValue([{id:"person",display_name:"Paul",avatar_ref:null}]);mocks.route.mockImplementation(async(_,providers)=>providers.icp(context));mocks.pending.mockResolvedValue([]);mocks.roles.mockResolvedValue([]);mocks.teams.mockResolvedValue([]);mocks.roster.mockResolvedValue([{id:"person",display_name:"perso…abcd",avatar_url:null},{id:"other",display_name:"other…wxyz",avatar_url:null}]);mocks.names.mockResolvedValue(new Map([["person","Paul"],["other","Jane"]]));});
function mount(open=true,second="",name="Paul"){
  const client=new QueryClient({defaultOptions:{queries:{retry:false}}});
  const wrapper=({children}:{children:ReactNode})=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return {client,...renderHook(()=>useAddTeamMemberSearch({supabase:{},open,mode:"single",clubId:"club-a",teamId:"team-a",debouncedNameInput:name,debouncedSecondParentSearch:second,selectedUser:null,selectedSecondParent:null,bulkMembers:[]}),{wrapper})};
}
describe("actual team member picker connection",()=>{
  it("lists everyone in the exact club straight away, then filters by unlocked name on the device",async()=>{
    const all=mount(true,"","");
    await waitFor(()=>expect(all.result.current.clubPeople.map(p=>p.display_name)).toEqual(["Jane","Paul"]));
    expect(mocks.roster).toHaveBeenCalledWith(context,["club-a"]);
    expect(mocks.route).toHaveBeenCalledWith("membership",expect.anything(),{clubId:"club-a"});
    const typed=mount(true,"","pau");
    await waitFor(()=>expect(typed.result.current.filteredResults.map(p=>p.id)).toEqual(["person"]));
    expect(mocks.search).not.toHaveBeenCalledWith(context,"pau",expect.anything(),expect.anything());
  });
  it("uses the same scoped gateway for the second-parent picker",async()=>{
    mount(true,"Jane");await waitFor(()=>expect(mocks.search).toHaveBeenCalledWith(context,"Jane",5,{clubId:"club-a",signal:expect.any(AbortSignal)}));
  });
  it("does not start person searches while the picker is closed",async()=>{
    const mounted=mount(false,"Jane");await waitFor(()=>expect(mounted.result.current.filteredResults).toEqual([]));expect(mocks.search).not.toHaveBeenCalled();
  });
});