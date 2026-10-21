import { withFeatureBackend } from "@/live/featureRouter";
import { supabase } from "@/integrations/supabase/client";
import { historyRpc } from "./history/historyRepository";
export type PlayHQMatch = {tenant?:string;external_id:string;external_home_team_id:string|null;external_away_team_id:string|null;home_team_name:string|null;away_team_name:string|null;division_id:string|null;competition_divisions:{name:string|null}|null};
export type PlayHQStat = {playhq_game_id:string;playhq_team_id:string|null;playhq_player_id:string;player_name:string|null;stats:Record<string,number>|null;tenant?:string};
export type PlayHQData = {matches:PlayHQMatch[];stats:PlayHQStat[];links:{playhq_player_id:string;mine:boolean;tenant?:string}[]};
export async function readCompetitionPlayHQ(competitionId:string):Promise<PlayHQData>{
 return withFeatureBackend("competitions",{
  supabase:async()=>{const {data,error}=await historyRpc("read_competition_playhq",{p_competition_id:competitionId});if(error)throw new Error(error.message);return data as PlayHQData;},
  icp:async(ctx)=>{const {readLiveCompetitionPlayHQ}=await import("@/live/features/competitions");return readLiveCompetitionPlayHQ(ctx,competitionId);},
 },{competitionId});
}
export async function claimCompetitionPlayHQ(competitionId:string,playerId:string,tenant="default"){
 await withFeatureBackend("competitions",{
  supabase:async()=>{const {data,error}=await supabase.auth.getUser();if(error)throw error;if(!data.user)throw new Error("Sign in to claim a player");const {error:claimError}=await supabase.from("playhq_player_links").insert({tenant,playhq_player_id:playerId,claimed_by:data.user.id,user_id:data.user.id,confirmed_at:new Date().toISOString()});if(claimError)throw claimError;},
  icp:async(ctx)=>{const {claimLiveCompetitionPlayHQ}=await import("@/live/features/competitions");await claimLiveCompetitionPlayHQ(ctx,competitionId,tenant,playerId);},
 },{competitionId,writeKey:"once",attempts:1});
}
export async function syncCompetitionPlayHQ(competitionId:string,tenant:string,grade:string){
 return withFeatureBackend("competitions",{
  supabase:async()=>{const {data,error}=await supabase.functions.invoke("playhq-sync",{body:{competition_id:competitionId,tenant,grade_id:grade}});if(error)throw error;return data;},
  icp:async(ctx)=>{const {syncLiveCompetitionPlayHQ}=await import("@/live/features/competitions");return syncLiveCompetitionPlayHQ(ctx,competitionId,tenant,grade);},
 },{competitionId,writeKey:"once",attempts:1});
}