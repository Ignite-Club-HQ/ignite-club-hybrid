//! Offline discovery state machine. No public ingestion/reader/release API.
//! Source bindings must come from exact consensus registry+club placement
//! evidence; membership rows never authorize resource reads.
use candid::Principal;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Source {
    pub club: String,
    pub authority: Principal,
    pub generation: u64,
    pub revision: u64,
    pub complete: bool,
    pub subjects: BTreeSet<String>,
}
#[derive(Clone, Debug, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Directory {
    pub generation: u64,
    pub data_revision: u64,
    pub required: BTreeSet<String>,
    pub sources: BTreeMap<String, Source>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Snapshot {
    pub club: String,
    pub authority: Principal,
    pub generation: u64,
    pub revision: u64,
    pub subjects: BTreeSet<String>,
}
impl Directory {
    pub fn bind(&mut self, generation: u64, bindings: Vec<(String, Principal)>) -> Result<(), String> {
        if generation <= self.generation || bindings.is_empty() || bindings.len() > 4096 {
            return Err("New complete directory generation required".into());
        }
        let mut next = BTreeMap::new();
        for (club, authority) in bindings {
            if club.is_empty() || club.len() > 128 || authority == Principal::anonymous() || authority == Principal::management_canister() || next.contains_key(&club) {
                return Err("Invalid exact club authority binding".into());
            }
            next.insert(club.clone(), Source { club, authority, generation, revision: 0, complete: false, subjects: BTreeSet::new() });
        }
        let revision = self.data_revision.checked_add(1).ok_or("Directory revision exhausted")?;
        self.required = next.keys().cloned().collect(); self.sources = next;
        self.generation = generation; self.data_revision = revision;
        Ok(())
    }
    pub fn commit_complete_snapshot(&mut self, caller: Principal, snapshot: Snapshot) -> Result<(), String> {
        let prior = self.sources.get(&snapshot.club).ok_or("Unregistered club source")?;
        if caller != prior.authority || snapshot.authority != caller || snapshot.generation != self.generation || snapshot.revision == 0 {
            return Err("Exact current club authority and generation required".into());
        }
        if snapshot.subjects.len() > 100_000 || snapshot.subjects.iter().any(|p| Principal::from_text(p).is_err() || p == &Principal::anonymous().to_text() || p == &Principal::management_canister().to_text()) {
            return Err("Invalid bounded membership subjects".into());
        }
        if snapshot.revision < prior.revision { return Err("Stale source snapshot".into()); }
        if snapshot.revision == prior.revision && prior.complete {
            return if prior.subjects == snapshot.subjects { Ok(()) } else { Err("Conflicting source snapshot".into()) };
        }
        let revision = self.data_revision.checked_add(1).ok_or("Directory revision exhausted")?;
        let next = Source { club: snapshot.club.clone(), authority: caller, generation: snapshot.generation,
            revision: snapshot.revision, complete: true, subjects: snapshot.subjects };
        self.sources.insert(snapshot.club, next); self.data_revision = revision; Ok(())
    }
    pub fn complete(&self) -> bool {
        !self.required.is_empty() && self.required.iter().all(|club| self.sources.get(club).is_some_and(|s| s.complete && s.generation == self.generation))
    }
    pub fn invalidate(&mut self, caller: Principal, club: &str, generation: u64, revision: u64) -> Result<(), String> {
        let prior = self.sources.get(club).ok_or("Unregistered club source")?;
        if caller != prior.authority || generation != self.generation || revision < prior.revision { return Err("Invalid source invalidation".into()); }
        if revision == prior.revision { return Ok(()); }
        let next_revision = self.data_revision.checked_add(1).ok_or("Directory revision exhausted")?;
        let source = self.sources.get_mut(club).ok_or("Unregistered club source")?;
        source.revision = revision; source.complete = false; self.data_revision = next_revision; Ok(())
    }
}

#[cfg(test)] mod tests {
    use super::*;
    fn p(n: u8) -> Principal { Principal::from_slice(&[n,1]) }
    fn fixture() -> Directory { let mut d=Directory::default(); d.bind(1,vec![("g1-club".into(),p(1)),("g2-club".into(),p(2))]).unwrap(); d }
    fn snap(club: &str, authority: Principal, revision: u64, subjects: &[Principal]) -> Snapshot {
        Snapshot { club:club.into(),authority,generation:1,revision,subjects:subjects.iter().map(Principal::to_text).collect() }
    }
    #[test] fn incomplete_source_never_establishes_global_completeness() {
        let mut d=fixture(); d.commit_complete_snapshot(p(1),snap("g1-club",p(1),1,&[p(3)])).unwrap(); assert!(!d.complete());
        d.commit_complete_snapshot(p(2),snap("g2-club",p(2),1,&[])).unwrap(); assert!(d.complete());
    }
    #[test] fn registered_writer_cannot_publish_another_groups_club() {
        let mut d=fixture(); let before=d.clone(); assert!(d.commit_complete_snapshot(p(1),snap("g2-club",p(1),1,&[p(3)])).is_err()); assert_eq!(d,before);
    }
    #[test] fn replay_is_exact_and_removed_members_cannot_return_from_old_snapshot() {
        let mut d=fixture(); let first=snap("g1-club",p(1),2,&[p(3)]); d.commit_complete_snapshot(p(1),first.clone()).unwrap();
        let revision=d.data_revision; d.commit_complete_snapshot(p(1),first.clone()).unwrap(); assert_eq!(d.data_revision,revision);
        assert!(d.commit_complete_snapshot(p(1),snap("g1-club",p(1),2,&[p(4)])).is_err());
        d.commit_complete_snapshot(p(1),snap("g1-club",p(1),3,&[])).unwrap();
        assert!(d.commit_complete_snapshot(p(1),first).is_err()); assert!(d.sources["g1-club"].subjects.is_empty());
    }
    #[test] fn authority_generation_replacement_invalidates_old_evidence() {
        let mut d=fixture(); d.bind(2,vec![("g1-club".into(),p(5))]).unwrap();
        assert!(!d.complete()); assert!(d.commit_complete_snapshot(p(1),snap("g1-club",p(1),100,&[p(3)])).is_err());
    }
    #[test] fn invalidation_requires_a_complete_replacement() {
        let mut d=fixture(); d.commit_complete_snapshot(p(1),snap("g1-club",p(1),1,&[p(3)])).unwrap();
        d.invalidate(p(1),"g1-club",1,2).unwrap(); assert!(!d.sources["g1-club"].complete);
        d.commit_complete_snapshot(p(1),snap("g1-club",p(1),2,&[])).unwrap(); assert!(d.sources["g1-club"].complete);
        let revision = d.data_revision;
        d.invalidate(p(1),"g1-club",1,2).unwrap(); assert!(d.sources["g1-club"].complete); assert_eq!(d.data_revision,revision);
    }
    #[test] fn obsolete_generation_invalidation_cannot_poison_replacement_source() {
        let mut d=fixture(); d.bind(2,vec![("g1-club".into(),p(1))]).unwrap(); let before=d.clone();
        assert!(d.invalidate(p(1),"g1-club",1,u64::MAX).is_err()); assert_eq!(d,before);
    }
}