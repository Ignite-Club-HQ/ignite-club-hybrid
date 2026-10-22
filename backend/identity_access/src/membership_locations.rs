//! Consensus assignment checks reused by the source transport. Missing
//! assignment is unresolved, never an implicit legacy Group 1 mapping.
use candid::{CandidType,Principal};
use serde::Deserialize;
#[derive(Clone,Debug,CandidType,Deserialize)]
pub struct Assignment{pub club_id:String,pub group_id:String,pub revision:u64}
pub fn verify(club:&str,source:&str,authority:Principal,assignment:&Assignment,sources:&[(String,Principal)],registry_revision:u64)->Result<(),String>{
    if club.is_empty()||club.len()>64||registry_revision==0||assignment.club_id!=club||assignment.group_id!=source||assignment.revision==0||assignment.revision>registry_revision||!sources.iter().any(|(id,p)|id==source&&*p==authority){return Err("Club assignment conflicts with exact membership source".into());}
    Ok(())
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn exact_assignment_resolves_only_to_its_registered_writer(){
        let a=Principal::from_slice(&[1,1]);let b=Principal::from_slice(&[2,1]);let sources=vec![("g1".into(),a),("g2".into(),b)];
        let assignment=Assignment{club_id:"club".into(),group_id:"g2".into(),revision:3};
        assert!(verify("club","g2",b,&assignment,&sources,4).is_ok());assert!(verify("club","g1",a,&assignment,&sources,4).is_err());assert!(verify("club","g2",a,&assignment,&sources,4).is_err());assert!(verify("other","g2",b,&assignment,&sources,4).is_err());assert!(verify("club","g2",b,&assignment,&sources,2).is_err());
    }
}