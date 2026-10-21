import { beforeEach,expect,it,vi } from "vitest";
const mocks=vi.hoisted(()=>({mode:process.env.IGNITE_TEST_BACKEND_MODE??"supabase",rpc:vi.fn(),events:vi.fn(),stats:vi.fn(),result:vi.fn()}));
vi.mock("@/integrations/supabase/client",()=>({supabase:{rpc:mocks.rpc}}));
vi.mock("@/live/featureRouter",()=>({withFeatureBackend:(_:string,p:any)=>mocks.mode==="icp"?p.icp({}):p.supabase()}));
vi.mock("@/live/features/events",()=>({listLiveEvents:mocks.events,listLiveGamePlayerStats:mocks.stats,getLiveGameResult:mocks.result}));
import {readReportPlayerStats} from "./reportRepository";
beforeEach(()=>vi.clearAllMocks());
it("retains authorized playing time without reintroducing protected goals",async()=>{
 mocks.rpc.mockResolvedValue({data:[{minutes_played:12,goals_scored:null}],error:null});
 mocks.events.mockResolvedValue([{id:"game",event_type:"game",deleted:false,starts_at_ms:1000n},{id:"training",event_type:"training",deleted:false,starts_at_ms:1000n}]);
 mocks.stats.mockResolvedValue([{minutes_played:12,goals_scored:0,substitutions_count:1,user_id:[],fill_in_player_name:[],jersey_number:[]}]);
 mocks.result.mockResolvedValue([{scores_hidden:true}]);
 const rows=await readReportPlayerStats("team",undefined,{from:new Date(0),to:new Date(2000)});
 expect(rows).toHaveLength(1);expect(rows[0].minutes_played).toBe(12);
 expect(rows[0].goals_scored).toBeNull();
 if(mocks.mode==="icp")expect(mocks.stats).toHaveBeenCalledTimes(1);
});
it("propagates authorization denial rather than returning empty report totals",async()=>{
 mocks.rpc.mockResolvedValue({data:null,error:{message:"Forbidden"}});
 mocks.stats.mockRejectedValue(new Error("Forbidden"));
 await expect(readReportPlayerStats("team","game")).rejects.toThrow("Forbidden");
});