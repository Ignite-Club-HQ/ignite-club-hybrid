//! Caller-private bounded account aggregation, not a public endpoint yet.
//! Eligibility is refreshed by the identity authority before every page.
use candid::Principal;
use serde::{Serialize,Deserialize};
use sha2::{Digest,Sha256};
use crate::membership_materializer::Binding;
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Viewer{pub account:String,pub version:u64,pub aliases:Vec<Principal>}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Source{pub id:String,pub binding:Binding,pub complete:bool}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Cursor{
    pub viewer_digest:[u8;32],pub sources_digest:[u8;32],pub source:usize,pub alias:usize,pub after:Option<String>,
}
#[derive(Clone,Debug,PartialEq,Eq)]
pub struct Row{pub club:String,pub source:String,pub authority:Principal}
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
    let viewer_digest=digest(&(caller,&viewer));let sources_digest=digest(&sources);
    let mut at=cursor.unwrap_or(Cursor{viewer_digest,sources_digest,source:0,alias:0,after:None});
    if at.viewer_digest!=viewer_digest||at.sources_digest!=sources_digest||at.source>=sources.len()||at.alias>=viewer.aliases.len()||at.after.as_ref().is_some_and(|s|s.len()>256||s.is_empty()){return Err("Account or directory continuation changed".into());}
    // One source/alias page only, <=100 scanned rows. No serial all-group calls.
    let source=&sources[at.source];let (clubs,next,scanned)=read_source(source,viewer.aliases[at.alias],at.after.clone())?;
    if scanned>100||clubs.len()>100||clubs.len()>scanned||clubs.iter().any(|c|c.is_empty()||c.len()>128||c.contains('\u{1f}'))||scanned==0&&next.is_some()||next.as_ref().is_some_and(|s|s.is_empty()||s.len()>256)||next.is_some()&&next==at.after{return Err("Invalid bounded source page".into());}
    let mut rows=vec![];for club in clubs{if !rows.iter().any(|r:&Row|r.club==club){rows.push(Row{club,source:source.id.clone(),authority:source.binding.authority});}}
    at.after=next;if at.after.is_none(){at.alias+=1;if at.alias==viewer.aliases.len(){at.alias=0;at.source+=1;}}
    let next=if at.source==sources.len(){None}else{Some(at)};Ok(Page{rows,next,scanned})
}
#[cfg(test)]mod tests{
    use super::*;
    fn p(n:u8)->Principal{Principal::from_slice(&[n,1])}
    fn viewer()->Viewer{Viewer{account:"account".into(),version:3,aliases:vec![p(1),p(2)]}}
    fn sources()->Vec<Source>{vec![Source{id:"g1".into(),binding:Binding{authority:p(9),generation:1,revision:1,inventory_digest:[1;32]},complete:true},Source{id:"g2".into(),binding:Binding{authority:p(8),generation:1,revision:1,inventory_digest:[1;32]},complete:true}]}
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
}