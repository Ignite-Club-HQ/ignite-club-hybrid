//! Bounded stable virtual memories for isolated source builds. No production
//! MemoryIds are allocated here; the runtime must supply dedicated memories.
use ic_stable_structures::{Memory, StableBTreeMap};
use serde::{Deserialize, Serialize};
use std::{cell::RefCell, rc::Rc, ops::Bound::{Excluded, Unbounded}};

const PAGE: u64 = 65536;
const BLOCK: u64 = 4096;
const LANES: u8 = 8;
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
struct Allocation { sizes: [u64; 8], retired: bool, cursor: Option<String> }
#[derive(Clone, Debug, Serialize, Deserialize)]
struct Budget { next: u64, pages: u64, max_pages: u64, max_builds: u64 }
struct State<M: Memory> {
    metadata: StableBTreeMap<String, Vec<u8>, M>,
    blocks: StableBTreeMap<String, Vec<u8>, M>,
}
#[derive(Clone)]
pub struct Pool<M: Memory + Clone> { state: Rc<RefCell<State<M>>> }
#[derive(Clone)]
pub struct Lane<M: Memory + Clone> { pool: Pool<M>, namespace: u64, lane: u8 }
fn encode<T: Serialize>(v: &T) -> Vec<u8> { let mut b=vec![];ciborium::into_writer(v,&mut b).expect("namespace encode");b }
fn decode<T: for<'a> Deserialize<'a>>(b: &[u8]) -> T { ciborium::from_reader(b).expect("namespace decode") }
fn id(n: u64) -> String { format!("build:{n:020}") }
fn prefix(n: u64) -> String { format!("{n:020}:") }
fn block(n: u64, lane: u8, at: u64) -> String { format!("{}{lane}:{at:020}",prefix(n)) }
impl<M: Memory + Clone> Pool<M> {
    pub fn open(metadata: M, blocks: M, max_pages: u64, max_builds: u64) -> Result<Self,String> {
        if max_pages == 0 || max_pages > (4 * 1024 * 1024 * 1024u64 / PAGE) || max_builds == 0 || max_builds > 16384 { return Err("Invalid namespace budget".into()); }
        let mut state=State { metadata:StableBTreeMap::init(metadata),blocks:StableBTreeMap::init(blocks) };
        match state.metadata.get(&"budget".into()) {
            Some(b) => { let prior:Budget=decode(&b);if prior.max_pages!=max_pages || prior.max_builds!=max_builds { return Err("Persisted namespace budget changed".into()); } },
            None => {state.metadata.insert("budget".into(),encode(&Budget{next:0,pages:0,max_pages,max_builds}));},
        }
        Ok(Self{state:Rc::new(RefCell::new(state))})
    }
    pub fn allocate(&self) -> Result<u64,String> {
        let mut s=self.state.borrow_mut();let mut b:Budget=decode(&s.metadata.get(&"budget".into()).ok_or("Namespace budget missing")?);
        // Retired builds count until bounded reclamation finishes.
        if s.metadata.len()-1 >= b.max_builds {return Err("Namespace build capacity reached".into());}
        b.next=b.next.checked_add(1).ok_or("Namespace exhausted")?;let n=b.next;
        s.metadata.insert(id(n),encode(&Allocation{sizes:[0;8],retired:false,cursor:None}));s.metadata.insert("budget".into(),encode(&b));Ok(n)
    }
    pub fn lanes(&self, namespace:u64) -> Result<[Lane<M>;8],String> {
        self.allocation(namespace)?;
        Ok(std::array::from_fn(|lane| Lane{pool:self.clone(),namespace,lane:lane as u8}))
    }
    fn allocation(&self,n:u64)->Result<Allocation,String>{
        let a:Allocation=decode(&self.state.borrow().metadata.get(&id(n)).ok_or("Unknown namespace")?);
        if a.retired {return Err("Namespace retired".into());}Ok(a)
    }
    pub fn retire(&self,n:u64)->Result<(),String>{
        let mut s=self.state.borrow_mut();let mut a:Allocation=decode(&s.metadata.get(&id(n)).ok_or("Unknown namespace")?);
        a.retired=true;s.metadata.insert(id(n),encode(&a));Ok(())
    }
    /// <=100 stored blocks removed per call. Retired handles cannot write.
    pub fn reclaim(&self,n:u64)->Result<(usize,bool),String>{
        let mut s=self.state.borrow_mut();let mut a:Allocation=decode(&s.metadata.get(&id(n)).ok_or("Unknown namespace")?);
        if !a.retired{return Err("Active namespace cannot be reclaimed".into());}
        let p=prefix(n);let mut count=0;
        while count<100 {
            let next=match &a.cursor {Some(c)=>s.blocks.range((Excluded(c.clone()),Unbounded)).next(),None=>s.blocks.range(p.clone()..).next()}.map(|e|e.key().clone()).filter(|k|k.starts_with(&p));
            match next {Some(k)=>{s.blocks.remove(&k);a.cursor=Some(k);count+=1;},None=>{
                let mut b:Budget=decode(&s.metadata.get(&"budget".into()).ok_or("Namespace budget missing")?);
                b.pages=b.pages.checked_sub(a.sizes.iter().sum()).ok_or("Namespace accounting mismatch")?;
                s.metadata.remove(&id(n));s.metadata.insert("budget".into(),encode(&b));return Ok((count,true));
            }}
        }
        s.metadata.insert(id(n),encode(&a));Ok((count,false))
    }
    #[cfg(test)]fn pages(&self)->u64{decode::<Budget>(&self.state.borrow().metadata.get(&"budget".into()).unwrap()).pages}
}
impl<M: Memory + Clone> Memory for Lane<M> {
    fn size(&self)->u64{self.pool.allocation(self.namespace).expect("live namespace").sizes[self.lane as usize]}
    fn grow(&self,pages:u64)->i64 {
        if self.lane>=LANES{return -1;}
        let mut s=self.pool.state.borrow_mut();let Some(bytes)=s.metadata.get(&id(self.namespace)) else{return -1};
        let mut a:Allocation=decode(&bytes);if a.retired{return -1;}
        let mut b:Budget=decode(&s.metadata.get(&"budget".into()).expect("budget"));
        let Some(total)=b.pages.checked_add(pages).filter(|n|*n<=b.max_pages) else{return -1};
        let old=a.sizes[self.lane as usize];let Some(next)=old.checked_add(pages).filter(|n|*n<=i64::MAX as u64 && n.checked_mul(PAGE).is_some()) else{return -1};
        a.sizes[self.lane as usize]=next;b.pages=total;s.metadata.insert(id(self.namespace),encode(&a));s.metadata.insert("budget".into(),encode(&b));old as i64
    }
    fn read(&self,offset:u64,dst:&mut[u8]) {
        assert!(offset.checked_add(dst.len() as u64).is_some_and(|end|end<=self.size()*PAGE),"namespace read bounds");
        let s=self.pool.state.borrow();let mut done=0;
        while done<dst.len(){let pos=offset+done as u64;let start=(pos%BLOCK) as usize;let len=(BLOCK as usize-start).min(dst.len()-done);
            match s.blocks.get(&block(self.namespace,self.lane,pos/BLOCK)){Some(b)=>dst[done..done+len].copy_from_slice(&b[start..start+len]),None=>dst[done..done+len].fill(0)};done+=len;
        }
    }
    fn write(&self,offset:u64,src:&[u8]) {
        assert!(offset.checked_add(src.len() as u64).is_some_and(|end|end<=self.size()*PAGE),"namespace write bounds");
        let mut s=self.pool.state.borrow_mut();let mut done=0;
        while done<src.len(){let pos=offset+done as u64;let start=(pos%BLOCK) as usize;let len=(BLOCK as usize-start).min(src.len()-done);let key=block(self.namespace,self.lane,pos/BLOCK);
            let mut b=s.blocks.get(&key).unwrap_or_else(||vec![0;BLOCK as usize]);b[start..start+len].copy_from_slice(&src[done..done+len]);s.blocks.insert(key,b);done+=len;
        }
    }
}
#[cfg(test)]mod tests{
    use super::*;use ic_stable_structures::{VectorMemory,memory_manager::{MemoryManager,MemoryId}};
    #[test]fn isolated_trees_survive_reopen_and_reclamation_never_reuses_a_generation(){
        let manager=MemoryManager::init(VectorMemory::default());let open=||Pool::open(manager.get(MemoryId::new(0)),manager.get(MemoryId::new(1)),10000,4).unwrap();
        let pool=open();let a=pool.allocate().unwrap();let b=pool.allocate().unwrap();
        let mut left=StableBTreeMap::<String,String,_>::init(pool.lanes(a).unwrap()[0].clone());left.insert("club".into(),"g1".into());
        let mut right=StableBTreeMap::<String,String,_>::init(pool.lanes(b).unwrap()[0].clone());right.insert("club".into(),"g2".into());drop(left);drop(right);drop(pool);
        let pool=open();assert_eq!(StableBTreeMap::<String,String,_>::init(pool.lanes(a).unwrap()[0].clone()).get(&"club".into()),Some("g1".into()));
        let before=pool.pages();assert!(pool.reclaim(a).is_err());pool.retire(a).unwrap();assert!(pool.lanes(a).is_err());let (_,done)=pool.reclaim(a).unwrap();assert!(done);assert!(pool.pages()<before);
        assert_eq!(StableBTreeMap::<String,String,_>::init(pool.lanes(b).unwrap()[0].clone()).get(&"club".into()),Some("g2".into()));assert!(pool.allocate().unwrap()>b);
    }
    #[test]fn sparse_growth_has_a_shared_budget_and_retired_handles_cannot_grow(){
        let pool=Pool::open(VectorMemory::default(),VectorMemory::default(),2,2).unwrap();let a=pool.allocate().unwrap();let lanes=pool.lanes(a).unwrap();
        assert_eq!(lanes[0].grow(2),0);assert_eq!(lanes[1].grow(1),-1);assert_eq!(pool.pages(),2);
        let mut zero=[9;3];lanes[0].read(65535,&mut zero);assert_eq!(zero,[0;3]);lanes[0].write(65535,&[1,2,3]);lanes[0].read(65535,&mut zero);assert_eq!(zero,[1,2,3]);
        pool.retire(a).unwrap();assert_eq!(lanes[0].grow(0),-1);assert!(pool.reclaim(a).unwrap().1);assert_eq!(pool.pages(),0);
        pool.allocate().unwrap();pool.allocate().unwrap();assert!(pool.allocate().is_err());
    }
    #[test]fn reclamation_is_bounded_and_resumes_after_reopen(){
        let meta=VectorMemory::default();let blocks=VectorMemory::default();let pool=Pool::open(meta.clone(),blocks.clone(),100,2).unwrap();let n=pool.allocate().unwrap();let lane=pool.lanes(n).unwrap()[0].clone();lane.grow(20);lane.write(0,&vec![1;4096*205]);pool.retire(n).unwrap();
        assert_eq!(pool.reclaim(n).unwrap(),(100,false));drop(pool);let pool=Pool::open(meta,blocks,100,2).unwrap();assert_eq!(pool.reclaim(n).unwrap(),(100,false));assert_eq!(pool.reclaim(n).unwrap(),(5,true));assert_eq!(pool.pages(),0);
    }
}