//! Immutable acceptance inputs. Replica history is outside restored Wasm
//! memory; equal complete revision collects establish a snapshot interval,
//! not freshness at browser delivery. No observer boolean authorizes release.
use candid::{CandidType,Principal};
use serde::{Serialize,Deserialize};
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct Lifecycle {pub canister:Principal,pub changes:u64,pub module_hash:Vec<u8>}
#[derive(Clone,Debug,CandidType,Deserialize,PartialEq,Eq)]
pub struct Stamp {pub source:String,pub revision:u64,pub acknowledged:u64,pub pending:bool}
pub fn check_lifecycle(pinned:&[Lifecycle],current:&[Lifecycle])->Result<(),String>{
    if pinned.is_empty()||pinned.len()>102||pinned!=current||pinned.iter().any(|v|v.changes==0||v.module_hash.len()!=32)||
        pinned.iter().enumerate().any(|(at,v)|pinned[..at].iter().any(|p|p.canister==v.canister)){
        return Err("Directory lifecycle changed or unpinned; restoration/upgrade requires new acceptance".into());
    }Ok(())
}
pub fn check_collect(expected:&[(String,u64)],first:&[Stamp],second:&[Stamp])->Result<(),String>{
    if expected.is_empty()||expected.len()>100||first.len()!=expected.len()||first!=second||
        expected.iter().enumerate().any(|(at,(id,r))|*r==0||expected[..at].iter().any(|(prior,_)|prior==id)||
            first.get(at).is_none_or(|s|&s.source!=id||s.revision!=*r||s.acknowledged!=*r||s.pending)){
        return Err("Directory snapshot changed, incomplete or pending".into());
    }Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    fn lifecycle()->Vec<Lifecycle>{vec![Lifecycle{canister:Principal::from_slice(&[1,1]),changes:7,module_hash:vec![3;32]}]}
    fn stamps()->Vec<Stamp>{vec![Stamp{source:"g1".into(),revision:7,acknowledged:7,pending:false},Stamp{source:"g2".into(),revision:9,acknowledged:9,pending:false}]}
    #[test]fn snapshot_load_same_module_and_restored_acceptance_fail_against_replica_history(){
        let pinned=lifecycle();let restored:Vec<Lifecycle>=ciborium::from_reader({let mut b=vec![];ciborium::into_writer(&pinned,&mut b).unwrap();std::io::Cursor::new(b)}).unwrap();
        check_lifecycle(&restored,&pinned).unwrap();let mut runtime=pinned.clone();runtime[0].changes=8;
        assert!(check_lifecycle(&restored,&runtime).is_err());assert!(check_lifecycle(&[],&runtime).is_err());
        runtime[0].changes=7;runtime[0].module_hash=vec![4;32];assert!(check_lifecycle(&pinned,&runtime).is_err());
    }
    #[test]fn delayed_notifications_and_between_collect_mutations_cannot_pass(){
        let first=stamps();let expected=vec![("g1".into(),7),("g2".into(),9)];check_collect(&expected,&first,&first).unwrap();
        let mut second=first.clone();second[0].revision=8;second[0].acknowledged=8;
        assert!(check_collect(&expected,&first,&second).is_err());
        second=first.clone();second[1].pending=true;assert!(check_collect(&expected,&second,&second).is_err());
        assert!(check_collect(&expected,&first[..1],&first[..1]).is_err());
        second=first.clone();second.reverse();assert!(check_collect(&expected,&second,&second).is_err());
    }
    #[test]fn rollback_aba_in_revisions_requires_unchanged_independent_history(){
        let stamps=stamps();check_collect(&[("g1".into(),7),("g2".into(),9)],&stamps,&stamps).unwrap();
        let pin=lifecycle();let mut after=pin.clone();after[0].changes+=1;assert!(check_lifecycle(&pin,&after).is_err());
    }
}