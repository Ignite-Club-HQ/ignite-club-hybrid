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
    { ic_cdk::api::env_var_value("IGNITE_PRIVATE_NAME_WRITER_REHEARSAL") == "1" }
    #[cfg(not(target_arch="wasm32"))]
    { false }
}
fn authorize() -> Result<(), String> {
    if !enabled() { return Err("Private-name writer rehearsal required".into()); }
    let text = ic_cdk::api::env_var_value("IGNITE_ACCOUNT_SERVICE_IDENTITY");
    let authority = Principal::from_text(text).map_err(|_| "Configured rehearsal identity required")?;
    if authority == Principal::anonymous() || authority == Principal::management_canister() || authority != ic_cdk::api::msg_caller() { return Err("Configured rehearsal identity required".into()); }
    Ok(())
}
fn load(id: &str) -> Result<WriterIntent, String> { INTENTS.with(|m| m.borrow().get(&id.to_string())).map(|b|crate::decode(&b)).ok_or("Exact private-name writer intent required".into()) }
fn save(i: &WriterIntent) { INTENTS.with(|m|m.borrow_mut().insert(i.request.operation_id.clone(),crate::encode(i))); }
fn current() -> Option<WriterIntent> { INTENTS.with(|m|m.borrow().iter().map(|e|crate::decode::<WriterIntent>(&e.value())).find(|i|!i.sealed)) }
pub fn open(request: WriterRequest) -> Result<(),String> {
    authorize()?;
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
    authorize()?; let mut i=load(&request.operation_id)?;
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
    if !enabled(){return Ok(Lease(None));}
    let mut i=current().ok_or("Coordinated private-name write window required")?;
    if i.closing||i.active>=4096{return Err("Private-name writer closing or busy".into());}
    i.active+=1;save(&i);Ok(Lease(Some(i.request)))
}
impl Drop for Lease {
    fn drop(&mut self) {
        if let Some(ref request)=self.0 {if let Ok(mut i)=load(&request.operation_id){if i.request==*request&&i.active>0{i.active-=1;save(&i);}}}
    }
}
pub fn require_window() { if enabled() && current().is_none_or(|i|i.closing) {ic_cdk::trap("Coordinated private-name write window required");} }