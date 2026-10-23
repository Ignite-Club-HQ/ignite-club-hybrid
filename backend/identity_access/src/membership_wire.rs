//! Caller-private diagnostic wire contract. Never advertises verified-current
//! discovery until independent ownership/recovery release acceptance exists.
use candid::{CandidType, Principal};
use serde::Deserialize;
use crate::membership_private_lookup::{Page, Continuation, Viewer};

#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Token { pub instance:u64, pub sequence:u64 }
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Row { pub club_id:String, pub group_id:String, pub authority:Principal }
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Reply {
    pub caller:Principal, pub account_version:u64, pub generation:u64,
    pub registry_revision:u64, pub inventory_digest:Vec<u8>,
    pub rows:Vec<Row>, pub next:Option<Token>, pub verified_current:bool,
}
#[derive(Clone,Debug,CandidType,Deserialize)]
pub struct ReleasedReply {
    pub page:Reply,pub instance:u64,pub release:String,pub registry:crate::group_inventory::Snapshot,
    pub photo_stores:Vec<(String,Option<Principal>)>,
}
#[derive(Clone,Debug,CandidType,Deserialize)]
pub struct PhotoGroup {pub id:String,pub photo_store:Option<Principal>}
#[derive(Clone,Debug,CandidType,Deserialize)]
pub struct PhotoRegistryPage {pub revision:u64,pub groups:Vec<PhotoGroup>,pub next_cursor:Option<String>}
pub fn continuation(token:Option<Token>)->Option<Continuation>{token.map(|t|Continuation{instance:t.instance,sequence:t.sequence})}
pub fn diagnostic(caller:Principal,viewer:&Viewer,generation:u64,registry_revision:u64,inventory_digest:Vec<u8>,page:Page,next:Option<Continuation>)->Reply{
    Reply{caller,account_version:viewer.version,generation,registry_revision,inventory_digest,
        rows:page.rows.into_iter().map(|r|Row{club_id:r.club,group_id:r.source,authority:r.authority}).collect(),
        next:next.map(|t|Token{instance:t.instance,sequence:t.sequence}),verified_current:false}
}
#[cfg(test)] mod tests{
    use super::*;
    #[test] fn diagnostic_never_certifies_freshness_or_reveals_aliases(){
        let caller=Principal::from_slice(&[1,1]);let viewer=Viewer{account:"private-account".into(),version:7,aliases:vec![caller]};
        let reply=diagnostic(caller,&viewer,2,9,vec![1;32],Page{rows:vec![],next:None,scanned:0},None);
        assert!(!reply.verified_current);assert_eq!(reply.account_version,7);assert!(reply.rows.is_empty());
        let encoded=candid::encode_one(&reply).unwrap();assert!(!encoded.windows(15).any(|w|w==b"private-account"));
    }
    #[test] fn exact_instance_and_sequence_survive_wire_conversion(){
        let converted=continuation(Some(Token{instance:19,sequence:3})).unwrap();assert_eq!(converted.instance,19);assert_eq!(converted.sequence,3);
    }
}