import { withFeatureBackend } from "@/live/featureRouter";
import { historyRpc } from "./historyRepository";

export async function readReportPlayerStats(teamId: string, eventId?: string, range?: {from:Date;to:Date}):Promise<any[]> {
  return withFeatureBackend("events", {
    supabase:async()=>{
      const {data,error}=await historyRpc("read_history_player_stats",{p_team_id:teamId,p_event_id:eventId??null,p_from:range?.from.toISOString()??null,p_to:range?.to.toISOString()??null});
      if(error)throw new Error(error.message);return Array.isArray(data)?data:[];
    },
    icp:async(ctx)=>{
      const {listLiveEvents,listLiveGamePlayerStats,getLiveGameResult}=await import("@/live/features/events");
      const scopedEvents=await listLiveEvents(ctx,null,teamId);
      if(eventId && !scopedEvents.some(e=>e.id===eventId && e.team_id[0]===teamId && !e.deleted))throw new Error("Forbidden report event/team scope");
      const events=scopedEvents.filter(e=>e.team_id[0]===teamId && e.event_type==="game" && !e.deleted && (!eventId || e.id===eventId) && (!range || (Number(e.starts_at_ms)>=range.from.getTime()&&Number(e.starts_at_ms)<=range.to.getTime())));
      const rows:any[]=[];
      for(const event of events){
        const stats=await listLiveGamePlayerStats(ctx,event.id);
        const [result]=await getLiveGameResult(ctx,event.id);
        stats.forEach((s,index)=>rows.push({...s,id:`${event.id}-${index}`,user_id:Array.isArray(s.user_id)?s.user_id[0]??null:null,child_id:null,fill_in_player_name:s.fill_in_player_name[0]??null,jersey_number:Array.isArray(s.jersey_number)?s.jersey_number[0]??null:null,minutes_played:Number(s.minutes_played),substitutions_count:Number(s.substitutions_count),goals_scored:result?.scores_hidden?null:Number(s.goals_scored),position_minutes:null,profiles:null}));
      }
      return rows;
    },
  },{teamId});
}

export async function readReportSummary(eventId:string):Promise<any|null>{
  return withFeatureBackend("events",{
    supabase:async()=>{const {data,error}=await historyRpc("read_history_summary",{p_event_id:eventId});if(error)throw new Error(error.message);return data;},
    icp:async(ctx)=>{const {getLiveGameSummary}=await import("@/live/features/events");const [row]=await getLiveGameSummary(ctx,eventId);return row?{...row,total_game_time:Number(row.total_game_time),half_duration:Number(row.half_duration),total_substitutions:Number(row.total_substitutions),formation_used:row.formation_used[0]??null}:null;},
  },{eventId});
}

export async function readReportEvents(teamId:string):Promise<any[]>{
  return withFeatureBackend("events",{
    supabase:async()=>{const {data,error}=await historyRpc("read_history_report_events",{p_team_id:teamId});if(error)throw new Error(error.message);return Array.isArray(data)?data:[];},
    icp:async(ctx)=>{
      const {listLiveEvents}=await import("@/live/features/events");
      return (await listLiveEvents(ctx,null,teamId)).filter(e=>e.team_id[0]===teamId && e.event_type==="game" && !e.deleted)
        .sort((a,b)=>Number(b.starts_at_ms-a.starts_at_ms)).slice(0,100)
        .map(e=>({id:e.id,title:e.title,event_date:new Date(Number(e.starts_at_ms)).toISOString(),opponent:e.opponent[0]??null}));
    },
  },{teamId});
}