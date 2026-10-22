//! Durable automatic-update journal. Runtime binding/delivery remains gated.
//! The exact authority inventory is supplied only by the future verified
//! registry coordinator, never by a browser or membership claim.
use candid::Principal;
use ic_stable_structures::{Memory,StableBTreeMap};
use serde::{Serialize,Deserialize};
use crate::membership_materializer::Binding;
use std::ops::Bound::{Excluded,Unbounded};
const MAX_UPDATE_SOURCES:u64=8192;
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Update {
    pub binding: Binding,
    pub acknowledged: u64,
    pub published: u64,
}
pub struct Journal<M:Memory>{rows:StableBTreeMap<String,Vec<u8>,M>}
fn encode(v:&Update)->Vec<u8>{let mut b=vec![];ciborium::into_writer(v,&mut b).expect("update encode");b}
fn decode(b:&[u8])->Update{ciborium::from_reader(b).expect("update decode")}
impl<M:Memory> Journal<M>{
    pub fn open(memory:M)->Self{Self{rows:StableBTreeMap::init(memory)}}
    pub fn source(&self,source:&str)->Option<Update>{self.rows.get(&source.to_string()).map(|b|decode(&b))}
    pub fn validate_new_build(&self,source:&str,binding:&Binding)->Result<(),String>{
        if source.is_empty()||source.len()>128||source.contains('\u{1f}')||binding.generation==0||binding.revision==0||binding.inventory_digest==[0;32]||binding.authority==Principal::anonymous()||binding.authority==Principal::management_canister(){return Err("Invalid update binding".into());}
        if let Some(prior)=self.source(source){
            if binding.generation<prior.binding.generation ||
                binding.generation==prior.binding.generation&&(binding.authority!=prior.binding.authority||binding.inventory_digest!=prior.binding.inventory_digest||binding.revision<=prior.binding.revision){return Err("New source revision or generation required".into());}
        }else if self.rows.len()>=MAX_UPDATE_SOURCES{return Err("Update source budget reached".into());}
        Ok(())
    }
    pub fn bind(&mut self,source:&str,binding:Binding)->Result<(),String>{
        if source.is_empty()||source.len()>128||source.contains('\u{1f}')||binding.generation==0||binding.revision==0||binding.inventory_digest==[0;32]||binding.authority==Principal::anonymous()||binding.authority==Principal::management_canister(){return Err("Invalid update binding".into());}
        if let Some(prior)=self.source(source){
            if prior.binding==binding{return Ok(());}
            if binding.generation<=prior.binding.generation{return Err("Replacement source generation required".into());}
        }
        if self.source(source).is_none()&&self.rows.len()>=MAX_UPDATE_SOURCES{return Err("Update source budget reached".into());}
        self.rows.insert(source.into(),encode(&Update{binding,acknowledged:0,published:0}));Ok(())
    }
    pub fn invalidate(&mut self,source:&str,caller:Principal,generation:u64,revision:u64,digest:[u8;32])->Result<(),String>{
        let mut row=self.source(source).ok_or("Unbound update source")?;
        if row.binding.authority!=caller||row.binding.generation!=generation||row.binding.inventory_digest!=digest||revision<row.binding.revision{return Err("Obsolete or foreign source update".into());}
        if revision==row.binding.revision{return Ok(());}
        row.binding.revision=revision;self.rows.insert(source.into(),encode(&row));Ok(())
    }
    pub fn pending(&self,source:&str)->Result<bool,String>{let row=self.source(source).ok_or("Unbound update source")?;Ok(row.binding.revision!=row.acknowledged)}
    // Durable intent/readback: publish exact complete reconstruction first;
    // acknowledge only the matching local source revision after readback.
    pub fn publish(&mut self,source:&str,binding:&Binding,complete:bool)->Result<(),String>{
        let mut row=self.source(source).ok_or("Unbound update source")?;
        if &row.binding!=binding||!complete{return Err("Incomplete or stale reconstruction".into());}
        row.published=binding.revision;self.rows.insert(source.into(),encode(&row));Ok(())
    }
    pub fn acknowledge(&mut self,source:&str,binding:&Binding,readback_revision:u64)->Result<(),String>{
        let mut row=self.source(source).ok_or("Unbound update source")?;
        if &row.binding!=binding||readback_revision!=binding.revision||row.published!=binding.revision{return Err("Unknown or stale source acknowledgement".into());}
        row.acknowledged=binding.revision;self.rows.insert(source.into(),encode(&row));Ok(())
    }
    /// Only after a verified higher inventory generation fences every old
    /// writer. Never remove current-generation pending/unknown publications.
    pub fn reclaim_obsolete(&mut self,current_generation:u64,after:Option<String>)->Result<(usize,Option<String>),String>{
        if current_generation==0{return Err("Verified replacement generation required".into());}
        let mut at=after;let mut scanned=0;
        while scanned<100{
            let row=match &at{Some(c)=>self.rows.range((Excluded(c.clone()),Unbounded)).next(),None=>self.rows.iter().next()}.map(|e|(e.key().clone(),e.value()));
            let Some((key,bytes))=row else{return Ok((scanned,None))};let update=decode(&bytes);
            if update.binding.generation<current_generation{self.rows.remove(&key);}
            at=Some(key);scanned+=1;
        }Ok((scanned,at))
    }
}
#[cfg(test)] mod tests{
    use super::*;use ic_stable_structures::VectorMemory;
    fn binding()->Binding{Binding{authority:Principal::from_slice(&[1,1]),generation:1,revision:1,inventory_digest:[1;32]}}
    #[test] fn unknown_delivery_retains_pending_and_reopen_replays_exact_revision(){
        let memory=VectorMemory::default();let mut j=Journal::open(memory.clone());let b=binding();j.bind("g1",b.clone()).unwrap();
        assert!(j.pending("g1").unwrap());assert!(j.acknowledge("g1",&b,1).is_err());
        j.publish("g1",&b,true).unwrap();drop(j);let mut j=Journal::open(memory);
        j.publish("g1",&b,true).unwrap();j.acknowledge("g1",&b,1).unwrap();assert!(!j.pending("g1").unwrap());
        j.invalidate("g1",b.authority,1,2,b.inventory_digest).unwrap();let next=j.source("g1").unwrap().binding;
        assert!(j.pending("g1").unwrap());assert!(j.acknowledge("g1",&b,1).is_err());assert!(j.publish("g1",&next,false).is_err());
        j.publish("g1",&next,true).unwrap();j.acknowledge("g1",&next,2).unwrap();
        j.invalidate("g1",b.authority,1,2,b.inventory_digest).unwrap();assert!(!j.pending("g1").unwrap());
    }
    #[test] fn foreign_generation_and_source_cannot_clear_or_poison_updates(){
        let mut j=Journal::open(VectorMemory::default());let b=binding();j.bind("g2",b.clone()).unwrap();let before=j.source("g2");
        assert!(j.invalidate("g2",Principal::from_slice(&[2,1]),1,100,[1;32]).is_err());
        assert!(j.invalidate("g2",b.authority,0,100,[1;32]).is_err());assert!(j.invalidate("g2",b.authority,1,100,[2;32]).is_err());assert_eq!(j.source("g2"),before);
        let mut new=b.clone();new.generation=2;new.revision=1;j.bind("g2",new).unwrap();assert!(j.publish("g2",&b,true).is_err());
    }
    #[test]fn replacement_reclamation_preserves_current_pending_and_preflight_rejects_reused_revision(){
        let mut j=Journal::open(VectorMemory::default());let b=binding();j.bind("old",b.clone()).unwrap();
        assert!(j.validate_new_build("old",&b).is_err());let mut fresh=b.clone();fresh.generation=2;j.bind("current",fresh.clone()).unwrap();
        assert_eq!(j.reclaim_obsolete(2,None).unwrap(),(2,None));assert!(j.source("old").is_none());assert!(j.pending("current").unwrap());assert!(j.validate_new_build("current",&fresh).is_err());
        fresh.revision=2;assert!(j.validate_new_build("current",&fresh).is_ok());
    }
}