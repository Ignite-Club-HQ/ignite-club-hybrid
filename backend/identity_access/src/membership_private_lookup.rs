//! Caller-private bounded account aggregation, not a public endpoint yet.
//! Eligibility is refreshed by the identity authority before every page.
use candid::Principal;
use serde::{Serialize,Deserialize};
use sha2::{Digest,Sha256};
use ic_stable_structures::{Memory,StableBTreeMap};
use std::{collections::BTreeMap, ops::Bound::{Excluded,Unbounded}};
use crate::membership_materializer::Binding;
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Viewer{pub account:String,pub version:u64,pub aliases:Vec<Principal>}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Source{pub id:String,pub binding:Binding,pub complete:bool,
    /// None retains the explicit full traversal used by offline callers.
    /// Some is supplied only by the coordinator's revision-bound index.
    #[serde(default)] pub eligible_aliases:Option<Vec<Principal>>}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Cursor{
    pub viewer_digest:[u8;32],pub sources_digest:[u8;32],pub source:usize,pub alias:usize,pub after:Option<String>,
}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Row{pub club:String,pub source:String,pub authority:Principal}
#[derive(Clone,Debug,Serialize,Deserialize)]
pub struct Page{pub rows:Vec<Row>,pub next:Option<Cursor>,pub scanned:usize}
fn digest<T:Serialize>(v:&T)->[u8;32]{let mut b=vec![];ciborium::into_writer(v,&mut b).expect("lookup digest");Sha256::digest(b).into()}
pub fn read<F>(caller:Principal,viewer:Viewer,sources:Vec<Source>,cursor:Option<Cursor>,mut read_source:F)->Result<Page,String>
where F:FnMut(&Source,Principal,Option<String>)->Result<(Vec<String>,Option<String>,usize),String>{
    if caller==Principal::anonymous()||caller==Principal::management_canister()||viewer.account.is_empty()||viewer.account.len()>128||viewer.aliases.is_empty()||viewer.aliases.len()>8||!viewer.aliases.contains(&caller){return Err("Caller-private verified account required".into());}
    let mut sorted=viewer.aliases.clone();sorted.sort();sorted.dedup();
    if sorted.len()!=viewer.aliases.len()||viewer.aliases.iter().any(|p|*p==Principal::anonymous()||*p==Principal::management_canister()){return Err("Invalid verified account aliases".into());}
    if sources.is_empty()||sources.len()>4096||sources.iter().any(|s|!s.complete){return Err("Directory incomplete; existing discovery required".into());}
    if sources.iter().any(|s|s.id.is_empty()||s.id.len()>128||s.id.contains('\u{1f}')||s.binding.generation==0||s.binding.revision==0||s.binding.inventory_digest==[0;32]||s.binding.authority==Principal::anonymous()||s.binding.authority==Principal::management_canister()){return Err("Invalid verified source inventory".into());}
    if sources.windows(2).any(|w|w[0].id>=w[1].id){return Err("Canonical complete source inventory required".into());}
    for source in &sources{if let Some(aliases)=&source.eligible_aliases{let mut unique=aliases.clone();unique.sort();unique.dedup();if unique.len()!=aliases.len()||aliases.iter().any(|p|!viewer.aliases.contains(p)){return Err("Foreign indexed account alias".into());}}}
    let viewer_digest=digest(&(caller,&viewer));let sources_digest=digest(&sources);
    let mut at=cursor.unwrap_or(Cursor{viewer_digest,sources_digest,source:0,alias:0,after:None});
    if at.viewer_digest!=viewer_digest||at.sources_digest!=sources_digest||at.source>=sources.len()||at.alias>=viewer.aliases.len()||at.after.as_ref().is_some_and(|s|s.len()>256||s.is_empty()){return Err("Account or directory continuation changed".into());}
    // Skip index-proven empty source/alias pairs locally. Full inventory
    // completeness and binding digests remain pinned above, including skipped
    // sources; an unavailable unrelated source still cannot imply completion.
    while at.source<sources.len()&&sources[at.source].eligible_aliases.as_ref().is_some_and(|aliases|!aliases.contains(&viewer.aliases[at.alias])){
        at.after=None;at.alias+=1;if at.alias==viewer.aliases.len(){at.alias=0;at.source+=1;}
    }
    if at.source==sources.len(){return Ok(Page{rows:vec![],next:None,scanned:0});}
    // One relevant source/alias page only, <=100 scanned rows.
    let source=&sources[at.source];let (clubs,next,scanned)=read_source(source,viewer.aliases[at.alias],at.after.clone())?;
    if scanned>100||clubs.len()>100||clubs.len()>scanned||clubs.iter().any(|c|c.is_empty()||c.len()>128||c.contains('\u{1f}'))||scanned==0&&next.is_some()||next.as_ref().is_some_and(|s|s.is_empty()||s.len()>256)||next.as_ref().zip(at.after.as_ref()).is_some_and(|(n,a)|n<=a){return Err("Invalid bounded source page".into());}
    let mut rows=vec![];for club in clubs{if !rows.iter().any(|r:&Row|r.club==club){rows.push(Row{club,source:source.id.clone(),authority:source.binding.authority});}}
    at.after=next;if at.after.is_none(){at.alias+=1;if at.alias==viewer.aliases.len(){at.alias=0;at.source+=1;}}
    while at.source<sources.len()&&sources[at.source].eligible_aliases.as_ref().is_some_and(|aliases|!aliases.contains(&viewer.aliases[at.alias])){at.after=None;at.alias+=1;if at.alias==viewer.aliases.len(){at.alias=0;at.source+=1;}}
    let next=if at.source==sources.len(){None}else{Some(at)};Ok(Page{rows,next,scanned})
}
// Positions remain server-owned. An instance survives upgrades and is never
// reused after expiry/cleanup; consumer IDs only separate caller-owned tabs.
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Continuation{pub instance:u64,pub sequence:u64}
#[derive(Clone,Debug,Serialize,Deserialize)]
struct Session{viewer:[u8;32],sources:[u8;32],sequence:u64,page:Page,
    #[serde(default)] seen:BTreeMap<String,(String,Principal)>,
    #[serde(default)] expires_at:u64,#[serde(default)] instance:u64}
const MAX_SESSION_CLUBS:usize=1000;
const MAX_SESSIONS:u64=10000;
const MAX_CONSUMERS:usize=4;
const SESSION_TTL_NS:u64=15*60*1_000_000_000;
const COUNTER:&str="!instance";
pub struct Sessions<M:Memory>{rows:StableBTreeMap<String,Vec<u8>,M>}
impl<M:Memory> Sessions<M>{
    pub fn open(memory:M)->Self{Self{rows:StableBTreeMap::init(memory)}}
    pub fn instance(&self,caller:Principal,consumer:u64)->Result<u64,String>{
        self.rows.get(&format!("{}:{consumer:020}",caller.to_text()))
            .map(|b|ciborium::from_reader::<Session,_>(b.as_slice()).expect("lookup session").instance)
            .filter(|v|*v>0).ok_or("Lookup session missing".into())
    }
    /// Fresh identity eligibility and source completeness must precede EVERY
    /// call, including persisted reply replay. No await occurs in this method.
    pub fn page_at<F>(&mut self,caller:Principal,viewer:Viewer,sources:Vec<Source>,consumer:u64,continuation:Option<Continuation>,now:u64,reader:F)->Result<(Page,Option<Continuation>),String>
    where F:FnMut(&Source,Principal,Option<String>)->Result<(Vec<String>,Option<String>,usize),String>{
        if continuation.as_ref().is_some_and(|c|c.instance==0||c.sequence>50000){return Err("Invalid lookup continuation or page budget".into());}
        read(caller,viewer.clone(),sources.clone(),None,|_,_,_|Ok((vec![],None,0)))?;
        let viewer_hash=digest(&(caller,&viewer));let sources_hash=digest(&sources);
        let prefix=format!("{}:",caller.to_text());let key=format!("{prefix}{consumer:020}");
        let prior=self.rows.get(&key).map(|b|ciborium::from_reader::<Session,_>(b.as_slice()).expect("lookup session"));
        let same=prior.as_ref().filter(|s|s.instance>0&&s.viewer==viewer_hash&&s.sources==sources_hash&&s.expires_at>now);
        let sequence=continuation.as_ref().map_or(0,|c|c.sequence);
        if let Some(token)=&continuation{
            let session=same.ok_or("Lookup account/inventory/session changed; restart required")?;
            if token.instance!=session.instance{return Err("Lookup session instance changed".into());}
        }
        if let Some(session)=same{
            if sequence==session.sequence{
                let next=if session.page.next.is_some(){Some(Continuation{instance:session.instance,sequence:sequence.checked_add(1).ok_or("Lookup sequence exhausted")?})}else{None};
                return Ok((session.page.clone(),next));
            }
        }
        let cursor=if continuation.is_none(){
            if same.is_some(){return Err("Lookup refresh requires a new consumer ID".into());}None
        }else{
            let session=same.ok_or("Lookup session expired")?;
            if sequence!=session.sequence.checked_add(1).ok_or("Lookup sequence exhausted")?{return Err("Lookup sequence gap".into());}
            Some(session.page.next.clone().ok_or("Lookup already exhausted")?)
        };
        // At most four active caller-owned consumers. Bounded local cleanup
        // releases expired rows; it never resets the global instance counter.
        if prior.is_none(){
            let keys:Vec<_>=self.rows.range(prefix.clone()..).take_while(|e|e.key().starts_with(&prefix)).take(MAX_CONSUMERS+1).map(|e|(e.key().clone(),e.value())).collect();
            let mut active=0;for (k,b) in keys{let state:Session=ciborium::from_reader(b.as_slice()).expect("lookup session");if state.expires_at<=now{self.rows.remove(&k);}else{active+=1;}}
            if active>=MAX_CONSUMERS{return Err("Lookup caller session capacity reached".into());}
            if self.rows.len()>=MAX_SESSIONS+u64::from(self.rows.get(&COUNTER.into()).is_some()){return Err("Lookup session capacity reached".into());}
        }
        let (instance,expires_at)=if continuation.is_none(){
            let previous=self.rows.get(&COUNTER.into()).map(|b|ciborium::from_reader::<u64,_>(b.as_slice()).expect("lookup counter")).unwrap_or(0);
            (previous.checked_add(1).ok_or("Lookup instance exhausted")?,now.checked_add(SESSION_TTL_NS).ok_or("Lookup time exhausted")?)
        }else{let state=same.ok_or("Lookup session expired")?;(state.instance,state.expires_at)};
        let mut seen=if continuation.is_none(){BTreeMap::new()}else{same.ok_or("Lookup session expired")?.seen.clone()};
        let mut page=read(caller,viewer,sources,cursor,reader)?;let mut unique=vec![];
        for row in page.rows{let owner=(row.source.clone(),row.authority);match seen.get(&row.club){
            Some(prior) if prior!=&owner=>return Err("Club claimed by multiple directory sources".into()),Some(_)=>{},
            None=>{if seen.len()>=MAX_SESSION_CLUBS{return Err("Lookup club budget reached".into());}seen.insert(row.club.clone(),owner);unique.push(row);}
        }}
        page.rows=unique;
        let next=if page.next.is_some(){Some(Continuation{instance,sequence:sequence.checked_add(1).ok_or("Lookup sequence exhausted")?})}else{None};
        let state=Session{viewer:viewer_hash,sources:sources_hash,sequence,page:page.clone(),seen,expires_at,instance};let mut bytes=vec![];ciborium::into_writer(&state,&mut bytes).expect("lookup session");
        if continuation.is_none(){let mut counter=vec![];ciborium::into_writer(&instance,&mut counter).expect("lookup counter");self.rows.insert(COUNTER.into(),counter);}
        self.rows.insert(key,bytes);Ok((page,next))
    }
    pub fn reclaim(&mut self,now:u64,after:Option<String>)->(usize,Option<String>){
        let mut at=after;let mut scanned=0;
        while scanned<100{
            let row=match &at{Some(c)=>self.rows.range((Excluded(c.clone()),Unbounded)).next(),None=>self.rows.iter().next()}.map(|e|(e.key().clone(),e.value()));
            let Some((key,bytes))=row else{return (scanned,None)};
            if key!=COUNTER{let state:Session=ciborium::from_reader(bytes.as_slice()).expect("lookup session");if state.expires_at<=now{self.rows.remove(&key);}}
            at=Some(key);scanned+=1;
        }(scanned,at)
    }
}
#[cfg(test)]mod tests{
    use super::*;
    fn p(n:u8)->Principal{Principal::from_slice(&[n,1])}
    fn viewer()->Viewer{Viewer{account:"account".into(),version:3,aliases:vec![p(1),p(2)]}}
    fn sources()->Vec<Source>{vec![Source{id:"g1".into(),binding:Binding{authority:p(9),generation:1,revision:1,inventory_digest:[1;32]},complete:true,eligible_aliases:None},Source{id:"g2".into(),binding:Binding{authority:p(8),generation:1,revision:1,inventory_digest:[1;32]},complete:true,eligible_aliases:None}]}
    #[test]fn one_local_source_page_per_call_and_alias_version_pinned(){
        let mut count=0;let page=read(p(1),viewer(),sources(),None,|s,p,_|{count+=1;assert_eq!(s.id,"g1");assert_eq!(p,super::tests::p(1));Ok((vec!["a".into()],None,1))}).unwrap();assert_eq!(count,1);assert_eq!(page.scanned,1);assert_eq!(page.rows[0].club,"a");
        let cursor=page.next;let mut changed=viewer();changed.version+=1;
        assert!(read(p(1),changed,sources(),cursor.clone(),|_,_,_|panic!("read after account drift")).is_err());
        let page=read(p(1),viewer(),sources(),cursor,|s,alias,_|{assert_eq!(s.id,"g1");assert_eq!(alias,p(2));Ok((vec![],None,0))}).unwrap();assert_eq!(page.next.unwrap().source,1);
    }
    #[test]fn incomplete_or_foreign_accounts_never_read_sources(){
        assert!(read(p(3),viewer(),sources(),None,|_,_,_|panic!("foreign account read")).is_err());
        let mut incomplete=sources();incomplete[1].complete=false;
        assert!(read(p(1),viewer(),incomplete,None,|_,_,_|panic!("incomplete read")).is_err());
        let page=read(p(1),viewer(),sources(),None,|_,_,_|Ok((vec![],Some("a".into()),100))).unwrap();let mut changed=sources();changed[1].binding.revision+=1;
        assert!(read(p(1),viewer(),changed,page.next,|_,_,_|panic!("drift read")).is_err());
        assert!(read(p(1),viewer(),sources(),None,|_,_,_|Ok((vec![],None,101))).is_err());
    }
    #[test]fn proven_empty_sources_skip_all_reads_but_remain_in_the_completeness_pin(){
        let mut inventory=sources();inventory[0].eligible_aliases=Some(vec![]);inventory[1].eligible_aliases=Some(vec![p(2)]);
        let mut calls=0;let page=read(p(1),viewer(),inventory.clone(),None,|source,alias,_|{calls+=1;assert_eq!(source.id,"g2");assert_eq!(alias,p(2));Ok((vec!["club".into()],None,1))}).unwrap();assert_eq!(calls,1);assert!(page.next.is_none());
        inventory[1].eligible_aliases=Some(vec![]);let page=read(p(1),viewer(),inventory.clone(),None,|_,_,_|panic!("empty index must not read source")).unwrap();assert!(page.rows.is_empty());assert_eq!(page.scanned,0);assert!(page.next.is_none());
        inventory[0].complete=false;assert!(read(p(1),viewer(),inventory,None,|_,_,_|panic!("incomplete skipped source")).is_err());
        let mut inventory=sources();inventory[0].eligible_aliases=Some(vec![p(3)]);assert!(read(p(1),viewer(),inventory,None,|_,_,_|panic!("foreign indexed alias")).is_err());
    }
    #[test]fn two_hundred_empty_sources_do_not_add_content_page_reads(){
        let mut inventory=vec![];
        for n in 0..201{let mut source=sources()[0].clone();source.id=format!("g{n:03}");source.eligible_aliases=Some(if n==200{vec![p(1)]}else{vec![]});inventory.push(source);}
        let mut calls=0;let page=read(p(1),viewer(),inventory.clone(),None,|source,_,_|{calls+=1;assert_eq!(source.id,"g200");Ok((vec!["club".into()],None,1))}).unwrap();assert_eq!(calls,1);assert_eq!(page.scanned,1);assert!(page.next.is_none());
        inventory[80].complete=false;assert!(read(p(1),viewer(),inventory,None,|_,_,_|panic!("missing unrelated source cannot imply completion")).is_err());
    }
    #[test]fn instance_tokens_survive_reopen_reject_skips_and_foreign_consumers(){
        let memory=ic_stable_structures::VectorMemory::default();let mut s=Sessions::open(memory.clone());
        let (first,next)=s.page_at(p(1),viewer(),sources(),10,None,1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();let token=next.unwrap();drop(s);
        let mut s=Sessions::open(memory);let (replay,next)=s.page_at(p(1),viewer(),sources(),10,None,1,|_,_,_|panic!("persisted start replay")).unwrap();assert_eq!(first.rows,replay.rows);assert_eq!(next,Some(token.clone()));
        let mut skipped=token.clone();skipped.sequence=2;assert!(s.page_at(p(1),viewer(),sources(),10,Some(skipped),1,|_,_,_|panic!("skip")).is_err());
        assert!(s.page_at(p(1),viewer(),sources(),11,Some(token.clone()),1,|_,_,_|panic!("foreign consumer")).is_err());
        assert!(s.page_at(p(2),viewer(),sources(),10,Some(token.clone()),1,|_,_,_|panic!("foreign caller")).is_err());
        let mut changed=viewer();changed.version+=1;assert!(s.page_at(p(1),changed,sources(),10,Some(token.clone()),1,|_,_,_|panic!("account drift")).is_err());
        let (second,_)=s.page_at(p(1),viewer(),sources(),10,Some(token.clone()),1,|_,_,_|Ok((vec![],None,0))).unwrap();assert!(second.rows.is_empty());
        let (replay,_)=s.page_at(p(1),viewer(),sources(),10,Some(token),1,|_,_,_|panic!("page replay")).unwrap();assert!(replay.rows.is_empty());
    }
    #[test]fn expired_token_cannot_advance_replacement_even_after_cleanup(){
        let memory=ic_stable_structures::VectorMemory::default();let mut s=Sessions::open(memory.clone());
        let (_,old)=s.page_at(p(1),viewer(),sources(),1,None,10,|_,_,_|Ok((vec!["old".into()],None,1))).unwrap();let old=old.unwrap();
        s.reclaim(SESSION_TTL_NS+10,None);drop(s);let mut s=Sessions::open(memory);
        let (_,new)=s.page_at(p(1),viewer(),sources(),1,None,SESSION_TTL_NS+10,|_,_,_|Ok((vec!["new".into()],None,1))).unwrap();let new=new.unwrap();assert!(new.instance>old.instance);
        assert!(s.page_at(p(1),viewer(),sources(),1,Some(old),SESSION_TTL_NS+10,|_,_,_|panic!("expired instance accepted")).is_err());
        s.page_at(p(1),viewer(),sources(),1,Some(new),SESSION_TTL_NS+10,|_,_,_|Ok((vec![],None,0))).unwrap();
    }
    #[test]fn concurrent_consumers_have_independent_deduplication_and_bounded_capacity(){
        let mut s=Sessions::open(ic_stable_structures::VectorMemory::default());let mut tokens=vec![];
        for consumer in 0..4{let (_,token)=s.page_at(p(1),viewer(),sources(),consumer,None,1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();tokens.push(token.unwrap());}
        assert!(s.page_at(p(1),viewer(),sources(),4,None,1,|_,_,_|panic!("fifth consumer")).is_err());assert_ne!(tokens[0].instance,tokens[1].instance);
        for consumer in 0..4{let (page,_)=s.page_at(p(1),viewer(),sources(),consumer,Some(tokens[consumer as usize].clone()),1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();assert!(page.rows.is_empty());}
        s.page_at(p(1),viewer(),sources(),4,None,SESSION_TTL_NS+1,|_,_,_|Ok((vec![],None,0))).unwrap();
        assert_eq!(s.rows.len(),2); // one session plus monotonic counter
    }
    #[test]fn conflicting_owners_and_changed_completeness_reject_before_reply_replay(){
        let mut s=Sessions::open(ic_stable_structures::VectorMemory::default());
        let (_,next)=s.page_at(p(1),viewer(),sources(),1,None,1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();
        let (_,next)=s.page_at(p(1),viewer(),sources(),1,next,1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();
        assert!(s.page_at(p(1),viewer(),sources(),1,next.clone(),1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap_err().contains("multiple"));
        let mut incomplete=sources();incomplete[1].complete=false;
        assert!(s.page_at(p(1),viewer(),incomplete,1,next,1,|_,_,_|panic!("incomplete replay")).is_err());
    }
    #[test]fn completed_traversal_can_refresh_on_a_new_consumer_without_mixing_old_pages(){
        let mut s=Sessions::open(ic_stable_structures::VectorMemory::default());let mut inventory=sources();inventory[0].eligible_aliases=Some(vec![p(1)]);inventory[1].eligible_aliases=Some(vec![]);
        let (first,next)=s.page_at(p(1),viewer(),inventory.clone(),1,None,1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();assert_eq!(next,None);assert_eq!(first.rows[0].club,"a");
        let (fresh,next)=s.page_at(p(1),viewer(),inventory,2,None,2,|_,_,_|Ok((vec!["b".into()],None,1))).unwrap();assert_eq!(next,None);assert_eq!(fresh.rows[0].club,"b");
    }
    #[test]fn failed_start_does_not_consume_instance_and_counter_exhaustion_rejects_before_read(){
        let mut s=Sessions::open(ic_stable_structures::VectorMemory::default());
        assert!(s.page_at(p(1),viewer(),sources(),1,None,1,|_,_,_|Err("unavailable".into())).is_err());assert_eq!(s.rows.len(),0);
        let mut bytes=vec![];ciborium::into_writer(&u64::MAX,&mut bytes).unwrap();s.rows.insert(COUNTER.into(),bytes);
        assert!(s.page_at(p(1),viewer(),sources(),1,None,1,|_,_,_|panic!("exhausted instance counter")).is_err());assert_eq!(s.rows.len(),1);
    }
    #[test]fn cleanup_scans_at_most_one_hundred_rows_and_never_recycles_instance_counter(){
        let memory=ic_stable_structures::VectorMemory::default();let mut s=Sessions::open(memory.clone());
        for n in 0..105u16{let caller=Principal::from_slice(&[n as u8,3]);let viewer=Viewer{account:format!("account{n}"),version:1,aliases:vec![caller]};s.page_at(caller,viewer,sources(),1,None,1,|_,_,_|Ok((vec![],None,0))).unwrap();}
        let (scanned,next)=s.reclaim(SESSION_TTL_NS+1,None);assert_eq!(scanned,100);assert!(next.is_some());drop(s);
        let mut s=Sessions::open(memory);let (scanned,next)=s.reclaim(SESSION_TTL_NS+1,next);assert_eq!(scanned,6);assert!(next.is_none());assert_eq!(s.rows.len(),1);
        let (_,next)=s.page_at(p(1),viewer(),sources(),1,None,SESSION_TTL_NS+1,|_,_,_|Ok((vec![],None,0))).unwrap();assert!(next.unwrap().instance>105);
    }
}
