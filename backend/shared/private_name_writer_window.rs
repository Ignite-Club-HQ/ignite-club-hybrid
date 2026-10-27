//! Rehearsal-only whole-authority barrier; existing method auth is unchanged.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use ic_stable_structures::StableBTreeMap;
use std::cell::RefCell;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WriterRequest { pub operation_id: String, pub generation: u64, pub inventory_digest: Vec<u8> }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WriterIntent { pub request: WriterRequest, pub closing: bool, pub sealed: bool, pub active: u64 }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WriterReceipt { pub request: WriterRequest, pub receiver: Principal, pub closing: bool, pub sealed: bool, pub active: candid::Nat }
thread_local! {
    static INTENTS: RefCell<StableBTreeMap<String, Vec<u8>, crate::Memory>> = RefCell::new(StableBTreeMap::init(crate::memory(crate::PRIVATE_NAME_WRITER_MEMORY)));
}
pub fn enabled() -> bool {
    #[cfg(target_arch="wasm32")]
    { ic_cdk::api::env_var_name_exists("IGNITE_PRIVATE_NAME_WRITER_REHEARSAL") && ic_cdk::api::env_var_value("IGNITE_PRIVATE_NAME_WRITER_REHEARSAL") == "1" }
    #[cfg(not(target_arch="wasm32"))]
    { false }
}
fn authorize() -> Result<(), String> {
    if !enabled() { return Err("Private-name writer rehearsal required".into()); }
    if !ic_cdk::api::env_var_name_exists("IGNITE_ACCOUNT_SERVICE_IDENTITY") { return Err("Configured rehearsal identity required".into()); }
    let text = ic_cdk::api::env_var_value("IGNITE_ACCOUNT_SERVICE_IDENTITY");
    let authority = Principal::from_text(text).map_err(|_| "Configured rehearsal identity required")?;
    if authority == Principal::anonymous() || authority == Principal::management_canister() || authority != ic_cdk::api::msg_caller() { return Err("Configured rehearsal identity required".into()); }
    Ok(())
}
fn load(id: &str) -> Result<WriterIntent, String> { INTENTS.with(|m| m.borrow().get(&id.to_string())).map(|b|crate::decode(&b)).ok_or("Exact private-name writer intent required".into()) }
fn save(i: &WriterIntent) { INTENTS.with(|m|m.borrow_mut().insert(i.request.operation_id.clone(),crate::encode(i))); }
fn current() -> Option<WriterIntent> { INTENTS.with(|m|m.borrow().iter().map(|e|crate::decode::<WriterIntent>(&e.value())).find(|i|!i.sealed)) }
fn ordinary_request()->WriterRequest { WriterRequest{operation_id:"ordinary:private-name-accounting-v1".into(),generation:1,inventory_digest:vec![0;32]} }
// Instrumentation starts unverified: no record certifies old, untracked calls.
fn track_ordinary()->Result<Lease,String>{
    let request=ordinary_request();
    let mut i=load(&request.operation_id).unwrap_or(WriterIntent{request:request.clone(),closing:false,sealed:true,active:0});
    if i.request!=request || i.closing || i.active>=4096{return Err("Ordinary accounting conflict or busy".into());}
    if load(&request.operation_id).is_err() && INTENTS.with(|m|m.borrow().len())>=4096{return Err("Ordinary accounting capacity reached".into());}
    i.active+=1;save(&i);Ok(Lease(Some(request)))
}
pub fn exclusive(request: &WriterRequest) -> bool { request.operation_id.starts_with("names:club-name-conversion-") }
pub fn preparation(request: &WriterRequest) -> bool { request.operation_id.starts_with("names:club-name-preparation-") }
fn preparation_pending() -> bool { INTENTS.with(|m|m.borrow().iter().any(|e|{let i:WriterIntent=crate::decode(&e.value());preparation(&i.request)&&!i.sealed})) }
// Coordinator-only local use avoids a self-call before identity admission is
// closed. Existing leases stay keyed to their original immutable intent.
pub(crate) fn freeze_local(request: WriterRequest) -> Result<(),String> {
    if !enabled() || !preparation(&request) || request.operation_id.len()>128 || request.generation==0 || request.inventory_digest.len()!=32{return Err("Exact preparation request required".into());}
    if let Ok(i)=load(&request.operation_id){if i.request!=request || i.closing || i.sealed{return Err("Immutable preparation conflict".into());}return Ok(());}
    if preparation_pending() || INTENTS.with(|m|m.borrow().len())>=4096{return Err("Preparation remains unresolved or capacity reached".into());}
    let old=INTENTS.with(|m|m.borrow().iter().map(|e|crate::decode::<WriterIntent>(&e.value())).filter(|i|!i.sealed).collect::<Vec<_>>());
    if old.iter().any(|i|exclusive(&i.request)){return Err("Conversion remains unresolved".into());}
    for mut i in old {i.closing=true;i.sealed=i.active==0;save(&i);}
    save(&WriterIntent{request,closing:false,sealed:false,active:0});Ok(())
}
pub fn freeze(request: WriterRequest) -> Result<(),String> {authorize()?;freeze_local(request)}
pub(crate) fn preparation_receipt_local(request: WriterRequest) -> Result<WriterReceipt,String> {
    let i=load(&request.operation_id)?;
    if !preparation(&request) || i.request!=request{return Err("Exact preparation receipt required".into());}
    let active=INTENTS.with(|m|m.borrow().iter().map(|e|crate::decode::<WriterIntent>(&e.value())).filter(|p|p.request!=request && (!p.sealed || p.request==ordinary_request())).try_fold(i.active,|n,p|n.checked_add(p.active))).ok_or("Preparation drain count exhausted")?;
    Ok(WriterReceipt{request,receiver:ic_cdk::api::canister_self(),closing:i.closing,sealed:i.sealed,active:active.into()})
}
pub fn preparation_receipt(request: WriterRequest) -> Result<WriterReceipt,String> {authorize()?;preparation_receipt_local(request)}
fn approved_key(request:&WriterRequest)->String{format!("approved:{}",request.operation_id)}
pub fn activate_preparation(request:WriterRequest)->Result<(),String>{
    authorize()?;let r=preparation_receipt_local(request.clone())?;
    if r.closing||r.sealed||r.active!=candid::Nat::from(0u8){return Err("Exact drained preparation required".into());}
    if INTENTS.with(|m|m.borrow().get(&approved_key(&request))).is_none() && INTENTS.with(|m|m.borrow().len())>=4096{return Err("Preparation activation capacity reached".into());}
    INTENTS.with(|m|m.borrow_mut().insert(approved_key(&request),crate::encode(&WriterIntent{request,closing:true,sealed:true,active:0})));Ok(())
}
pub fn finish_preparation(request: WriterRequest) -> Result<(),String> {
    authorize()?;let r=preparation_receipt_local(request.clone())?;
    if INTENTS.with(|m|m.borrow().get(&approved_key(&request))).is_none(){return Err("Signed preparation activation required".into());}
    if r.active!=candid::Nat::from(0u8){return Err("Preparation work remains unresolved".into());}
    let mut i=load(&request.operation_id)?;i.closing=true;i.sealed=true;save(&i);Ok(())
}
pub fn open(request: WriterRequest) -> Result<(),String> {
    authorize()?;
    if preparation(&request){return Err("Use preparation admission".into());}
    if request.operation_id==ordinary_request().operation_id{return Err("Reserved ordinary accounting identity".into());}
    if preparation_pending(){return Err("Preparation lock remains held".into());}
    if request.operation_id.is_empty() || request.operation_id.len()>128 || request.generation==0 || request.inventory_digest.len()!=32 {return Err("Invalid private-name writer request".into());}
    if let Ok(i)=load(&request.operation_id) {
        if i.request!=request {return Err("Immutable private-name writer conflict".into());}
        if i.closing||i.sealed {return Err("Private-name writer window already closing or sealed".into());}
        return Ok(());
    }
    if current().is_some(){return Err("Another private-name writer window remains open".into());}
    if INTENTS.with(|m|m.borrow().len())>=4096{return Err("Private-name writer capacity reached".into());}
    save(&WriterIntent{request,closing:false,sealed:false,active:0});Ok(())
}
pub fn seal(request: WriterRequest) -> Result<(),String> {
    authorize()?;
    if request.operation_id==ordinary_request().operation_id{return Err("Reserved ordinary accounting identity".into());}
    let mut i=load(&request.operation_id)?;
    if preparation(&request){return Err("Preparation releases only through approved completion".into());}
    if i.request!=request{return Err("Immutable private-name writer conflict".into());}
    i.closing=true;i.sealed=i.active==0;save(&i);Ok(())
}
pub fn receipt(request: WriterRequest) -> Result<WriterReceipt,String> {
    authorize()?;let i=load(&request.operation_id)?;
    if i.request!=request{return Err("Immutable private-name writer conflict".into());}
    Ok(WriterReceipt{request,receiver:ic_cdk::api::canister_self(),closing:i.closing,sealed:i.sealed,active:i.active.into()})
}
pub struct Lease(Option<WriterRequest>);
pub fn enter() -> Result<Lease,String> {
    if preparation_pending(){return Err("Edits locked for private-name preparation".into());}
    if !enabled(){
        if INTENTS.with(|m|m.borrow().iter().any(|e|{let i:WriterIntent=crate::decode(&e.value());exclusive(&i.request)&&!i.sealed})){return Err("Edits locked for private-name conversion".into());}
        return track_ordinary();
    }
    let mut i=current().ok_or("Coordinated private-name write window required")?;
    if exclusive(&i.request){return Err("Edits locked for private-name conversion".into());}
    if i.closing||i.active>=4096{return Err("Private-name writer closing or busy".into());}
    i.active+=1;save(&i);Ok(Lease(Some(i.request)))
}
// Internal identity publication uses this only after exact signed-row checks.
pub fn enter_conversion(request: &WriterRequest) -> Result<Lease,String> {
    if !enabled() || !(exclusive(request)||preparation(request)){return Err("Approved conversion window required".into());}
    if preparation(request) && INTENTS.with(|m|m.borrow().get(&approved_key(request))).is_none(){return Err("Signed preparation activation required".into());}
    let mut i=if preparation(request){load(&request.operation_id)?}else{current().ok_or("Exact open conversion window required")?};
    if i.request!=*request || i.closing || i.active>=4096{return Err("Exact open conversion window required".into());}
    i.active+=1;save(&i);Ok(Lease(Some(i.request)))
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(ref request)=self.0 {if let Ok(mut i)=load(&request.operation_id){if i.request==*request&&i.active>0{i.active-=1;if i.closing&&i.active==0{i.sealed=true;}save(&i);}}}
    }
}
pub fn require_window() { if preparation_pending() || (enabled() && current().is_none_or(|i|i.closing || exclusive(&i.request))) {ic_cdk::trap("Coordinated ordinary private-name write window required");} }

#[cfg(test)]
mod accounting_tests {
    use super::*;
    #[test]
    fn rehearsal_off_ordinary_leases_are_counted_and_cleanup_exactly_once(){
        let r=ordinary_request();let before=load(&r.operation_id).map_or(0,|i|i.active);
        let one=enter().unwrap();let two=enter().unwrap();
        assert_eq!(load(&r.operation_id).unwrap().active,before+2);
        assert!(load(&r.operation_id).unwrap().sealed); // not an open authorization window
        drop(one);assert_eq!(load(&r.operation_id).unwrap().active,before+1);
        drop(two);assert_eq!(load(&r.operation_id).unwrap().active,before);
    }
}