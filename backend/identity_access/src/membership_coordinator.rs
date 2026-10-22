//! Durable multi-source reconstruction coordinator. Only authority-derived
//! pages may enter it; no browser/public ingress or production cutover exists.
use candid::Principal;
use ic_stable_structures::{Memory,StableBTreeMap};
use serde::{Deserialize,Serialize};
use sha2::{Digest,Sha256};
use std::ops::Bound::{Excluded,Unbounded};
use crate::{group_inventory, membership_materializer::{Binding,Builder,Edge},
    membership_namespace::{Pool,Lane}, membership_updates::Journal,
    membership_private_lookup::{Source,Viewer,Sessions,Page,Continuation}};
type Outcome<T> = Result<T,String>;
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
struct Inventory {generation:u64,digest:[u8;32],sources:Vec<(String,Principal)>}
/// Construction is deliberately private to this module. Runtime verification
/// must obtain complete consensus evidence before calling `verify_inventory`.
pub struct VerifiedInventory(Inventory);
impl VerifiedInventory {
    pub fn digest(&self)->[u8;32]{self.0.digest}
    pub fn source_bindings(&self)->Vec<(String,Principal)>{self.0.sources.clone()}
}
#[derive(Clone,Debug,Serialize,Deserialize)]
struct Build {namespace:u64,binding:Binding,published:bool,
    #[serde(default)] subject_cursor:Option<String>,#[serde(default)] indexed:bool}
pub struct Coordinator<M:Memory+Clone> {
    rows:StableBTreeMap<String,Vec<u8>,M>,pool:Pool<M>,journal:Journal<M>,
}
fn encode<T:Serialize>(v:&T)->Vec<u8>{let mut b=vec![];ciborium::into_writer(v,&mut b).expect("coordinator encode");b}
fn decode<T:for<'a>Deserialize<'a>>(b:&[u8])->T{ciborium::from_reader(b).expect("coordinator decode")}
/// Does not infer legacy ownership from missing router assignments. Every
/// required authority must explicitly appear in verified registered groups.
pub fn verify_inventory(snapshot:&group_inventory::Snapshot,pin:&group_inventory::Binding,
    required_authorities:&[Principal],generation:u64)->Outcome<VerifiedInventory>{
    group_inventory::validate(snapshot,pin,required_authorities,&[])?;
    if generation==0||required_authorities.is_empty(){return Err("Complete directory authority generation required".into());}
    let mut sources=Vec::new();for g in &snapshot.groups{
        if g.id.contains('\u{1f}'){return Err("Invalid directory source id".into());}
        let authority=g.domains.iter().find(|d|d.domain=="club_domain").ok_or("Missing club authority")?.canister;
        sources.push((g.id.clone(),authority));
    }
    sources.sort_by(|a,b|a.0.cmp(&b.0));
    let mut exact:Vec<_>=sources.iter().map(|(_,p)|*p).collect();exact.sort();exact.dedup();
    let mut required=required_authorities.to_vec();required.sort();required.dedup();
    if exact!=required||required.len()!=required_authorities.len(){return Err("Exact complete authority inventory required".into());}
    let digest=Sha256::digest(encode(&(pin,snapshot,&sources,generation))).into();
    Ok(VerifiedInventory(Inventory{generation,digest,sources}))
}
impl<M:Memory+Clone> Coordinator<M>{
    pub fn open(metadata:M,pool:Pool<M>,journal_memory:M)->Self{Self{rows:StableBTreeMap::init(metadata),pool,journal:Journal::open(journal_memory)}}
    fn inventory(&self)->Outcome<Inventory>{self.rows.get(&"inventory".into()).map(|b|decode(&b)).ok_or("Directory inventory unverified".into())}
    pub fn verified_generation(&self)->Outcome<u64>{Ok(self.inventory()?.generation)}
    fn build(&self,source:&str)->Option<Build>{self.rows.get(&format!("source:{source}")).map(|b|decode(&b))}
    fn save(&mut self,source:&str,b:&Build){self.rows.insert(format!("source:{source}"),encode(b));}
    pub fn bind_inventory(&mut self,verified:VerifiedInventory)->Outcome<()>{
        let next=verified.0;
        if let Ok(prior)=self.inventory(){
            if prior==next{return Ok(());}
            // Recovery/configuration replacement is externally fenced. A
            // restored local counter is never automatically a new generation.
            if next.generation<=prior.generation{return Err("New externally fenced inventory generation required".into());}
            // Retire each existing source via bounded `retire_source` first.
            if prior.sources.iter().any(|(s,_)|self.build(s).is_some()){return Err("Retire prior source builds before inventory replacement".into());}
        }
        self.rows.insert("inventory".into(),encode(&next));Ok(())
    }
    pub fn begin(&mut self,source:&str,authority:Principal,revision:u64)->Outcome<Binding>{
        let inventory=self.inventory()?;
        if revision==0||!inventory.sources.iter().any(|(s,p)|s==source&&*p==authority){return Err("Exact registered source authority required".into());}
        let binding=Binding{authority,generation:inventory.generation,revision,inventory_digest:inventory.digest};
        if let Some(prior)=self.build(source){
            if prior.binding==binding{return Ok(binding);}
            if prior.binding.authority!=authority||prior.binding.generation!=binding.generation||revision<=prior.binding.revision{return Err("Stale source reconstruction".into());}
        }
        // An Err is not a transaction rollback. Check the persisted journal
        // before allocating/retiring so stale requests consume no storage.
        self.journal.validate_new_build(source,&binding)?;
        // Allocate before retiring: a capacity refusal preserves the old tree.
        let n=self.pool.allocate()?;let mut builder=Builder::open(self.pool.lanes(n)?);builder.begin(binding.clone())?;
        if let Some(prior)=self.build(source){self.pool.retire(prior.namespace)?;self.rows.insert(format!("retired:{:020}",prior.namespace),encode(&prior.namespace));}
        match self.journal.source(source){
            Some(old) if old.binding.generation==binding.generation=>self.journal.invalidate(source,authority,binding.generation,revision,binding.inventory_digest)?,
            _=>self.journal.bind(source,binding.clone())?,
        }
        self.save(source,&Build{namespace:n,binding:binding.clone(),published:false,subject_cursor:None,indexed:false});Ok(binding)
    }
    fn builder(&self,source:&str,binding:&Binding)->Outcome<Builder<Lane<M>>>{
        let inv=self.inventory()?;let build=self.build(source).ok_or("Source reconstruction missing")?;
        if &build.binding!=binding||binding.generation!=inv.generation||binding.inventory_digest!=inv.digest{return Err("Source callback binding changed".into());}
        Ok(Builder::open(self.pool.lanes(build.namespace)?))
    }
    /// Caller is the captured, source-authenticated response authority, never
    /// an external relay's assertion; runtime must recheck after its await.
    pub fn ingest(&mut self,source:&str,authority:Principal,binding:&Binding,sequence:u64,edges:Vec<Edge>,terminal:bool)->Outcome<()>{
        if authority!=binding.authority{return Err("Foreign source response".into());}
        self.builder(source,binding)?.ingest(binding,sequence,edges,terminal)
    }
    pub fn advance(&mut self,source:&str,binding:&Binding)->Outcome<usize>{
        let scanned=self.builder(source,binding)?.advance()?;
        if scanned>0{return Ok(scanned);}
        let mut build=self.build(source).ok_or("Source missing")?;
        if build.indexed{return Ok(0);}
        let (subjects,next,scanned)=self.builder(source,binding)?.subjects(binding,build.subject_cursor.clone())?;
        for subject in subjects{
            self.rows.insert(format!("subject:{}:{source}",subject.to_text()),encode(binding));
            // Namespace-keyed reverse rows support bounded retirement cleanup.
            self.rows.insert(format!("index:{:020}:{}",build.namespace,subject.to_text()),encode(&(format!("subject:{}:{source}",subject.to_text()),binding)));
        }
        build.subject_cursor=next;build.indexed=build.subject_cursor.is_none();self.save(source,&build);
        // A terminal nonempty page is still work; publication waits one tick.
        Ok(scanned)
    }
    /// Exact club-assignment verification is an additional runtime release
    /// gate, not inferred here from membership rows or registry location.
    pub fn publish(&mut self,source:&str,binding:&Binding)->Outcome<()>{
        if !self.builder(source,binding)?.status().complete||!self.build(source).is_some_and(|b|b.indexed){return Err("Incomplete source reconstruction or subject index".into());}
        self.journal.publish(source,binding,true)?;let mut b=self.build(source).ok_or("Source missing")?;
        b.published=true;self.save(source,&b);Ok(())
    }
    pub fn acknowledge(&mut self,source:&str,binding:&Binding,readback:u64)->Outcome<()>{
        let b=self.build(source).ok_or("Source missing")?;
        if !b.published||&b.binding!=binding{return Err("Unknown directory publication".into());}
        self.journal.acknowledge(source,binding,readback)
    }
    pub fn sources(&self)->Outcome<Vec<Source>>{
        let inv=self.inventory()?;let mut out=vec![];
        for (id,authority) in inv.sources{
            let b=self.build(&id).ok_or("Directory source incomplete")?;
            if b.binding.authority!=authority||b.binding.generation!=inv.generation||b.binding.inventory_digest!=inv.digest||!b.published||!b.indexed||self.journal.pending(&id)?{return Err("Directory source incomplete".into());}
            out.push(Source{id,binding:b.binding,complete:true,eligible_aliases:None});
        }Ok(out)
    }
    pub fn private_page(&self,sessions:&mut Sessions<M>,caller:Principal,viewer:Viewer,consumer:u64,continuation:Option<Continuation>,now:u64)->Outcome<(Page,Option<Continuation>)>{
        if caller==Principal::anonymous()||viewer.aliases.is_empty()||viewer.aliases.len()>8||!viewer.aliases.contains(&caller){return Err("Caller-private verified account required".into());}
        let mut sources=self.sources()?;
        // Verified aliases are identity-owned. Read at most 100 indexed source
        // candidates per alias; unusually broad accounts fall back explicitly.
        let mut matches=std::collections::BTreeMap::<String,Vec<Principal>>::new();
        for alias in &viewer.aliases{
            let prefix=format!("subject:{}:",alias.to_text());let mut count=0;
            for row in self.rows.range(prefix.clone()..){
                if !row.key().starts_with(&prefix){break;}
                count+=1;if count>100{return Err("Account source index budget reached; existing discovery required".into());}
                let id=&row.key()[prefix.len()..];let binding:Binding=decode(&row.value());
                if sources.iter().any(|s|s.id==id&&s.binding==binding){matches.entry(id.into()).or_default().push(*alias);}
            }
        }
        for source in &mut sources{source.eligible_aliases=Some(matches.remove(&source.id).unwrap_or_default());}
        sessions.page_at(caller,viewer,sources,consumer,continuation,now,|s,p,after|self.builder(&s.id,&s.binding)?.effective_clubs_for(&s.binding,p,after))
    }
    pub fn retire_source(&mut self,source:&str)->Outcome<Option<u64>>{
        if let Some(b)=self.build(source){self.pool.retire(b.namespace)?;self.rows.insert(format!("retired:{:020}",b.namespace),encode(&b.namespace));self.rows.remove(&format!("source:{source}"));Ok(Some(b.namespace))}else{Ok(None)}
    }
    /// One retired namespace, <=100 blocks per invocation. The durable queue
    /// survives callback loss/upgrades; source publication intents never expire.
    pub fn reclaim_retired(&mut self)->Outcome<(usize,bool)>{
        let row=self.rows.range((Excluded("retired:".to_string()),Unbounded)).next().map(|e|(e.key().clone(),e.value())).filter(|(k,_)|k.starts_with("retired:"));
        let Some((key,bytes))=row else{return Ok((0,true))};let n:u64=decode(&bytes);
        let prefix=format!("index:{n:020}:");let mut removed=0;
        while removed<100{
            let row=self.rows.range(prefix.clone()..).next().map(|e|(e.key().clone(),e.value())).filter(|(k,_)|k.starts_with(&prefix));
            let Some((reverse,bytes))=row else{break;};let (subject_key,retired_binding):(String,Binding)=decode(&bytes);
            // A newer build may have replaced the same subject/source entry.
            if let Some(current)=self.rows.get(&subject_key){let binding:Binding=decode(&current);if binding==retired_binding{self.rows.remove(&subject_key);}}
            self.rows.remove(&reverse);removed+=1;
        }
        if removed>0{return Ok((removed,false));}
        let (scanned,done)=self.pool.reclaim(n)?;if done{self.rows.remove(&key);}Ok((scanned,false))
    }
    pub fn reclaim_obsolete_updates(&mut self,after:Option<String>)->Outcome<(usize,Option<String>)>{
        self.journal.reclaim_obsolete(self.inventory()?.generation,after)
    }
}
#[cfg(test)]mod tests{
    use super::*;use ic_stable_structures::{VectorMemory,memory_manager::{MemoryManager,MemoryId,VirtualMemory}};
    type Mem=VirtualMemory<VectorMemory>;
    fn open(m:&MemoryManager<VectorMemory>)->Coordinator<Mem>{Coordinator::open(m.get(MemoryId::new(0)),Pool::open(m.get(MemoryId::new(1)),m.get(MemoryId::new(2)),10000,32).unwrap(),m.get(MemoryId::new(3)))}
    fn viewer(p:Principal)->Viewer{Viewer{account:"member".into(),version:1,aliases:vec![p]}}
    #[test]fn two_source_join_publish_readback_reopen_and_removal(){
        let manager=MemoryManager::init(VectorMemory::default());let (snapshot,pin,authorities)=group_inventory::tests::fixture();let user=Principal::from_slice(&[99,1]);
        let mut c=open(&manager);c.bind_inventory(verify_inventory(&snapshot,&pin,&authorities,1).unwrap()).unwrap();let mut sessions=Sessions::open(manager.get(MemoryId::new(4)));
        for (n,authority) in authorities.iter().enumerate(){
            let source=format!("g{n}");let b=c.begin(&source,*authority,1).unwrap();
            c.ingest(&source,*authority,&b,0,vec![Edge::Club{id:format!("club{n}"),deleted:false},Edge::Role{subject:user,club:Some(format!("club{n}"))}],true).unwrap();
            assert!(c.publish(&source,&b).is_err());while c.advance(&source,&b).unwrap()>0{}
            c.publish(&source,&b).unwrap();assert!(c.sources().is_err());c.acknowledge(&source,&b,1).unwrap();
        }
        let (first,next)=c.private_page(&mut sessions,user,viewer(user),1,None,1).unwrap();assert_eq!(first.rows[0].club,"club0");assert_eq!(next.as_ref().map(|t|t.sequence),Some(1));drop(c);
        let mut c=open(&manager);let (second,next)=c.private_page(&mut sessions,user,viewer(user),1,next,1).unwrap();assert_eq!(second.rows[0].club,"club1");assert!(next.is_none());
        let b=c.begin("g0",authorities[0],2).unwrap();assert!(c.private_page(&mut sessions,user,viewer(user),1,None,2).is_err());
        c.ingest("g0",authorities[0],&b,0,vec![Edge::Club{id:"club0".into(),deleted:false}],true).unwrap();while c.advance("g0",&b).unwrap()>0{}
        c.publish("g0",&b).unwrap();assert!(c.acknowledge("g0",&b,1).is_err());c.acknowledge("g0",&b,2).unwrap();let (page,next)=c.private_page(&mut sessions,user,viewer(user),1,None,2).unwrap();assert_eq!(page.rows[0].club,"club1");assert!(next.is_none());
    }
    #[test]fn foreign_authority_stale_callback_and_inventory_replacement_never_publish(){
        let manager=MemoryManager::init(VectorMemory::default());let (snapshot,pin,authorities)=group_inventory::tests::fixture();
        assert!(verify_inventory(&snapshot,&pin,&authorities[..1],1).is_err());let mut c=open(&manager);c.bind_inventory(verify_inventory(&snapshot,&pin,&authorities,1).unwrap()).unwrap();
        assert!(c.begin("g0",authorities[1],1).is_err());let old=c.begin("g0",authorities[0],1).unwrap();let current=c.begin("g0",authorities[0],2).unwrap();
        assert!(c.ingest("g0",authorities[0],&old,0,vec![],true).is_err());assert!(c.ingest("g0",authorities[1],&current,0,vec![],true).is_err());
        assert!(c.bind_inventory(verify_inventory(&snapshot,&pin,&authorities,2).unwrap()).is_err());c.retire_source("g0").unwrap();while !c.reclaim_retired().unwrap().1{}
        c.bind_inventory(verify_inventory(&snapshot,&pin,&authorities,2).unwrap()).unwrap();assert!(c.sources().is_err());assert!(c.begin("g0",authorities[0],1).is_ok());
    }
    #[test]fn retired_binding_cannot_reuse_an_acknowledgement_or_leak_namespaces_on_failed_begin(){
        let manager=MemoryManager::init(VectorMemory::default());let (snapshot,pin,authorities)=group_inventory::tests::fixture();let mut c=open(&manager);
        c.bind_inventory(verify_inventory(&snapshot,&pin,&authorities,1).unwrap()).unwrap();let b=c.begin("g0",authorities[0],2).unwrap();
        c.ingest("g0",authorities[0],&b,0,vec![],true).unwrap();while c.advance("g0",&b).unwrap()>0{}c.publish("g0",&b).unwrap();c.acknowledge("g0",&b,2).unwrap();
        c.retire_source("g0").unwrap();while !c.reclaim_retired().unwrap().1{}
        for _ in 0..40{assert!(c.begin("g0",authorities[0],1).is_err());assert!(c.begin("g0",authorities[0],2).is_err());}
        drop(c);let mut c=open(&manager);assert!(c.begin("g0",authorities[0],3).is_ok());assert!(c.journal.pending("g0").unwrap());
    }
    #[test]fn changed_group_inventory_reclaims_old_update_rows_only_after_generation_fence(){
        let manager=MemoryManager::init(VectorMemory::default());let (mut s,mut pin,a)=group_inventory::tests::fixture();let mut c=open(&manager);
        c.bind_inventory(verify_inventory(&s,&pin,&a,1).unwrap()).unwrap();c.begin("g0",a[0],1).unwrap();c.retire_source("g0").unwrap();while !c.reclaim_retired().unwrap().1{}
        s.revision+=1;pin.registry_revision=s.revision;s.groups[0].id="replacement".into();s.placements[0].group_id="replacement".into();
        c.bind_inventory(verify_inventory(&s,&pin,&a,2).unwrap()).unwrap();c.begin("replacement",a[0],1).unwrap();c.reclaim_obsolete_updates(None).unwrap();
        assert!(c.journal.source("g0").is_none());assert!(c.journal.pending("replacement").unwrap());assert!(c.begin("g0",a[0],100).is_err());
    }
    fn finish(c:&mut Coordinator<Mem>,source:&str,authority:Principal,revision:u64,edges:Vec<Edge>){
        let binding=c.begin(source,authority,revision).unwrap();
        for (sequence,chunk) in edges.chunks(100).enumerate(){c.ingest(source,authority,&binding,sequence as u64,chunk.to_vec(),(sequence+1)*100>=edges.len()).unwrap();}
        if edges.is_empty(){c.ingest(source,authority,&binding,0,vec![],true).unwrap();}
        while c.advance(source,&binding).unwrap()>0{}
        c.publish(source,&binding).unwrap();c.acknowledge(source,&binding,revision).unwrap();
    }
    #[test]fn single_source_members_skip_empty_groups_after_reopen_and_removal_clears_the_index(){
        let manager=MemoryManager::init(VectorMemory::default());let (snapshot,pin,a)=group_inventory::tests::fixture();let user=Principal::from_slice(&[99,1]);let mut c=open(&manager);
        c.bind_inventory(verify_inventory(&snapshot,&pin,&a,1).unwrap()).unwrap();
        finish(&mut c,"g0",a[0],1,vec![Edge::Club{id:"empty".into(),deleted:false}]);
        finish(&mut c,"g1",a[1],1,vec![Edge::Club{id:"member".into(),deleted:false},Edge::Role{subject:user,club:Some("member".into())}]);drop(c);
        let mut c=open(&manager);let mut sessions=Sessions::open(manager.get(MemoryId::new(4)));
        let (page,next)=c.private_page(&mut sessions,user,viewer(user),1,None,1).unwrap();assert_eq!(page.rows[0].source,"g1");assert_eq!(page.scanned,1);assert_eq!(next,None);
        finish(&mut c,"g1",a[1],2,vec![Edge::Club{id:"member".into(),deleted:false}]);
        let (page,next)=c.private_page(&mut sessions,user,viewer(user),1,None,2).unwrap();assert!(page.rows.is_empty());assert_eq!(page.scanned,0);assert_eq!(next,None);
        while !c.reclaim_retired().unwrap().1{}
        assert!(c.rows.get(&format!("subject:{}:g1",user.to_text())).is_none());
    }
    #[test]fn bounded_subject_staging_blocks_publication_and_cleanup_preserves_newer_members(){
        let manager=MemoryManager::init(VectorMemory::default());let (snapshot,pin,a)=group_inventory::tests::fixture();let mut c=open(&manager);
        c.bind_inventory(verify_inventory(&snapshot,&pin,&a,1).unwrap()).unwrap();let binding=c.begin("g0",a[0],1).unwrap();
        let mut edges=vec![Edge::Club{id:"club".into(),deleted:false}];
        for n in 0..251u16{edges.push(Edge::Role{subject:Principal::from_slice(&n.to_be_bytes()),club:Some("club".into())});}
        for (n,chunk) in edges.chunks(100).enumerate(){c.ingest("g0",a[0],&binding,n as u64,chunk.to_vec(),n==2).unwrap();}
        while !c.builder("g0",&binding).unwrap().status().complete{assert!(c.advance("g0",&binding).unwrap()<=100);}
        assert!(c.publish("g0",&binding).is_err());assert_eq!(c.advance("g0",&binding).unwrap(),100);drop(c);
        let mut c=open(&manager);assert_eq!(c.advance("g0",&binding).unwrap(),100);assert_eq!(c.advance("g0",&binding).unwrap(),51);assert_eq!(c.advance("g0",&binding).unwrap(),0);
        c.publish("g0",&binding).unwrap();c.acknowledge("g0",&binding,1).unwrap();let user=Principal::from_slice(&0u16.to_be_bytes());
        finish(&mut c,"g0",a[0],2,vec![Edge::Club{id:"club".into(),deleted:false},Edge::Role{subject:user,club:Some("club".into())}]);
        let (scanned,done)=c.reclaim_retired().unwrap();assert_eq!(scanned,100);assert!(!done);while !c.reclaim_retired().unwrap().1{}
        let current:Binding=decode(&c.rows.get(&format!("subject:{}:g0",user.to_text())).unwrap());assert_eq!(current.revision,2);
    }
    #[test]fn app_wide_and_family_aliases_are_indexed_but_exclusions_and_incomplete_sources_cannot_hide_access(){
        let manager=MemoryManager::init(VectorMemory::default());let (snapshot,pin,a)=group_inventory::tests::fixture();let mut c=open(&manager);
        c.bind_inventory(verify_inventory(&snapshot,&pin,&a,1).unwrap()).unwrap();let user=Principal::from_slice(&[99,1]);let guardian=Principal::from_slice(&[98,1]);let excluded=Principal::from_slice(&[97,1]);
        finish(&mut c,"g0",a[0],1,vec![Edge::Club{id:"family".into(),deleted:false},Edge::Parent{child:"child".into(),subject:user},Edge::Guardian{child:"child".into(),subject:guardian},Edge::ChildTeam{child:"child".into(),team:"team".into()},Edge::Team{id:"team".into(),club:"family".into(),deleted:false},Edge::Role{subject:excluded,club:Some("family".into())},Edge::Excluded{subject:excluded,club:"family".into()}]);
        let mut sessions=Sessions::open(manager.get(MemoryId::new(4)));assert!(c.private_page(&mut sessions,user,viewer(user),1,None,1).is_err());
        finish(&mut c,"g1",a[1],1,vec![Edge::Club{id:"global".into(),deleted:false},Edge::Role{subject:guardian,club:None}]);
        let linked=Viewer{account:"linked".into(),version:1,aliases:vec![user,guardian]};
        let (first,next)=c.private_page(&mut sessions,user,linked.clone(),1,None,1).unwrap();assert_eq!(first.rows[0].club,"family");assert_eq!(next.as_ref().map(|t|t.sequence),Some(1));
        let (duplicate,next)=c.private_page(&mut sessions,user,linked.clone(),1,next,1).unwrap();assert!(duplicate.rows.is_empty());assert_eq!(next.as_ref().map(|t|t.sequence),Some(2));
        let (global,next)=c.private_page(&mut sessions,user,linked,1,next,1).unwrap();assert_eq!(global.rows[0].club,"global");assert_eq!(next,None);
        assert!(c.rows.get(&format!("subject:{}:g0",excluded.to_text())).is_none());
        c.begin("g1",a[1],2).unwrap();assert!(c.private_page(&mut sessions,user,viewer(user),1,None,2).is_err());
    }
}