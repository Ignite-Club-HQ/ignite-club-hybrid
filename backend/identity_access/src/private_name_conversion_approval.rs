//! Signed, exact-row rehearsal admission. No production signer/transport exists.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use ed25519_dalek::{Signature, VerifyingKey};
use ic_stable_structures::StableBTreeMap;
use std::cell::RefCell;
use super::{Outcome,Profile,private_name_writer_window::WriterRequest,private_name_write_coordinator::{WriteWindow,WritePhase}};
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct ClubCopy { pub club:String, pub ciphertext:Vec<u8> }
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct ApprovedRow { pub account_id:String,pub subject:Principal,pub sink:Principal,pub source_digest:Vec<u8>,pub ciphertext:Vec<u8>,pub clubs:Vec<ClubCopy> }
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct ApprovalBody { pub kind:String,pub approval_id:String,pub identity:Principal,pub operator:Principal,pub request:WriterRequest,pub plan_hash:String,pub rows:Vec<ApprovedRow> }
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct SignedApproval { pub body:ApprovalBody,pub signature:Vec<u8> }
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct ApprovalReceipt { pub request:WriterRequest,pub approval_id:String,pub plan_hash:String,pub operator:Principal,pub identity:Principal,pub signed_digest:Vec<u8> }
thread_local!{static APPROVALS:RefCell<StableBTreeMap<String,Vec<u8>,super::Memory>>=RefCell::new(StableBTreeMap::init(super::memory(31)));}
thread_local!{static WRITES:RefCell<StableBTreeMap<String,Vec<u8>,super::Memory>>=RefCell::new(StableBTreeMap::init(super::memory(32)));}
fn receipt_key(id:&str,account:&str,club:&Option<String>)->String{format!("{}",hex_digest(&super::encode(&(id,account,club))))}
fn hex_digest(bytes:&[u8])->String{Sha256::digest(bytes).iter().map(|b|format!("{b:02x}")).collect()}
fn acknowledged(id:&str,r:&ApprovedRow,club:Option<String>,bytes:&[u8])->bool{WRITES.with(|m|m.borrow().get(&receipt_key(id,&r.account_id,&club)))==Some(Sha256::digest(bytes).to_vec())}
pub(super) fn complete(id:&str,w:&WriteWindow)->Outcome<()>{
    require_approval(id,w)?;
    for r in get(id)?.body.rows{
        if !acknowledged(id,&r,None,&r.ciphertext) || r.clubs.iter().any(|c|!acknowledged(id,&r,Some(c.club.clone()),&c.ciphertext)) {return Err("Approved ciphertext writes remain unresolved; retain locks".into());}
        let profile=super::get_profile_entry(&r.account_id).ok_or("Exact converted profile required")?;
        if profile.display_name!=format!("pii-display-name:v1:{}:{}",r.sink.to_text(),r.subject.to_text()) {return Err("Approved profile publication incomplete; retain locks".into());}
    }Ok(())
}
fn key()->Outcome<VerifyingKey>{
    let value=option_env!("IGNITE_PRIVATE_NAME_APPROVER_PUBLIC_KEY").ok_or("Immutable conversion signer is not configured")?;
    if value.len()!=64 || !value.is_ascii(){return Err("Invalid immutable conversion signer".into());}
    let mut bytes=[0u8;32];for(i,b)in bytes.iter_mut().enumerate(){*b=u8::from_str_radix(&value[i*2..i*2+2],16).map_err(|_|"Invalid immutable conversion signer")?;}
    VerifyingKey::from_bytes(&bytes).map_err(|_|"Invalid immutable conversion signer".into())
}
fn get(id:&str)->Outcome<SignedApproval>{APPROVALS.with(|m|m.borrow().get(&id.to_string())).map(|b|super::decode(&b)).ok_or("Signed conversion approval required".into())}
pub(super) fn has_approval(id:&str)->bool {APPROVALS.with(|m|m.borrow().contains_key(&id.to_string()))}
fn source_digest(id:&str)->Outcome<Vec<u8>>{let a=super::get_account(id).ok_or("Exact account required")?;let p=super::get_profile_entry(id).ok_or("Exact profile required")?;Ok(Sha256::digest(super::encode(&(a,p))).to_vec())}
fn approval_bytes(b:&ApprovalBody)->Vec<u8>{
    let mut out=Vec::new();let mut add=|bytes:&[u8]|{out.extend_from_slice(&(bytes.len() as u64).to_be_bytes());out.extend_from_slice(bytes);};
    for s in [&b.kind,&b.approval_id,&b.identity.to_text(),&b.operator.to_text(),&b.request.operation_id,&b.request.generation.to_string(),&b.plan_hash]{add(s.as_bytes());}
    add(&b.request.inventory_digest);add(b.rows.len().to_string().as_bytes());
    for r in &b.rows{for s in [&r.account_id,&r.subject.to_text(),&r.sink.to_text()]{add(s.as_bytes());}add(&r.source_digest);add(&r.ciphertext);add(r.clubs.len().to_string().as_bytes());for c in &r.clubs{add(c.club.as_bytes());add(&c.ciphertext);}}
    out
}
fn validate(a:&SignedApproval,w:&WriteWindow,operator:Principal,identity:Principal,k:&VerifyingKey)->Outcome<()>{
    let b=&a.body;
    let prep=super::private_name_writer_window::preparation(&w.request);
    if b.kind!=if prep{"ignite-private-name-preparation-admission-v2"}else{"ignite-private-name-admission-v1"} || b.approval_id.is_empty() || b.approval_id.len()>128 || b.identity!=identity || b.operator!=operator || b.request!=w.request
        || b.plan_hash.len()!=64 || !b.plan_hash.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c))
        || (!prep && b.request.operation_id!=format!("names:club-name-conversion-{}",b.plan_hash)) || b.rows.is_empty() || b.rows.len()>4096{return Err("Exact signed conversion binding required".into());}
    let bytes=approval_bytes(b);
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
// Consensus readback of the retained exact signed bytes, not a phase/boolean.
// Returning None permits delivery preparation, never unknown-outcome replay.
#[ic_cdk::update]
fn read_private_name_conversion_approval(operation_id:String)->Outcome<Option<ApprovalReceipt>>{
    super::private_name_write_coordinator::access()?;
    let w=super::private_name_write_coordinator::get(&operation_id)?;
    let Some(bytes)=APPROVALS.with(|m|m.borrow().get(&operation_id)) else {return Ok(None)};
    let a:SignedApproval=super::decode(&bytes);
    validate(&a,&w,ic_cdk::api::msg_caller(),ic_cdk::api::canister_self(),&key()?)?;
    let mut signed=approval_bytes(&a.body);signed.extend_from_slice(&a.signature);
    Ok(Some(ApprovalReceipt{request:a.body.request,approval_id:a.body.approval_id,plan_hash:a.body.plan_hash,operator:a.body.operator,identity:a.body.identity,signed_digest:Sha256::digest(signed).to_vec()}))
}
#[ic_cdk::update]
fn approve_private_name_conversion(operation_id:String,approval:SignedApproval)->Outcome<()>{
    super::private_name_write_coordinator::access()?;let w=super::private_name_write_coordinator::get(&operation_id)?;
    validate(&approval,&w,ic_cdk::api::msg_caller(),ic_cdk::api::canister_self(),&key()?)?;
    if let Ok(prior)=get(&operation_id){if prior!=approval{return Err("Original signed approval is immutable".into());}return Ok(());}
    if w.phase!=WritePhase::Fencing{return Err("Approval required before conversion opens".into());}
    if super::private_name_writer_window::preparation(&w.request) && (w.opened.len()!=w.writers.len() || w.opened.iter().any(|r|r.request!=w.request||r.closing||r.sealed||r.active!=candid::Nat::from(0u8))){return Err("Every preparation participant must drain before signed admission".into());}
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
    let bytes=match &club{None=>r.ciphertext.clone(),Some(id)=>r.clubs.iter().find(|c|&c.club==id).ok_or("Exact approved club required")?.ciphertext.clone()};
    if acknowledged(&operation_id,&r,club.clone(),&bytes){return Ok(());}
    let reply=ic_cdk::call::Call::bounded_wait(r.sink,"register_conversion_name").with_args(&(w.request.clone(),r.subject,club.clone(),bytes.clone())).await.map_err(|_|"Conversion ciphertext outcome unknown; retain locks")?;
    let result:Outcome<()>=reply.candid().map_err(|_|"Invalid conversion ciphertext reply")?;
    super::private_name_write_coordinator::access()?;require_approval(&operation_id,&super::private_name_write_coordinator::get(&operation_id)?)?;
    result?;
    WRITES.with(|m|m.borrow_mut().insert(receipt_key(&operation_id,&account_id,&club),Sha256::digest(&bytes).to_vec()));Ok(())
}
#[ic_cdk::update]
fn publish_approved_private_name(operation_id:String,account_id:String)->Outcome<Profile>{
    let(w,r)=approved_row(&operation_id,&account_id)?;let _lease=super::private_name_writer_window::enter_conversion(&w.request)?;
    let reference=format!("pii-display-name:v1:{}:{}",r.sink.to_text(),r.subject.to_text());let existing=super::get_profile_entry(&account_id).ok_or("Exact profile required")?;
    if !acknowledged(&operation_id,&r,None,&r.ciphertext) || r.clubs.iter().any(|c|!acknowledged(&operation_id,&r,Some(c.club.clone()),&c.ciphertext)){return Err("Approved ciphertext writes required before publication".into());}
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