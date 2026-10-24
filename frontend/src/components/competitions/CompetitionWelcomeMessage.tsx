import { useQuery } from "@tanstack/react-query";
import { withFeatureBackend } from "@/live/featureRouter";
import { resolveAuthBackend } from "@/live/authBackendMode";
import {useAuth} from "@/hooks/useAuth";

export function CompetitionWelcomeMessage({competitionId}:{competitionId:string}) {
  const {user}=useAuth();
  const {data}=useQuery({queryKey:["competition-welcome-message",user?.id,competitionId],enabled:resolveAuthBackend()==="icp" && Boolean(user),queryFn:()=>withFeatureBackend("competitions",{supabase:async()=>null,icp:async ctx=>{
    const [{connectLiveCompetitionDomain},{unwrapCandid}]=await Promise.all([import("@/live/domains"),import("@/live/features/candid")]);
    const {actor}=await connectLiveCompetitionDomain(ctx.target,ctx.identity);
    const rows=await unwrapCandid(actor.read_competition_welcome_message(competitionId),"Read competition welcome");return rows[0]??null;
  }},{competitionId})});
  if(!data?.message)return null;
  return <section className="border-b border-border py-4"><h2 className="text-base font-semibold">{data.subject}</h2><p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{data.message}</p></section>;
}