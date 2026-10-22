//! Resume-safe bounded source-pull worker core. The production transport must
//! call the exact configured club authority; browser-submitted edges are never
//! a transport. No live timer or endpoint is enabled by this module.
use candid::{CandidType,Principal};
use ic_stable_structures::{Memory,StableBTreeMap};
use serde::{Serialize,Deserialize};
use std::ops::Bound::{Excluded,Unbounded};
use crate::{membership_coordinator::Coordinator,membership_materializer::{Binding,Edge}};
#[derive(Clone,Debug,CandidType,Serialize,Deserialize,PartialEq,Eq)]
pub struct Cursor {pub revision:u64,pub phase:u64,pub offset:u64,pub nested:u64}
#[derive(Clone,Debug)]
pub struct SourcePage {pub revision:u64,pub edges:Vec<Edge>,pub next:Option<Cursor>,pub scanned:usize}
#[derive(Clone,Debug,Serialize,Deserialize,PartialEq,Eq)]
enum Phase {Pull,Materialize,Published,Acknowledged}
#[derive(Clone,Debug,Serialize,Deserialize)]
struct Job {source:String,binding:Binding,sequence:u64,cursor:Option<Cursor>,phase:Phase}
const MAX_WORKER_JOBS:u64=8192;
pub struct Worker<M:Memory>{jobs:StableBTreeMap<String,Vec<u8>,M>}
fn encode<T:Serialize>(v:&T)->Vec<u8>{let mut b=vec![];ciborium::into_writer(v,&mut b).expect("propagation encode");b}
fn decode<T:for<'a>Deserialize<'a>>(b:&[u8])->T{ciborium::from_reader(b).expect("propagation decode")}
impl<M:Memory> Worker<M>{
    pub fn open(memory:M)->Self{Self{jobs:StableBTreeMap::init(memory)}}
    fn job(&self,source:&str)->Result<Job,String>{self.jobs.get(&source.into()).map(|b|decode(&b)).ok_or("Source propagation not started".into())}
    fn save(&mut self,j:&Job){self.jobs.insert(j.source.clone(),encode(j));}
    pub fn phase(&self,source:&str)->Result<(&'static str,u64),String>{
        let j=self.job(source)?;
        Ok((match j.phase{Phase::Pull=>"pull",Phase::Materialize=>"materialize",Phase::Published=>"published",Phase::Acknowledged=>"acknowledged"},j.binding.revision))
    }
    pub fn start<N:Memory+Clone>(&mut self,c:&mut Coordinator<N>,source:&str,authority:Principal,revision:u64)->Result<(),String>{
        if !self.jobs.contains_key(&source.to_string())&&self.jobs.len()>=MAX_WORKER_JOBS{return Err("Source worker budget reached".into());}
        let binding=c.begin(source,authority,revision)?;
        if let Ok(prior)=self.job(source){if prior.binding==binding{return Ok(());}}
        self.save(&Job{source:source.into(),binding,sequence:0,cursor:None,phase:Phase::Pull});Ok(())
    }
    /// Finish one retained generation before starting the latest live one.
    /// A source restored below the captured revision is never accepted.
    pub fn resume_or_start<N:Memory+Clone>(&mut self,c:&mut Coordinator<N>,source:&str,authority:Principal,revision:u64)->Result<(),String>{
        if let Ok(prior)=self.job(source){
            if prior.binding.authority!=authority||revision<prior.binding.revision{return Err("Retained source authority or revision changed".into());}
            if prior.phase!=Phase::Acknowledged{return Ok(());}
        }
        self.start(c,source,authority,revision)
    }
    /// This request is persisted before the future runtime awaits a response.
    pub fn request(&self,source:&str)->Result<(Binding,Option<Cursor>),String>{
        let j=self.job(source)?;if j.phase!=Phase::Pull{return Err("Source pull is not pending".into());}Ok((j.binding,j.cursor))
    }
    /// After an await, check exact local job plus captured authority/binding.
    /// A newer job rejects a late callback without changing its cursor.
    pub fn accept<N:Memory+Clone>(&mut self,c:&mut Coordinator<N>,source:&str,
        captured:&Binding,request_cursor:&Option<Cursor>,page:SourcePage)->Result<(),String>{
        let mut j=self.job(source)?;
        if &j.binding!=captured||&j.cursor!=request_cursor||j.phase!=Phase::Pull{return Err("Source propagation callback changed".into());}
        if page.revision!=captured.revision||page.scanned>100||page.edges.len()>page.scanned||page.edges.len()>100||
            (page.scanned==0&&page.next.is_some())||page.next.as_ref().is_some_and(|n|n.revision!=captured.revision||n.phase>=8||request_cursor.as_ref().is_some_and(|old|(n.phase,n.offset,n.nested)<=(old.phase,old.offset,old.nested))){return Err("Invalid bounded source propagation page".into());}
        if encode(&page.edges).len()>100*1024{return Err("Source propagation byte budget reached".into());}
        let next_sequence=j.sequence.checked_add(1).ok_or("Source propagation sequence exhausted")?;
        c.ingest(source,captured.authority,captured,j.sequence,page.edges,page.next.is_none())?;
        j.sequence=next_sequence;j.cursor=page.next;if j.cursor.is_none(){j.phase=Phase::Materialize;}self.save(&j);Ok(())
    }
    /// One <=100-step join batch. Publication/acknowledgement is separate from
    /// remote source acknowledgement so an unknown response remains pending.
    pub fn advance<N:Memory+Clone>(&mut self,c:&mut Coordinator<N>,source:&str)->Result<usize,String>{
        let mut j=self.job(source)?;if j.phase!=Phase::Materialize{return Err("Source materialization not pending".into());}
        let scanned=c.advance(source,&j.binding)?;
        if scanned==0{c.publish(source,&j.binding)?;j.phase=Phase::Published;self.save(&j);}Ok(scanned)
    }
    pub fn published(&self,source:&str)->Result<Binding,String>{let j=self.job(source)?;if j.phase!=Phase::Published&&j.phase!=Phase::Acknowledged{return Err("Directory publication pending".into());}Ok(j.binding)}
    pub fn acknowledge_readback<N:Memory+Clone>(&mut self,c:&mut Coordinator<N>,source:&str,captured:&Binding,readback:u64)->Result<(),String>{
        let mut j=self.job(source)?;if &j.binding!=captured||j.phase!=Phase::Published&&j.phase!=Phase::Acknowledged{return Err("Source acknowledgement changed".into());}
        c.acknowledge_completed(source,captured,readback)?;j.phase=Phase::Acknowledged;self.save(&j);Ok(())
    }
    /// Bounded cleanup uses the coordinator's verified generation, never a
    /// caller-supplied generation that could discard current unknown work.
    pub fn reclaim_obsolete<N:Memory+Clone>(&mut self,c:&Coordinator<N>,after:Option<String>)->Result<(usize,Option<String>),String>{
        let generation=c.verified_generation()?;let mut at=after;let mut scanned=0;
        while scanned<100{
            let row=match &at{Some(key)=>self.jobs.range((Excluded(key.clone()),Unbounded)).next(),None=>self.jobs.iter().next()}.map(|e|(e.key().clone(),e.value()));
            let Some((key,bytes))=row else{return Ok((scanned,None))};let j:Job=decode(&bytes);
            if j.binding.generation<generation{self.jobs.remove(&key);}
            at=Some(key);scanned+=1;
        }Ok((scanned,at))
    }
}
#[cfg(test)]mod tests{
    use super::*;use crate::{group_inventory,membership_coordinator::verify_inventory,membership_namespace::Pool};
    use ic_stable_structures::{VectorMemory,memory_manager::{MemoryManager,MemoryId}};
    #[test]fn bounded_pull_reopens_and_new_revision_rejects_old_callbacks(){
        let m=MemoryManager::init(VectorMemory::default());let mem=|n|m.get(MemoryId::new(n));let (snapshot,pin,authorities)=group_inventory::tests::fixture();
        let mut c=Coordinator::open(mem(0),Pool::open(mem(1),mem(2),10000,16).unwrap(),mem(3));c.bind_inventory(verify_inventory(&snapshot,&pin,&authorities,1).unwrap()).unwrap();
        let mut w=Worker::open(mem(4));w.start(&mut c,"g0",authorities[0],1).unwrap();let (b,cursor)=w.request("g0").unwrap();drop(w);
        let mut w=Worker::open(mem(4));assert_eq!(w.request("g0").unwrap(),(b.clone(),cursor.clone()));
        w.accept(&mut c,"g0",&b,&cursor,SourcePage{revision:1,edges:vec![Edge::Club{id:"a".into(),deleted:false}],next:None,scanned:1}).unwrap();
        assert!(w.accept(&mut c,"g0",&b,&cursor,SourcePage{revision:1,edges:vec![],next:None,scanned:0}).is_err());
        while w.published("g0").is_err(){assert!(w.advance(&mut c,"g0").unwrap()<=100);}
        assert!(w.acknowledge_readback(&mut c,"g0",&b,2).is_err());w.acknowledge_readback(&mut c,"g0",&b,1).unwrap();
        w.start(&mut c,"g0",authorities[0],2).unwrap();assert!(w.acknowledge_readback(&mut c,"g0",&b,1).is_err());
        assert!(w.accept(&mut c,"g0",&b,&cursor,SourcePage{revision:1,edges:vec![],next:None,scanned:0}).is_err());assert_eq!(w.request("g0").unwrap().0.revision,2);
    }
    #[test]fn malformed_page_cannot_advance_a_durable_cursor(){
        let m=MemoryManager::init(VectorMemory::default());let mem=|n|m.get(MemoryId::new(n));let (s,p,a)=group_inventory::tests::fixture();
        let mut c=Coordinator::open(mem(0),Pool::open(mem(1),mem(2),10000,16).unwrap(),mem(3));c.bind_inventory(verify_inventory(&s,&p,&a,1).unwrap()).unwrap();let mut w=Worker::open(mem(4));w.start(&mut c,"g0",a[0],1).unwrap();let (b,cursor)=w.request("g0").unwrap();
        assert!(w.accept(&mut c,"g0",&b,&cursor,SourcePage{revision:2,edges:vec![],next:None,scanned:0}).is_err());
        assert!(w.accept(&mut c,"g0",&b,&cursor,SourcePage{revision:1,edges:vec![],next:Some(Cursor{revision:1,phase:0,offset:1,nested:0}),scanned:0}).is_err());
        assert_eq!(w.request("g0").unwrap(),(b,cursor));
    }
    #[test]fn ongoing_mutations_finish_retained_job_but_never_certify_current_reads(){
        let m=MemoryManager::init(VectorMemory::default());let mem=|n|m.get(MemoryId::new(n));let (s,p,a)=group_inventory::tests::fixture();
        let mut c=Coordinator::open(mem(0),Pool::open(mem(1),mem(2),10000,16).unwrap(),mem(3));c.bind_inventory(verify_inventory(&s,&p,&a,1).unwrap()).unwrap();
        let mut w=Worker::open(mem(4));w.resume_or_start(&mut c,"g0",a[0],1).unwrap();let (b,first)=w.request("g0").unwrap();
        for n in 0..4 {
            let mut newer=b.clone();newer.revision=10+n;c.observe_invalidation("g0",&newer).unwrap();
            w.resume_or_start(&mut c,"g0",a[0],newer.revision).unwrap();let (captured,cursor)=w.request("g0").unwrap();assert_eq!(captured,b);
            w.accept(&mut c,"g0",&b,&cursor,SourcePage{revision:1,edges:vec![Edge::Club{id:format!("club{n}"),deleted:false}],next:if n<3{Some(Cursor{revision:1,phase:0,offset:n+1,nested:0})}else{None},scanned:1}).unwrap();
        }
        drop(w);let mut w=Worker::open(mem(4));
        for live in 20..100 {
            w.resume_or_start(&mut c,"g0",a[0],live).unwrap();assert_eq!(w.phase("g0").unwrap().1,1);
            if w.published("g0").is_ok(){break;}assert!(w.advance(&mut c,"g0").unwrap()<=100);
        }
        assert!(w.published("g0").is_ok());assert!(c.acknowledge("g0",&b,1).is_err());
        w.acknowledge_readback(&mut c,"g0",&b,1).unwrap();assert_eq!(w.phase("g0").unwrap(),("acknowledged",1));assert!(c.sources().is_err());
        w.resume_or_start(&mut c,"g0",a[0],100).unwrap();assert_eq!(w.request("g0").unwrap().0.revision,100);
        assert!(w.accept(&mut c,"g0",&b,&first,SourcePage{revision:1,edges:vec![],next:None,scanned:0}).is_err());
        assert!(w.resume_or_start(&mut c,"g0",a[0],99).is_err());
    }
    #[test]fn fenced_replacement_reclaims_old_jobs_and_retains_current_pending_after_reopen(){
        let m=MemoryManager::init(VectorMemory::default());let mem=|n|m.get(MemoryId::new(n));let (mut s,mut p,a)=group_inventory::tests::fixture();
        let mut c=Coordinator::open(mem(0),Pool::open(mem(1),mem(2),10000,16).unwrap(),mem(3));c.bind_inventory(verify_inventory(&s,&p,&a,1).unwrap()).unwrap();let mut w=Worker::open(mem(4));w.start(&mut c,"g0",a[0],1).unwrap();c.retire_source("g0").unwrap();while !c.reclaim_retired().unwrap().1{}
        s.revision+=1;p.registry_revision=s.revision;s.groups[0].id="replacement".into();s.placements[0].group_id="replacement".into();c.bind_inventory(verify_inventory(&s,&p,&a,2).unwrap()).unwrap();w.start(&mut c,"replacement",a[0],1).unwrap();
        assert_eq!(w.reclaim_obsolete(&c,None).unwrap(),(2,None));assert!(w.request("g0").is_err());let request=w.request("replacement").unwrap();drop(w);
        let w=Worker::open(mem(4));assert_eq!(w.request("replacement").unwrap(),request);
    }
}