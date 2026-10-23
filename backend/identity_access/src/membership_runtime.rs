//! Stable runtime configuration is separate from admission/lifecycle grants.
//! No reader/cutover flag exists until complete coverage/freshness is proven.
use candid::{CandidType,Principal};
use serde::{Serialize,Deserialize};
use std::collections::BTreeMap;
use crate::{group_inventory, membership_transport::SourceBinding};
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
pub struct Config {
    pub binding:group_inventory::Binding, pub generation:u64,
    pub inventory_digest:Vec<u8>, pub sources:Vec<(String,Principal)>,
    pub pending:BTreeMap<String,u64>, pub enabled:bool,
    #[serde(default)] pub next_source:usize,
    #[serde(default)] pub lifecycle:Vec<crate::membership_acceptance::Lifecycle>,
    #[serde(default)] pub release:Option<String>,
}
impl Config {
    pub fn same_configuration(&self,other:&Self)->bool {
        self.binding==other.binding&&self.generation==other.generation&&self.inventory_digest==other.inventory_digest&&self.sources==other.sources&&self.enabled==other.enabled&&self.lifecycle==other.lifecycle&&self.release==other.release
    }
    pub fn check_watermark(&self,source:&str,revision:u64)->Result<(),String> {
        if self.pending.get(source).copied().unwrap_or(0)>revision{return Err("Source status superseded by invalidation".into());}Ok(())
    }
    pub fn source_binding(&self,identity:Principal,source:&str)->Result<SourceBinding,String> {
        if !self.enabled || !self.sources.iter().any(|(id,_)|id==source) { return Err("Directory source unconfigured".into()); }
        Ok(SourceBinding{identity,router:self.binding.registry,group:source.into(),deployment:self.binding.target_alias.clone(),generation:self.generation,inventory_digest:self.inventory_digest.clone()})
    }
    pub fn invalidate(&mut self,identity:Principal,caller:Principal,binding:&SourceBinding,revision:u64)->Result<(),String> {
        if revision==0 || &self.source_binding(identity,&binding.group)?!=binding ||
            !self.sources.iter().any(|(id,p)|id==&binding.group&&*p==caller) { return Err("Exact directory source authority required".into()); }
        let prior=self.pending.get(&binding.group).copied().unwrap_or(0);
        // Old/repeated notifications are harmless; never lower the watermark.
        if revision>prior { self.pending.insert(binding.group.clone(),revision); } Ok(())
    }
}
#[derive(Clone,Debug,CandidType,Deserialize)]
pub struct Progress { pub source:String, pub phase:String, pub revision:u64, pub scanned:u64 }
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn only_exact_writer_can_raise_durable_watermark() {
        let (_,binding,a)=group_inventory::tests::fixture();let identity=Principal::from_slice(&[99,1]);
        let mut c=Config{binding,generation:1,inventory_digest:vec![1;32],sources:vec![("g0".into(),a[0])],pending:BTreeMap::new(),enabled:true,next_source:0,lifecycle:vec![],release:None};
        let b=c.source_binding(identity,"g0").unwrap();
        assert!(c.invalidate(identity,a[1],&b,10).is_err());assert!(c.pending.is_empty());
        c.invalidate(identity,a[0],&b,10).unwrap();c.invalidate(identity,a[0],&b,1).unwrap();assert_eq!(c.pending["g0"],10);
        assert!(c.check_watermark("g0",9).is_err());assert!(c.check_watermark("g0",10).is_ok());
        let mut progress=c.clone();progress.pending.insert("g0".into(),11);assert!(c.same_configuration(&progress));
        let mut foreign=b.clone();foreign.generation=2;assert!(c.invalidate(identity,a[0],&foreign,20).is_err());
        assert_eq!(c.pending["g0"],10);c.enabled=false;assert!(c.invalidate(identity,a[0],&b,20).is_err());
    }
}