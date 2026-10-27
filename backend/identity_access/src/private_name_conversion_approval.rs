//! Signed, exact-row rehearsal admission. No production signer/transport exists.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ed25519_dalek::{Signature, VerifyingKey};
use ic_stable_structures::StableBTreeMap;
use std::cell::RefCell;
use super::{Outcome,private_name_writer_window::WriterRequest,private_name_write_coordinator::{WriteWindow,WritePhase}};
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct ClubCopy { pub club:String, pub ciphertext:Vec<u8> }
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct ApprovedRow { pub account_id:String,pub subject:Principal,pub sink:Principal,pub source_digest:Vec<u8>,pub ciphertext:Vec<u8>,pub clubs:Vec<ClubCopy> }
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct ApprovalBody { pub kind:String,pub approval_id:String,pub identity:Principal,pub operator:Principal,pub request:WriterRequest,pub plan_hash:String,pub rows:Vec<ApprovedRow> }
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct SignedApproval { pub body:ApprovalBody,pub signature:Vec<u8> }
thread_local!{static APPROVALS:RefCell<StableBTreeMap<String,Vec<u8>,super::Memory>>=RefCell::new(StableBTreeMap::init(super::memory(31)));}
fn key()->Outcome<VerifyingKey>{
    let value=option_env!("IGNITE_PRIVATE_NAME_APPROVER_PUBLIC_KEY").ok_or("Immutable conversion signer is not configured")?;
    if value.len()!=64 || !value.is_ascii(){return Err("Invalid immutable conversion signer".into());}
    let mut bytes=[0u8;32];for(i,b)in bytes.iter_mut().enumerate(){*b=u8::from_str_radix(&value[i*2..i*2+2],16).map_err(|_|"Invalid immutable conversion signer")?;}
    VerifyingKey::from_bytes(&bytes).map_err(|_|"Invalid immutable conversion signer".into())
}
fn get(id:&str)->Outcome<SignedApproval>{APPROVALS.with(|m|m.borrow().get(&id.to_string())).map(|b|super::decode(&b)).ok_or("Signed conversion approval required".into())}
fn source_digest(id:&str)->Outcome<Vec<u8>>{let a=super::get_account(id).ok_or("Exact account required")?;let p=super::get_profile_entry(id).ok_or("Exact profile required")?;Ok(Sha256::digest(super::encode(&(a,p))).to_vec())}
fn validate(a:&SignedApproval,w:&WriteWindow,operator:Principal,identity:Principal,k:&VerifyingKey)->Outcome<()>{
    let b=&a.body;
    if b.kind!="ignite-private-name-admission-v1" || b.approval_id.is_empty() || b.approval_id.len()>128 || b.identity!=identity || b.operator!=operator || b.request!=w.request
        || b.plan_hash.len()!=64 || !b.plan_hash.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c))
        || b.request.operation_id!=format!("names:club-name-conversion-{}",b.plan_hash) || b.rows.is_empty() || b.rows.len()>4096{return Err("Exact signed conversion binding required".into());}
    let bytes=candid::encode_one(b).map_err(|_|"Approval encoding refused")?;
    if bytes.len()>32*1024*1024{return Err("Approval byte budget exceeded".into());}
    let signature=Signature::from_slice(&a.signature).map_err(|_|"Signed conversion approval required")?;
    k.verify_strict(&bytes,&signature).map_err(|_|"Signed conversion approval required")?;
    let mut accounts=std::collections::BTreeSet::new();let mut subjects=std::collections::BTreeSet::new();
    for row in &b.rows{
        if row.account_id.is_empty() || !accounts.insert(&row.account_id) || !subjects.insert(row.subject) || !w.sinks.contains(&row.sink)
            || row.subject==Principal::anonymous() || row.subject==Principal::management_canister() || row.source_digest.len()!=32
            || row.ciphertext.is_empty() || row.ciphertext.len()>4096 || row.clubs.len()>1000{return Err("Invalid approved conversion row".into());}
        let mut clubs=std::collections::BTreeSet::new();for c in &row.clubs{if c.club.is_empty() || c.club.len()>128 || !clubs.insert(&c.club) || c.ciphertext.is_empty() || c.ciphertext.len()>4096{return Err("Invalid approved club ciphertext".into());}}
    }Ok(())
}
pub(super) fn require_approval(id:&str,w:&WriteWindow)->Outcome<()>{validate(&get(id)?,w,ic_cdk::api::msg_caller(),ic_cdk::api::canister_self(),&key()?)}
#[ic_cdk::update]
fn approve_private_name_conversion(operation_id:String,approval:SignedApproval)->Outcome<()>{
    super::private_name_write_coordinator::access()?;let w=super::private_name_write_coordinator::get(&operation_id)?;
    validate(&approval,&w,ic_cdk::api::msg_caller(),ic_cdk::api::canister_self(),&key()?)?;
    if let Ok(prior)=get(&operation_id){if prior!=approval{return Err("Original signed approval is immutable".into());}return Ok(());}
    if w.phase!=WritePhase::Fencing{return Err("Approval required before conversion opens".into());}
    for row in &approval.body.rows{if source_digest(&row.account_id)?!=row.source_digest{return Err("Approved name source changed".into());}if !super::get_account(&row.account_id).ok_or("Exact account required")?.principals.contains(&row.subject){return Err("Approved alias changed".into());}}
    APPROVALS.with(|m|m.borrow_mut().insert(operation_id,super::encode(&approval)));Ok(())
}
fn approved_row(id:&str,account:&str)->Outcome<(WriteWindow,ApprovedRow)>{
    super::private_name_write_coordinator::access()?;let w=super::private_name_write_coordinator::get(id)?;require_approval(id,&w)?;
    if w.phase!=WritePhase::Writing{return Err("Approved conversion is not writing".into());}
    let r=get(id)?.body.rows.into_iter().find(|r|r.account_id==account).ok_or("Exact approved conversion row required")?;Ok((w,r))
}
#[ic_cdk::update]
async fn write_approved_private_name(operation_id:String,account_id:String,club:Option<String>)->Outcome<()>{
    let(w,r)=approved_row(&operation_id,&account_id)?;
    if source_digest(&account_id)?!=r.source_digest{return Err("Approved name source changed".into());}
    let bytes=match &club{None=>r.ciphertext,Some(id)=>r.clubs.into_iter().find(|c|&c.club==id).ok_or("Exact approved club required")?.ciphertext};
    let reply=ic_cdk::call::Call::bounded_wait(r.sink,"register_conversion_name").with_args(&(w.request.clone(),r.subject,club,bytes)).await.map_err(|_|"Conversion ciphertext outcome unknown; retain locks")?;
    let result:Outcome<()>=reply.candid().map_err(|_|"Invalid conversion ciphertext reply")?;
    super::private_name_write_coordinator::access()?;require_approval(&operation_id,&super::private_name_write_coordinator::get(&operation_id)?)?;result
}
#[ic_cdk::update]
fn publish_approved_private_name(operation_id:String,account_id:String)->Outcome<super::Profile>{
    let(w,r)=approved_row(&operation_id,&account_id)?;let _lease=super::private_name_writer_window::enter_conversion(&w.request)?;
    let reference=format!("pii-display-name:v1:{}:{}",r.sink.to_text(),r.subject.to_text());let existing=super::get_profile_entry(&account_id).ok_or("Exact profile required")?;
    if existing.display_name==reference{return Ok(existing);}
    if source_digest(&account_id)?!=r.source_digest{return Err("Approved name source changed".into());}
    if !super::private_profile_reference::valid(&reference,&super::get_account(&account_id).ok_or("Exact account required")?.principals){return Err("Approved alias changed".into());}
    let p=super::Profile{display_name:reference,updated_at_ns:ic_cdk::api::time(),..existing};super::put_profile_entry(&p);super::bump_removal_history();Ok(p)
}
#[ic_cdk::update]
fn read_private_name_source_digest(account_id:String)->Outcome<Vec<u8>>{super::private_name_write_coordinator::access()?;source_digest(&account_id)}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn absent_signer_refuses(){if option_env!("IGNITE_PRIVATE_NAME_APPROVER_PUBLIC_KEY").is_none(){assert!(key().is_err());}}
    #[test]fn forged_signature_refuses(){let mut b=[0x66;32];b[0]=0x58;let k=VerifyingKey::from_bytes(&b).unwrap();assert!(k.verify_strict(b"conversion",&Signature::from_bytes(&[0;64])).is_err());}
}