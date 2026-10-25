import {beforeEach,describe,it,expect,vi} from "vitest";
const mocks=vi.hoisted(()=>({result:vi.fn(),stats:vi.fn()}));
vi.mock("@/live/authBackendMode",()=>({resolveAuthBackend:()=>"icp"}));
vi.mock("@/live/featureRouter",()=>({withFeatureBackend:(_:string,p:{icp:(ctx:object)=>unknown})=>p.icp({})}));
vi.mock("@/live/features/club",()=>({getLiveTeam:async()=>[{club_id:"club"}]}));
vi.mock("@/live/features/events",()=>({listLiveEvents:async()=>[{id:"game",title:"Game",event_type:"game",deleted:false,starts_at_ms:1n,opponent:[]}],getLiveGameResult:mocks.result,getLivePlayerStatsReport:async()=>[],listLiveDetailedGamePlayerStats:mocks.stats,readLiveEventHonours:async()=>({captains:[{ref_kind:"child",ref_id:"child"}],goalkeepers:[]})}));
vi.mock("@/live/features/identityAccessClient",()=>({listLiveProfilesByIds:async()=>[]}));
vi.mock("@/live/features/vault",()=>({resolveLivePiiTextBatch:async()=>new Map([["child","Private name"]])}));
import {fetchReportExtras,reportedGoalkeeperMatches} from "./playerStatsReportExtras";
describe("production goalkeeper report parity",()=>{
  it("counts appointments when position tracking was not recorded",()=>{
    expect(reportedGoalkeeperMatches({gkMatches:0,gkAppointed:3})).toBe(3);
  });
  it("does not add appointment and appearance counts for the same report",()=>{
    expect(reportedGoalkeeperMatches({gkMatches:4,gkAppointed:3})).toBe(4);
  });
});
describe("ICP exact-event report details",()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.stats.mockResolvedValue([{user_id:[],child_id:"child",positions_played:["GK"],position_minutes:{GK:120},goals_scored:2}]);});
  it("uses optional scores, exact child honours and recorded position seconds",async()=>{
    mocks.result.mockResolvedValue([{home_score:[2],away_score:[1],scores_hidden:false,mvp_player_name:[],period_scores_json:'[{"home":2,"away":1}]',player_stats_json:'[{"id":"child","name":"Private name","goals":2}]'}]);
    const result=await fetchReportExtras("team",{eventId:"game"});
    expect(result.matches[0].homeScore).toBe(2);expect(result.matches[0].captainNames).toEqual(["Private name"]);expect(result.honours["c:child"].gkSeconds).toBe(120);expect(result.honours["c:child"].gkMatches).toBe(1);expect(result.scorersByPlayer.child.goals).toBe(2);
  });
  it("does not reconstruct protected scores or scorer totals",async()=>{
    mocks.result.mockResolvedValue([{home_score:[],away_score:[],scores_hidden:true,mvp_player_name:[],period_scores_json:'[{"home":2,"away":1}]',player_stats_json:'[{"id":"child","name":"Private name","goals":2}]'}]);
    const result=await fetchReportExtras("team",{eventId:"game"});expect(result.matches[0].homeScore).toBeNull();expect(result.matches[0].scorers).toEqual([]);expect(result.matches[0].periodScores).toEqual([]);expect(result.matches[0].playerGoals).toBe(0);
  });
});