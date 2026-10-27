//! Conservative whole-authority rehearsal barrier. Never a production switch.
//! Fences every original PII before opening any writer; seals every writer
//! before releasing any sink. Registry/topology mutation stays refused.
use candid::{CandidType, Principal};
use serde::{Deserialize, Serialize};
use ic_stable_structures::{StableBTreeMap, StableCell};
use std::{cell::RefCell, collections::BTreeSet};
use sha2::{Digest, Sha256};
use super::{Outcome, private_name_writer_window::{WriterRequest,WriterReceipt}};
use super::private_name_coordination::Receipt as SinkReceipt;

#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub enum WritePhase { Fencing, Opening, Writing, Closing, Releasing, Done }
#[derive(Clone, Debug, CandidType, Serialize, Deserialize, PartialEq, Eq)]
pub struct WriteWindow {
    pub request: WriterRequest, pub phase: WritePhase,
    pub inventory: super::group_inventory::RemovalInventory,
    pub sinks: Vec<Principal>, pub writers: Vec<Principal>,
    pub prepared: Vec<SinkReceipt>, pub opened: Vec<WriterReceipt>,
    pub sealed: Vec<WriterReceipt>, pub completed: Vec<SinkReceipt>,
}
thread_local! {
    static JOURNAL: RefCell<StableBTreeMap<String,Vec<u8>,super::Memory>> = RefCell::new(StableBTreeMap::init(super::memory(28)));
    static GENERATION: RefCell<StableCell<u64,super::Memory>> = RefCell::new(StableCell::init(super::memory(29),0));
}
fn get(id:&str)->Outcome<WriteWindow>{JOURNAL.with(|m|m.borrow().get(&id.to_string())).map(|b|super::decode(&b)).ok_or("Exact private-name write window required".into())}
fn save(w:&WriteWindow){JOURNAL.with(|m|m.borrow_mut().insert(w.request.operation_id.clone(),super::encode(w)));}
pub(super) fn pending()->bool{JOURNAL.with(|m|m.borrow().iter().any(|e|super::decode::<WriteWindow>(&e.value()).phase!=WritePhase::Done))}
fn access()->Outcome<()> {
    if option_env!("IGNITE_PRIVATE_PROFILE_READS_REHEARSAL")!=Some("1") || !super::private_name_writer_window::enabled() || !super::account_group_rehearsal_enabled(){return Err("All-writer private-name rehearsal required".into());}
    super::require_governor(&super::state(),ic_cdk::api::msg_caller())
}
fn create(id:String,generation:u64,inventory:super::group_inventory::RemovalInventory,identity:Principal)->Outcome<WriteWindow>{
    if id.is_empty()||id.len()>100||generation==0{return Err("Invalid private-name write operation".into());}
    let clubs=inventory.groups.snapshot.groups.iter().flat_map(|g|g.domains.iter().filter(|d|d.domain=="club_domain").map(|d|d.canister)).collect::<Vec<_>>();
    super::group_inventory::validate_complete(&inventory.groups.snapshot,&inventory.groups.binding,&clubs,&[],&inventory.supplemental,&inventory.media)?;
    let domains=["club_domain","messaging_domain","competition_domain","mini_league_domain"];
    let mut sinks=BTreeSet::new();let mut writers=BTreeSet::from([identity]);
    for d in inventory.groups.snapshot.groups.iter().flat_map(|g|&g.domains){if d.domain=="pii_access_control"{sinks.insert(d.canister);}if domains.contains(&d.domain.as_str()){writers.insert(d.canister);}}
    for d in &inventory.supplemental{if d.domain=="pii_access_control"{sinks.insert(d.canister);}if domains.contains(&d.domain.as_str()){writers.insert(d.canister);}}
    // Registries remain closed for the entire rehearsal, not opened for
    // ordinary writes. Their topology cannot escape the pinned inventory.
    if !inventory.supplemental.iter().any(|d|d.domain=="identity_access"&&d.canister==identity)
        || !inventory.supplemental.iter().any(|d|d.domain=="placement_registry") {
        return Err("Explicit identity and placement registry inventory required".into());
    }
    if sinks.is_empty()||sinks.len()>256||writers.len()>256||sinks.iter().any(|p|writers.contains(p)){return Err("Bounded distinct writer and original-PII inventory required".into());}
    let request=WriterRequest{operation_id:format!("names:{id}"),generation,inventory_digest:Sha256::digest(super::encode(&inventory)).to_vec()};
    Ok(WriteWindow{request,phase:WritePhase::Fencing,inventory,sinks:sinks.into_iter().collect(),writers:writers.into_iter().collect(),prepared:vec![],opened:vec![],sealed:vec![],completed:vec![]})
}
impl WriteWindow {
    fn sink_receipt(&self,target:Principal,r:&SinkReceipt,completed:bool)->Outcome<()> {
        if !self.sinks.contains(&target)||r.receiver!=target||r.request.operation_id!=self.request.operation_id||r.request.generation!=self.request.generation||r.request.inventory_digest!=self.request.inventory_digest||r.completed!=completed||r.release_epoch==0u8.into(){return Err("Private-name sink receipt mismatch".into());}
        if completed&&self.prepared.iter().find(|p|p.receiver==target).is_none_or(|p|r.release_epoch<=p.release_epoch){return Err("Private-name completion epoch did not advance".into());}Ok(())
    }
    fn writer_receipt(&self,target:Principal,r:&WriterReceipt,sealed:bool)->Outcome<()> {
        if !self.writers.contains(&target)||r.receiver!=target||r.request!=self.request||r.closing!=sealed||r.sealed!=sealed||(sealed&&r.active!=0u8.into()){return Err("Private-name writer receipt mismatch or not drained".into());}Ok(())
    }
    fn merge_sink(&mut self,target:Principal,r:SinkReceipt,completed:bool)->Outcome<()> {
        self.sink_receipt(target,&r,completed)?;
        if self.phase!=if completed{WritePhase::Releasing}else{WritePhase::Fencing}{return Err("Private-name sink phase changed".into());}
        let rows=if completed{&mut self.completed}else{&mut self.prepared};
        if !rows.iter().any(|p|p.receiver==target){rows.push(r);}
        if completed&&rows.len()==self.sinks.len(){self.phase=WritePhase::Done;}
        if !completed&&rows.len()==self.sinks.len(){self.phase=WritePhase::Opening;}Ok(())
    }
    fn merge_writer(&mut self,target:Principal,r:WriterReceipt,sealed:bool)->Outcome<()> {
        self.writer_receipt(target,&r,sealed)?;
        if self.phase!=if sealed{WritePhase::Closing}else{WritePhase::Opening}{return Err("Private-name writer phase changed".into());}
        let rows=if sealed{&mut self.sealed}else{&mut self.opened};
        if !rows.iter().any(|p|p.receiver==target){rows.push(r);}
        if rows.len()==self.writers.len(){self.phase=if sealed{WritePhase::Releasing}else{WritePhase::Writing};}Ok(())
    }
}
#[ic_cdk::update]
async fn begin_private_name_write_window(operation_id:String,expected_history_revision:u64)->Outcome<WriteWindow>{
    access()?;
    if let Ok(w)=get(&operation_id){return Ok(w);}
    if pending()||super::private_name_coordination::any_pending(){return Err("Another private-name operation remains unresolved".into());}
    if JOURNAL.with(|m|m.borrow().len())>=4096{return Err("Private-name write journal capacity reached".into());}
    let inventory=super::read_removal_inventory_evidence(expected_history_revision).await?;
    access()?;
    if let Ok(w)=get(&operation_id){return Ok(w);}
    if pending()||super::private_name_coordination::any_pending()||super::removal_history_revision()!=expected_history_revision{return Err("Private-name write preparation changed".into());}
    if JOURNAL.with(|m|m.borrow().len())>=4096{return Err("Private-name write journal capacity reached".into());}
    let generation=GENERATION.with(|m|m.borrow().get().checked_add(1)).ok_or("Private-name write generation exhausted")?;
    let w=create(operation_id.clone(),generation,inventory,ic_cdk::api::canister_self())?;
    // This bounded rehearsal refuses a profile inventory too large to inspect,
    // never treats an omitted original reference as complete.
    if super::PROFILES.with(|m|m.borrow().len())>4096{return Err("Original profile inventory exceeds rehearsal inspection budget".into());}
    for profile in super::all_profiles(){if profile.display_name.starts_with("pii-display-name:"){
        let parts=profile.display_name.split(':').collect::<Vec<_>>();
        if parts.len()!=4||parts[1]!="v1"||Principal::from_text(parts[2]).ok().is_none_or(|p|!w.sinks.contains(&p)){return Err("Original PII profile reference omitted from inventory".into());}
    }}
    // Stable key is the external operation ID; wire ID has a separate prefix.
    GENERATION.with(|m|m.borrow_mut().set(generation));JOURNAL.with(|m|m.borrow_mut().insert(operation_id,super::encode(&w)));Ok(w)
}
fn save_at(id:&str,w:&WriteWindow){JOURNAL.with(|m|m.borrow_mut().insert(id.to_string(),super::encode(w)));}
#[ic_cdk::update]
fn read_private_name_write_window(operation_id:String)->Outcome<WriteWindow>{access()?;get(&operation_id)}
#[ic_cdk::update]
fn close_private_name_write_window(operation_id:String)->Outcome<WriteWindow>{
    access()?;let mut w=get(&operation_id)?;
    if w.phase==WritePhase::Writing{w.phase=WritePhase::Closing;save_at(&operation_id,&w);}
    else if w.phase!=WritePhase::Closing&&w.phase!=WritePhase::Releasing&&w.phase!=WritePhase::Done{return Err("All writers must be opened before closing".into());}Ok(w)
}
#[ic_cdk::update]
async fn advance_private_name_write_window(operation_id:String,target:Principal)->Outcome<WriteWindow>{
    access()?;let w=get(&operation_id)?;
    let phase=w.phase.clone();
    match phase {
        WritePhase::Fencing|WritePhase::Releasing=>{
            if !w.sinks.contains(&target){return Err("Exact original PII sink required".into());}
            let method=if phase==WritePhase::Fencing{"prepare_private_name_release_fence"}else{"complete_private_name_release_fence"};
            let _=ic_cdk::call::Call::bounded_wait(target,method).with_arg(&w.request).await;
            let reply=ic_cdk::call::Call::bounded_wait(target,"read_private_name_release_fence").with_arg(&w.request).await.map_err(|_|"Private-name sink outcome unknown; retain window")?;
            let receipt:Outcome<SinkReceipt>=reply.candid().map_err(|_|"Invalid private-name sink receipt")?;
            access()?;let mut current=get(&operation_id)?;
            current.merge_sink(target,receipt?,phase==WritePhase::Releasing)?;save_at(&operation_id,&current);Ok(current)
        },
        WritePhase::Opening|WritePhase::Closing=>{
            if !w.writers.contains(&target){return Err("Exact participating writer required".into());}
            let method=if phase==WritePhase::Opening{"open_private_name_writer_window"}else{"seal_private_name_writer_window"};
            let _=ic_cdk::call::Call::bounded_wait(target,method).with_arg(&w.request).await;
            let reply=ic_cdk::call::Call::bounded_wait(target,"read_private_name_writer_window").with_arg(&w.request).await.map_err(|_|"Private-name writer outcome unknown; retain window")?;
            let receipt:Outcome<WriterReceipt>=reply.candid().map_err(|_|"Invalid private-name writer receipt")?;
            access()?;let mut current=get(&operation_id)?;
            current.merge_writer(target,receipt?,phase==WritePhase::Closing)?;save_at(&operation_id,&current);Ok(current)
        },
        WritePhase::Done=>Ok(w),
        WritePhase::Writing=>Err("Use authorized owning-service mutations, then close the window".into()),
    }
}

