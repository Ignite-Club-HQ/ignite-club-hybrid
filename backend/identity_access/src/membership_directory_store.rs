//! Isolated stable directory staging adapter; not connected to public methods.
//! Caller/registry/account verification belongs to the eventual coordinator.
//! New memories must be assigned during the separately approved integration.
use ic_stable_structures::{Memory, StableBTreeMap};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use crate::membership_directory::Source;

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Stage {
    pub club: String,
    pub authority: candid::Principal,
    pub generation: u64,
    pub revision: u64,
    pub next_sequence: u64,
    pub terminal: bool,
}
pub struct Store<M: Memory> {
    manifests: StableBTreeMap<String, Vec<u8>, M>,
    stages: StableBTreeMap<String, Vec<u8>, M>,
    chunks: StableBTreeMap<String, Vec<u8>, M>,
}
fn encode<T: Serialize>(value: &T) -> Vec<u8> { let mut bytes=vec![]; ciborium::into_writer(value,&mut bytes).expect("directory encode"); bytes }
fn decode<T: for<'a> Deserialize<'a>>(bytes: &[u8]) -> T { ciborium::from_reader(bytes).expect("directory decode") }
impl<M: Memory> Store<M> {
    pub fn open(manifests: M, stages: M, chunks: M) -> Self {
        Self { manifests: StableBTreeMap::init(manifests), stages: StableBTreeMap::init(stages), chunks: StableBTreeMap::init(chunks) }
    }
    pub fn source(&self, club: &str) -> Option<Source> { self.manifests.get(&club.to_string()).map(|b|decode(&b)) }
    pub fn stage(&self, club: &str) -> Option<Stage> { self.stages.get(&club.to_string()).map(|b|decode(&b)) }
    pub fn begin(&mut self, source: &Source, revision: u64) -> Result<(), String> {
        if source.club.is_empty() || source.club.len()>128 || source.club.contains('\u{1f}') || source.generation==0 || source.authority==candid::Principal::anonymous() || source.authority==candid::Principal::management_canister() || revision == 0 || revision < source.revision { return Err("Invalid snapshot stage".into()); }
        let manifest=self.source(&source.club);
        if let Some(prior)=&manifest {
            if prior.generation>source.generation || (prior.generation==source.generation && (prior.authority!=source.authority || prior.revision>revision)) {return Err("Obsolete source stage".into());}
        }
        if let Some(prior)=self.stage(&source.club) {
            if prior.generation==source.generation && prior.authority!=source.authority { return Err("Conflicting generation authority".into()); }
            if prior.generation==source.generation && prior.revision==revision { return Ok(()); }
            if prior.generation>source.generation || (prior.generation==source.generation && prior.revision>revision) { return Err("Stale snapshot stage".into()); }
        }
        let stage=Stage {club:source.club.clone(),authority:source.authority,generation:source.generation,revision,next_sequence:0,terminal:false};
        if let Some(mut prior)=manifest {
            if prior.generation!=source.generation || prior.revision<revision {
                prior.authority=source.authority; prior.generation=source.generation; prior.revision=revision; prior.complete=false;
                self.manifests.insert(source.club.clone(),encode(&prior));
            }
        }
        self.stages.insert(source.club.clone(),encode(&stage)); Ok(())
    }
    pub fn append(&mut self, club: &str, generation: u64, revision: u64, sequence: u64, rows: Vec<Vec<u8>>, terminal: bool) -> Result<(), String> {
        let mut stage=self.stage(club).ok_or("Snapshot stage missing")?;
        if stage.generation!=generation || stage.revision!=revision || rows.len()>100 || rows.iter().any(|r|r.len()>1024) { return Err("Invalid snapshot chunk".into()); }
        let payload=encode(&(rows,terminal)); let digest=Sha256::digest(&payload).to_vec();
        let key=format!("{club}\u{1f}{generation:020}\u{1f}{revision:020}\u{1f}{sequence:020}");
        if sequence<stage.next_sequence {
            let stored=self.chunks.get(&key).ok_or("Missing acknowledged snapshot chunk")?;
            return if stored==encode(&(digest,payload)) {Ok(())} else {Err("Conflicting snapshot replay".into())};
        }
        if sequence!=stage.next_sequence || stage.terminal { return Err("Snapshot sequence gap or terminal stage".into()); }
        stage.next_sequence=stage.next_sequence.checked_add(1).ok_or("Snapshot sequence exhausted")?;
        stage.terminal=terminal;
        // All validation before writes; IC message traps roll both back.
        self.chunks.insert(key,encode(&(digest,payload)));
        self.stages.insert(club.to_string(),encode(&stage)); Ok(())
    }
    pub fn staged_chunk(&self, club: &str, sequence: u64) -> Option<Vec<Vec<u8>>> {
        let stage=self.stage(club)?;
        let key=format!("{club}\u{1f}{:020}\u{1f}{:020}\u{1f}{sequence:020}",stage.generation,stage.revision);
        let bytes=self.chunks.get(&key)?;
        let (_digest,payload):(Vec<u8>,Vec<u8>)=decode(&bytes);
        let (rows,_terminal):(Vec<Vec<u8>>,bool)=decode(&payload); Some(rows)
    }
    pub fn persist_verified_source(&mut self, source: &Source) -> Result<(), String> {
        let stage=self.stage(&source.club).ok_or("Snapshot stage missing")?;
        if !stage.terminal || !source.complete || stage.authority!=source.authority || stage.generation!=source.generation || stage.revision!=source.revision {return Err("Incomplete source snapshot".into());}
        if source.subjects.len()>100_000 || source.subjects.iter().any(|p|candid::Principal::from_text(p).is_err() || p==&candid::Principal::anonymous().to_text() || p==&candid::Principal::management_canister().to_text()) { return Err("Invalid bounded membership subjects".into()); }
        if let Some(prior)=self.source(&source.club) {
            if prior.generation>source.generation || (prior.generation==source.generation && prior.revision>source.revision) {return Err("Stale verified manifest".into());}
            if prior.complete && prior.generation==source.generation && prior.revision==source.revision {return if prior==*source {Ok(())} else {Err("Conflicting verified manifest".into())};}
        }
        // This offline adapter stores verified manifests only. Effective-pair
        // materialization/indexing must be bounded before runtime integration.
        self.manifests.insert(source.club.clone(),encode(source)); Ok(())
    }
}
#[cfg(test)] mod tests {
    use super::*;
    use ic_stable_structures::{VectorMemory,memory_manager::{MemoryManager,MemoryId}};
    use std::collections::BTreeSet;
    use candid::Principal;
    #[test] fn durable_chunks_resume_and_exact_replays_survive_reopen() {
        let manager=MemoryManager::init(VectorMemory::default());
        let mut store=Store::open(manager.get(MemoryId::new(0)),manager.get(MemoryId::new(1)),manager.get(MemoryId::new(2)));
        let source=Source {club:"club".into(),authority:Principal::from_slice(&[1,1]),generation:1,revision:2,complete:true,subjects:BTreeSet::new()};
        store.begin(&source,2).unwrap(); store.append("club",1,2,0,vec![vec![1]],false).unwrap();
        assert!(store.persist_verified_source(&source).is_err()); assert!(store.source("club").is_none());
        drop(store);
        let mut store=Store::open(manager.get(MemoryId::new(0)),manager.get(MemoryId::new(1)),manager.get(MemoryId::new(2)));
        assert_eq!(store.stage("club").unwrap().next_sequence,1);
        store.append("club",1,2,0,vec![vec![1]],false).unwrap();
        assert!(store.append("club",1,2,0,vec![vec![2]],false).is_err());
        assert!(store.append("club",1,2,2,vec![],true).is_err());
        store.append("club",1,2,1,vec![vec![3]],true).unwrap(); store.persist_verified_source(&source).unwrap();
        assert_eq!(store.source("club"),Some(source)); assert_eq!(store.staged_chunk("club",1),Some(vec![vec![3]]));
        let mut next=store.source("club").unwrap();next.revision=3;next.subjects.insert(Principal::from_slice(&[3,1]).to_text());
        store.begin(&next,3).unwrap();assert!(!store.source("club").unwrap().complete);
        store.append("club",1,3,0,vec![],true).unwrap();store.persist_verified_source(&next).unwrap();
        let mut conflicting=next.clone();conflicting.subjects.clear();
        assert!(store.persist_verified_source(&conflicting).is_err());assert_eq!(store.source("club"),Some(next));
    }
    #[test] fn bounds_and_generation_drift_leave_progress_unchanged() {
        let manager=MemoryManager::init(VectorMemory::default());
        let mut store=Store::open(manager.get(MemoryId::new(0)),manager.get(MemoryId::new(1)),manager.get(MemoryId::new(2)));
        let source=Source {club:"club".into(),authority:Principal::from_slice(&[1,1]),generation:2,revision:4,complete:false,subjects:BTreeSet::new()};
        store.begin(&source,4).unwrap();
        assert!(store.append("club",2,4,0,vec![vec![];101],false).is_err());
        assert!(store.append("club",1,4,0,vec![],false).is_err());
        assert!(store.append("club",2,4,0,vec![vec![0;1025]],false).is_err());
        assert_eq!(store.stage("club").unwrap().next_sequence,0);
        let mut other=source.clone();other.authority=Principal::from_slice(&[2,1]);
        assert!(store.begin(&other,4).is_err());assert_eq!(store.stage("club").unwrap().authority,source.authority);
        store.append("club",2,4,0,vec![],true).unwrap(); other.complete=true;
        assert!(store.persist_verified_source(&other).is_err());assert!(store.source("club").is_none());
    }
}