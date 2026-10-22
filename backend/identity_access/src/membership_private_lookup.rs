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
// Only opaque sequence numbers cross the future public boundary. Positions
// stay server-owned; a client cannot skip a source or manufacture completion.
#[derive(Clone,Debug,Serialize,Deserialize)]
struct Session{viewer:[u8;32],sources:[u8;32],sequence:u64,page:Page,
    #[serde(default)] seen:BTreeMap<String,(String,Principal)>,
    #[serde(default)] expires_at:u64}
const MAX_SESSION_CLUBS:usize=1000;
const MAX_SESSIONS:u64=10000;
const SESSION_TTL_NS:u64=15*60*1_000_000_000;
pub struct Sessions<M:Memory>{rows:StableBTreeMap<String,Vec<u8>,M>}
impl<M:Memory> Sessions<M>{
    pub fn open(memory:M)->Self{Self{rows:StableBTreeMap::init(memory)}}
    pub fn page<F>(&mut self,caller:Principal,viewer:Viewer,sources:Vec<Source>,sequence:u64,reader:F)->Result<(Page,Option<u64>),String>
    where F:FnMut(&Source,Principal,Option<String>)->Result<(Vec<String>,Option<String>,usize),String>{
        self.page_at(caller,viewer,sources,sequence,0,reader)
    }
    /// The runtime passes consensus time, and refreshes identity eligibility
    /// before this method even for persisted reply replays.
    pub fn page_at<F>(&mut self,caller:Principal,viewer:Viewer,sources:Vec<Source>,sequence:u64,now:u64,reader:F)->Result<(Page,Option<u64>),String>
    where F:FnMut(&Source,Principal,Option<String>)->Result<(Vec<String>,Option<String>,usize),String>{
        if sequence>50000{return Err("Lookup page budget reached".into());}
        // Validate the initiating identity/inventory before a replay shortcut.
        read(caller,viewer.clone(),sources.clone(),None,|_,_,_|Ok((vec![],None,0)))?;
        let viewer_hash=digest(&(caller,&viewer));let sources_hash=digest(&sources);let key=caller.to_text();
        let prior=self.rows.get(&key).map(|b|ciborium::from_reader::<Session,_>(b.as_slice()).expect("lookup session"));
        let same=prior.as_ref().filter(|s|s.viewer==viewer_hash&&s.sources==sources_hash&&s.expires_at>now);
        if let Some(prior)=same {
            if sequence==prior.sequence {
                let next=if prior.page.next.is_some(){Some(sequence.checked_add(1).ok_or("Lookup sequence exhausted")?)}else{None};
                return Ok((prior.page.clone(),next));
            }
        }
        let cursor=if sequence==0 {if same.is_some(){return Err("Lookup restart requires changed binding".into());}None}else{
            let prior=same.ok_or("Lookup account/inventory changed; restart required")?;
            if sequence!=prior.sequence.checked_add(1).ok_or("Lookup sequence exhausted")?{return Err("Lookup sequence gap".into());}
            Some(prior.page.next.clone().ok_or("Lookup already exhausted")?)
        };
        if prior.is_none()&&self.rows.len()>=MAX_SESSIONS{return Err("Lookup session capacity reached".into());}
        let mut seen=if sequence==0{BTreeMap::new()}else{same.ok_or("Lookup session expired")?.seen.clone()};
        let mut page=read(caller,viewer,sources,cursor,reader)?;
        let mut unique=vec![];
        for row in page.rows {
            let owner=(row.source.clone(),row.authority);
            match seen.get(&row.club){
                Some(prior) if prior!=&owner=>return Err("Club claimed by multiple directory sources".into()),
                Some(_)=>{},
                None=>{if seen.len()>=MAX_SESSION_CLUBS{return Err("Lookup club budget reached".into());}seen.insert(row.club.clone(),owner);unique.push(row);},
            }
        }
        page.rows=unique;
        let next=if page.next.is_some(){Some(sequence.checked_add(1).ok_or("Lookup sequence exhausted")?)}else{None};
        let expires_at=if sequence==0{now.checked_add(SESSION_TTL_NS).ok_or("Lookup time exhausted")?}else{same.ok_or("Lookup session expired")?.expires_at};
        let state=Session{viewer:viewer_hash,sources:sources_hash,sequence,page:page.clone(),seen,expires_at};let mut bytes=vec![];ciborium::into_writer(&state,&mut bytes).expect("lookup session");
        self.rows.insert(key,bytes);Ok((page,next))
    }
    /// Bounded governor/timer cleanup. Never expire source publication intents.
    pub fn reclaim(&mut self,now:u64,after:Option<String>)->(usize,Option<String>){
        let mut at=after;let mut scanned=0;
        while scanned<100{
            let row=match &at{Some(c)=>self.rows.range((Excluded(c.clone()),Unbounded)).next(),None=>self.rows.iter().next()}.map(|e|(e.key().clone(),e.value()));
            let Some((key,bytes))=row else{return (scanned,None)};
            let state:Session=ciborium::from_reader(bytes.as_slice()).expect("lookup session");
            if state.expires_at<=now{self.rows.remove(&key);}
            at=Some(key);scanned+=1;
        }
        (scanned,at)
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
    #[test]fn server_owned_cursor_rejects_skips_and_replays_after_reopen(){
        let memory=ic_stable_structures::VectorMemory::default();let mut s=Sessions::open(memory.clone());
        assert!(s.page(p(1),viewer(),sources(),3,|_,_,_|panic!("forged skip")).is_err());
        let (first,next)=s.page(p(1),viewer(),sources(),0,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();assert_eq!(next,Some(1));drop(s);
        let mut s=Sessions::open(memory);let (replay,next)=s.page(p(1),viewer(),sources(),0,|_,_,_|panic!("replay should read persisted reply")).unwrap();assert_eq!(first.rows,replay.rows);assert_eq!(next,Some(1));
        assert!(s.page(p(1),viewer(),sources(),2,|_,_,_|panic!("skip source")).is_err());
        let mut changed=viewer();changed.version+=1;assert!(s.page(p(1),changed,sources(),1,|_,_,_|panic!("old account continuation")).is_err());
        assert!(s.page(p(2),viewer(),sources(),1,|_,_,_|panic!("other caller continuation")).is_err());
        let (second,_)=s.page(p(1),viewer(),sources(),1,|source,alias,_|{assert_eq!(source.id,"g1");assert_eq!(alias,p(2));Ok((vec![],None,0))}).unwrap();assert!(second.rows.is_empty());
    }
    #[test]fn linked_alias_duplicates_are_removed_across_persisted_pages_but_conflicting_owners_reject(){
        let memory=ic_stable_structures::VectorMemory::default();let mut s=Sessions::open(memory.clone());
        s.page(p(1),viewer(),sources(),0,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();drop(s);
        let mut s=Sessions::open(memory);let (page,next)=s.page(p(1),viewer(),sources(),1,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();assert!(page.rows.is_empty());assert_eq!(next,Some(2));
        assert!(s.page(p(1),viewer(),sources(),2,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap_err().contains("multiple"));
        let (page,_)=s.page(p(1),viewer(),sources(),2,|_,_,_|Ok((vec!["b".into()],None,1))).unwrap();assert_eq!(page.rows[0].club,"b");
    }
    #[test]fn expired_sessions_restart_without_reusing_old_continuations_and_reclaim_is_bounded(){
        let mut s=Sessions::open(ic_stable_structures::VectorMemory::default());
        s.page_at(p(1),viewer(),sources(),0,10,|_,_,_|Ok((vec!["a".into()],None,1))).unwrap();
        assert!(s.page_at(p(1),viewer(),sources(),1,SESSION_TTL_NS+10,|_,_,_|panic!("expired cursor")).is_err());
        let (page,_)=s.page_at(p(1),viewer(),sources(),0,SESSION_TTL_NS+10,|_,_,_|Ok((vec!["b".into()],None,1))).unwrap();assert_eq!(page.rows[0].club,"b");
        assert_eq!(s.reclaim(SESSION_TTL_NS+11,None),(1,None));assert_eq!(s.rows.len(),1);
        assert_eq!(s.reclaim(2*SESSION_TTL_NS+10,None),(1,None));assert_eq!(s.rows.len(),0);
        assert!(s.page_at(p(1),viewer(),sources(),50001,0,|_,_,_|panic!("over budget")).is_err());
    }
}