#[cfg(test)]mod tests{
    use super::*;
    fn fixture()->WriteWindow{
        let (snapshot,binding,clubs)=super::super::group_inventory::tests::fixture();let p=|n|Principal::from_slice(&[n,1]);
        let supplemental=vec![super::super::group_inventory::Supplemental{group_id:"g0".into(),domain:"media_blob_store".into(),canister:p(91),subnet:p(80)},super::super::group_inventory::Supplemental{group_id:"g1".into(),domain:"media_blob_store".into(),canister:p(92),subnet:p(80)},super::super::group_inventory::Supplemental{group_id:"g0".into(),domain:"identity_access".into(),canister:p(93),subnet:p(80)},super::super::group_inventory::Supplemental{group_id:"g0".into(),domain:"placement_registry".into(),canister:p(94),subnet:p(80)}];
        let media=clubs.iter().enumerate().map(|(n,c)|super::super::group_inventory::MediaEvidence{club_authority:*c,registry:super::super::group_inventory::MediaRegistry{active:false,stores:vec![p(91+n as u8)]}}).collect();
        create("test".into(),1,super::super::group_inventory::RemovalInventory{groups:super::super::group_inventory::Evidence{binding,history_revision:0,snapshot},supplemental,media},p(93)).unwrap()
    }
    fn sink(w:&WriteWindow,t:Principal,done:bool)->SinkReceipt{SinkReceipt{request:super::super::private_name_coordination::Request{operation_id:w.request.operation_id.clone(),generation:w.request.generation,inventory_digest:w.request.inventory_digest.clone()},receiver:t,completed:done,release_epoch:if done{2u8.into()}else{1u8.into()}}}
    fn writer(w:&WriteWindow,t:Principal,sealed:bool)->WriterReceipt{WriterReceipt{request:w.request.clone(),receiver:t,closing:sealed,sealed,active:0u8.into()}}
    #[test]fn no_writer_opens_until_every_original_sink_fenced(){let mut w=fixture();assert_eq!(w.sinks.len(),2);assert_eq!(w.writers.len(),9);let t=w.writers[0];assert!(w.merge_writer(t,writer(&w,t,false),false).is_err());for t in w.sinks.clone(){w.merge_sink(t,sink(&w,t,false),false).unwrap();}assert_eq!(w.phase,WritePhase::Opening);}
    #[test]fn no_sink_reopens_until_every_writer_drains(){let mut w=fixture();w.phase=WritePhase::Closing;let t=w.sinks[0];assert!(w.merge_sink(t,sink(&w,t,true),true).is_err());for t in w.writers.clone(){let mut r=writer(&w,t,true);r.active=1u8.into();assert!(w.merge_writer(t,r,true).is_err());w.merge_writer(t,writer(&w,t,true),true).unwrap();}assert_eq!(w.phase,WritePhase::Releasing);}
    #[test]fn late_reply_cannot_regress_phase_or_replace_receipts(){let mut w=fixture();for t in w.sinks.clone(){w.merge_sink(t,sink(&w,t,false),false).unwrap();}let t=w.sinks[0];assert!(w.merge_sink(t,sink(&w,t,false),false).is_err());assert_eq!(w.phase,WritePhase::Opening);assert_eq!(w.prepared.len(),2);}
    #[test]fn receiver_request_and_generation_are_exact(){let mut w=fixture();let t=w.sinks[0];let mut r=sink(&w,t,false);r.request.generation+=1;assert!(w.merge_sink(t,r,false).is_err());assert!(w.prepared.is_empty());}
    #[test]fn every_completion_is_durable_before_done(){let mut w=fixture();for t in w.sinks.clone(){w.merge_sink(t,sink(&w,t,false),false).unwrap();}w.phase=WritePhase::Releasing;let t=w.sinks[0];w.merge_sink(t,sink(&w,t,true),true).unwrap();let mut restored:WriteWindow=super::super::decode(&super::super::encode(&w));assert_eq!(restored.phase,WritePhase::Releasing);let t=restored.sinks[1];restored.merge_sink(t,sink(&restored,t,true),true).unwrap();assert_eq!(restored.phase,WritePhase::Done);}
}