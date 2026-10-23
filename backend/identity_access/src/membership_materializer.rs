//! Bounded, resumable raw-source joins. Offline until registry/account/recovery
//! binding is accepted; these display pairs never authorize resource access.
use candid::Principal;
use ic_stable_structures::{Memory, StableBTreeMap};
use serde::{Deserialize, Serialize};
use std::ops::Bound::{Excluded, Unbounded};

const SEP: char = '\u{1f}';
const BATCH: usize = 100;
#[derive(Clone, Debug, Serialize, Deserialize)]
pub enum Edge {
    Club { id: String, deleted: bool },
    Role { subject: Principal, club: Option<String> },
    Parent { child: String, subject: Principal },
    Guardian { child: String, subject: Principal },
    ChildTeam { child: String, team: String },
    Team { id: String, club: String, deleted: bool },
    Excluded { subject: Principal, club: String },
}
#[derive(Clone, Debug, Default, Serialize, Deserialize, PartialEq, Eq)]
pub struct Progress {
    pub binding: Option<Binding>,
    pub sequence: u64,
    pub terminal: bool,
    pub complete: bool,
    pub role: Option<String>,
    pub roles_done: bool,
    pub relation: Option<String>,
    pub relation_active: bool,
    pub team: Option<String>,
    pub team_active: bool,
    pub club: Option<String>,
    /// Older completed builds have no subject markers and must not certify
    /// an empty account/source index after an upgrade.
    #[serde(default)] pub subject_index_version:u8,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub struct Binding {
    pub authority: Principal,
    pub generation: u64,
    pub revision: u64,
    pub inventory_digest: [u8;32],
}
// Each new builder owns isolated memories for one pinned source generation
// and revision. No old-generation tree is reused or cleared in a bulk loop.
pub struct Builder<M: Memory> {
    progress: StableBTreeMap<String, Vec<u8>, M>,
    clubs: StableBTreeMap<String, u8, M>,
    roles: StableBTreeMap<String, u8, M>,
    relations: StableBTreeMap<String, u8, M>,
    child_teams: StableBTreeMap<String, u8, M>,
    team_clubs: StableBTreeMap<String, u8, M>,
    exclusions: StableBTreeMap<String, u8, M>,
    pairs: StableBTreeMap<String, u8, M>,
}
fn encode<T: Serialize>(v: &T) -> Vec<u8> { let mut b=vec![];ciborium::into_writer(v,&mut b).expect("source encode");b }
fn decode<T: for<'a> Deserialize<'a>>(b: &[u8]) -> T {ciborium::from_reader(b).expect("source decode")}
fn valid_id(s: &str) -> bool { !s.is_empty() && s.len()<=128 && !s.contains(SEP) }
fn valid_subject(p: &Principal) -> bool { *p!=Principal::anonymous() && *p!=Principal::management_canister() }
fn pair(a: &str,b: &str)->String {format!("{a}{SEP}{b}")}
fn split(s: &str)->(&str,&str) {s.split_once(SEP).expect("validated source key")}
fn after<M: Memory>(map: &StableBTreeMap<String,u8,M>, cursor: &Option<String>, prefix: Option<&str>) -> Option<String> {
    let row=match cursor {Some(c)=>map.range((Excluded(c.clone()),Unbounded)).next(),None=>match prefix {Some(p)=>map.range(p.to_string()..).next(),None=>map.iter().next()}};
    row.map(|e|e.key().clone()).filter(|k|prefix.is_none_or(|p|k.starts_with(p)))
}
impl<M: Memory> Builder<M> {
    pub fn open(memories: [M;8]) -> Self {
        let [a,b,c,d,e,f,g,h]=memories;
        Self {progress:StableBTreeMap::init(a),clubs:StableBTreeMap::init(b),roles:StableBTreeMap::init(c),relations:StableBTreeMap::init(d),child_teams:StableBTreeMap::init(e),team_clubs:StableBTreeMap::init(f),exclusions:StableBTreeMap::init(g),pairs:StableBTreeMap::init(h)}
    }
    pub fn status(&self)->Progress {self.progress.get(&"progress".into()).map(|b|decode(&b)).unwrap_or_default()}
    fn save(&mut self,p:&Progress){self.progress.insert("progress".into(),encode(p));}
    pub fn begin(&mut self,binding:Binding)->Result<(),String>{
        if !valid_subject(&binding.authority)||binding.generation==0||binding.revision==0||binding.inventory_digest==[0;32]{return Err("Invalid source binding".into());}
        let mut p=self.status();if let Some(prior)=&p.binding{return if prior==&binding{Ok(())}else{Err("Source generation/revision replacement requires isolated staging".into())};}
        p.binding=Some(binding);p.subject_index_version=1;self.save(&p);Ok(())
    }
    pub fn ingest(&mut self,binding:&Binding,sequence:u64,edges:Vec<Edge>,terminal:bool)->Result<(),String>{
        let mut p=self.status();
        if p.binding.as_ref()!=Some(binding){return Err("Source binding drift".into());}
        if edges.len()>BATCH {return Err("Source batch exceeds 100 edges".into());}
        for edge in &edges {
            let valid=match edge {
                Edge::Club{id,..}=>valid_id(id),
                Edge::Role{subject,club}=>valid_subject(subject)&&club.as_deref().is_none_or(valid_id),
                Edge::Parent{child,subject}|Edge::Guardian{child,subject}=>valid_id(child)&&valid_subject(subject),
                Edge::ChildTeam{child,team}=>valid_id(child)&&valid_id(team),
                Edge::Team{id,club,..}=>valid_id(id)&&valid_id(club),
                Edge::Excluded{subject,club}=>valid_subject(subject)&&valid_id(club),
            };
            if !valid {return Err("Invalid source edge".into());}
        }
        let payload=encode(&(edges.clone(),terminal));let ack=format!("chunk:{sequence:020}");
        if sequence<p.sequence {return if self.progress.get(&ack)==Some(payload) {Ok(())} else {Err("Conflicting source replay".into())};}
        if p.terminal||sequence!=p.sequence {return Err("Source gap or terminal snapshot".into());}
        p.sequence=p.sequence.checked_add(1).ok_or("Source sequence exhausted")?;
        // Complete validation precedes every stable write.
        for edge in edges {match edge {
            Edge::Club{id,deleted}=>{let value=if deleted {2} else {1}; let old=self.clubs.get(&id).unwrap_or(0);self.clubs.insert(id,old|value);},
            Edge::Role{subject,club}=>{if club.is_none(){self.progress.insert(format!("subject:{}",subject.to_text()),vec![1]);}self.roles.insert(pair(&subject.to_text(),club.as_deref().unwrap_or("*")),1);},
            Edge::Parent{child,subject}|Edge::Guardian{child,subject}=>{self.relations.insert(pair(&child,&subject.to_text()),1);},
            Edge::ChildTeam{child,team}=>{self.child_teams.insert(pair(&child,&team),1);},
            Edge::Team{id,club,deleted}=>{let key=pair(&id,&club);let live=self.team_clubs.get(&key).unwrap_or(0);self.team_clubs.insert(key,live|u8::from(!deleted));},
            Edge::Excluded{subject,club}=>{self.exclusions.insert(pair(&subject.to_text(),&club),1);},
        }}
        p.terminal=terminal;self.progress.insert(ack,payload);self.save(&p);Ok(())
    }
    fn admit(&mut self,subject:&str,club:&str){
        if self.clubs.get(&club.to_string())==Some(1) && self.exclusions.get(&pair(subject,club)).is_none(){self.pairs.insert(pair(subject,club),1);self.progress.insert(format!("subject:{subject}"),vec![1]);}
    }
    pub fn advance(&mut self)->Result<usize,String>{
        let mut p=self.status();if !p.terminal {return Err("Incomplete raw source".into());}
        if p.complete {return Ok(0);}
        let mut scanned=0;
        while scanned<BATCH && !p.complete {
            scanned+=1;
            if !p.roles_done {
                match after(&self.roles,&p.role,None){
                    Some(key)=>{let (subject,club)=split(&key);if club!="*"{self.admit(subject,club);}p.role=Some(key);},
                    None=>p.roles_done=true,
                }
                continue;
            }
            if !p.relation_active {
                match after(&self.relations,&p.relation,None){Some(key)=>{p.relation=Some(key);p.relation_active=true;p.team=None;},None=>p.complete=true}
                continue;
            }
            let relation=p.relation.as_deref().ok_or("Missing join relation")?;
            let (child,subject)=split(relation);
            if !p.team_active {
                match after(&self.child_teams,&p.team,Some(&format!("{child}{SEP}"))){
                    Some(key)=>{p.team=Some(key);p.team_active=true;p.club=None;},
                    None=>{p.relation_active=false;},
                }
                continue;
            }
            let (_,team)=split(p.team.as_deref().ok_or("Missing join team")?);
            match after(&self.team_clubs,&p.club,Some(&format!("{team}{SEP}"))){
                Some(key)=>{let (_,club)=split(&key);if self.team_clubs.get(&key)==Some(1){self.admit(subject,club);}p.club=Some(key);},
                None=>{p.team_active=false;},
            }
        }
        self.save(&p);Ok(scanned)
    }
    /// Exact candidate subjects for the completed isolated source tree.
    /// Includes app-wide roles without expanding their club memberships.
    pub fn subjects(&self,binding:&Binding,cursor:Option<String>)->Result<(Vec<Principal>,Option<String>,usize),String>{
        let status=self.status();
        if !status.complete||status.binding.as_ref()!=Some(binding)||status.subject_index_version!=1{return Err("Incomplete subject index or binding drift; source rebuild required".into());}
        if cursor.as_ref().is_some_and(|c|!c.starts_with("subject:")){return Err("Foreign subject cursor".into());}
        let mut at=cursor;let mut subjects=vec![];
        while subjects.len()<BATCH{
            let row=match &at{Some(c)=>self.progress.range((Excluded(c.clone()),Unbounded)).next(),None=>self.progress.range("subject:".to_string()..).next()}.map(|e|e.key().clone()).filter(|k|k.starts_with("subject:"));
            let Some(key)=row else{let scanned=subjects.len();return Ok((subjects,None,scanned));};
            let subject=Principal::from_text(&key[8..]).map_err(|_|"Invalid indexed subject")?;
            subjects.push(subject);at=Some(key);
        }
        Ok((subjects,at,BATCH))
    }
    /// Exhaustive retained Club rows (including tombstones), independent of
    /// member pairs. Ownership checks never infer absence from filtered pairs.
    pub fn next_ownership_club(&self,binding:&Binding,cursor:Option<String>)->Result<Option<(String,u8)>,String>{
        let status=self.status();
        if !status.complete||!status.terminal||status.binding.as_ref()!=Some(binding){return Err("Incomplete ownership source or binding drift".into());}
        if cursor.as_deref().is_some_and(|id|!valid_id(id)){return Err("Invalid ownership cursor".into());}
        Ok(after(&self.clubs,&cursor,None).map(|id|{let value=self.clubs.get(&id).unwrap_or(0);(id,value)}))
    }
    pub fn ownership_claim(&self,binding:&Binding,club:&str)->Result<Option<u8>,String>{
        let status=self.status();
        if !valid_id(club)||!status.complete||!status.terminal||status.binding.as_ref()!=Some(binding){return Err("Incomplete ownership source or binding drift".into());}
        Ok(self.clubs.get(&club.to_string()))
    }
    // App-wide roles are retained separately; a caller-private coordinator
    // must page active clubs for such accounts instead of expanding globally.
    pub fn app_wide(&self,subject:Principal)->Result<bool,String>{
        if !self.status().complete{return Err("Incomplete materialization".into());}
        Ok(self.roles.get(&pair(&subject.to_text(),"*")).is_some())
    }
    pub fn clubs_for(&self,subject:Principal,cursor:Option<String>)->Result<(Vec<String>,Option<String>,usize),String>{
        if !self.status().complete{return Err("Incomplete materialization".into());}
        if !valid_subject(&subject){return Err("Invalid subject".into());}
        let prefix=format!("{}{SEP}",subject.to_text());
        if cursor.as_ref().is_some_and(|c|!c.starts_with(&prefix)){return Err("Foreign source cursor".into());}
        let mut at=cursor;let mut clubs=vec![];let mut scanned=0;
        while scanned<BATCH {match after(&self.pairs,&at,Some(&prefix)){Some(k)=>{clubs.push(split(&k).1.to_string());at=Some(k);scanned+=1;},None=>return Ok((clubs,None,scanned))}}
        Ok((clubs,at,scanned))
    }
    pub fn effective_clubs_for(&self,binding:&Binding,subject:Principal,cursor:Option<String>)->Result<(Vec<String>,Option<String>,usize),String>{
        if self.status().binding.as_ref()!=Some(binding){return Err("Source binding drift".into());}
        if !valid_subject(&subject){return Err("Invalid subject".into());}
        if !self.app_wide(subject)?{return self.clubs_for(subject,cursor);}
        if cursor.as_deref().is_some_and(|c|!valid_id(c)){return Err("Invalid active club cursor".into());}
        let mut at=cursor;let mut out=vec![];let mut scanned=0;
        while scanned<BATCH{match after(&self.clubs,&at,None){
            Some(key)=>{if self.clubs.get(&key)==Some(1)&&self.exclusions.get(&pair(&subject.to_text(),&key)).is_none(){out.push(key.clone());}at=Some(key);scanned+=1;},
            None=>return Ok((out,None,scanned)),
        }}
        Ok((out,at,scanned))
    }
}

#[cfg(test)] mod tests {
    use super::*;
    use ic_stable_structures::{VectorMemory,memory_manager::{MemoryManager,MemoryId}};
    fn p(n:u8)->Principal {Principal::from_slice(&[n,1])}
    fn binding()->Binding {Binding{authority:p(9),generation:1,revision:1,inventory_digest:[1;32]}}
    fn open(manager:&MemoryManager<VectorMemory>)->Builder<ic_stable_structures::memory_manager::VirtualMemory<VectorMemory>>{Builder::open(std::array::from_fn(|i|manager.get(MemoryId::new(i as u8))))}
    #[test] fn family_join_resumes_with_251_teams_and_preserves_or_exclusion_semantics(){
        let manager=MemoryManager::init(VectorMemory::default());let mut b=open(&manager);b.begin(binding()).unwrap();
        b.ingest(&binding(),0,vec![Edge::Club{id:"a".into(),deleted:false},Edge::Club{id:"b".into(),deleted:false},Edge::Club{id:"deleted".into(),deleted:true},Edge::Parent{child:"child".into(),subject:p(1)},Edge::Guardian{child:"child".into(),subject:p(2)},Edge::Role{subject:p(1),club:Some("b".into())},Edge::Excluded{subject:p(2),club:"a".into()},Edge::Role{subject:p(3),club:None}],false).unwrap();
        let mut edges=vec![];for i in 0..251{let team=format!("t{i}");edges.push(Edge::ChildTeam{child:"child".into(),team:team.clone()});edges.push(Edge::Team{id:team.clone(),club:"a".into(),deleted:true});edges.push(Edge::Team{id:team,club:"a".into(),deleted:false});}
        let mut sequence=1;for chunk in edges.chunks(100){b.ingest(&binding(),sequence,chunk.to_vec(),false).unwrap();sequence+=1;}
        b.ingest(&binding(),sequence,vec![],true).unwrap();assert!(b.clubs_for(p(1),None).is_err());assert_eq!(b.advance().unwrap(),100);drop(b);
        let mut b=open(&manager);let mut calls=0;while !b.status().complete{assert!(b.advance().unwrap()<=100);calls+=1;assert!(calls<100);}
        assert_eq!(b.clubs_for(p(1),None).unwrap().0,vec!["a","b"]);assert!(b.clubs_for(p(2),None).unwrap().0.is_empty());assert!(b.app_wide(p(3)).unwrap());assert!(b.clubs_for(p(3),None).unwrap().0.is_empty());
    }
    #[test] fn validation_and_exact_replay_leave_progress_unchanged(){
        let manager=MemoryManager::init(VectorMemory::default());let mut b=open(&manager);b.begin(binding()).unwrap();
        let edges=vec![Edge::Club{id:"a".into(),deleted:false},Edge::Role{subject:p(1),club:Some("a".into())}];
        b.ingest(&binding(),0,edges.clone(),true).unwrap();let before=b.status();b.ingest(&binding(),0,edges,true).unwrap();assert_eq!(before,b.status());
        assert!(b.ingest(&binding(),0,vec![],true).is_err());assert!(b.ingest(&binding(),2,vec![],true).is_err());while !b.status().complete{b.advance().unwrap();}
        assert_eq!(b.clubs_for(p(1),None).unwrap().0,vec!["a"]);assert!(b.clubs_for(p(2),Some(pair(&p(1).to_text(),"a"))).is_err());
        let manager=MemoryManager::init(VectorMemory::default());let mut b=open(&manager);b.begin(binding()).unwrap();let before=b.status();
        assert!(b.ingest(&binding(),0,vec![Edge::Club{id:"bad\u{1f}id".into(),deleted:false}],false).is_err());assert_eq!(b.status(),before);
        assert!(b.ingest(&binding(),0,vec![Edge::Club{id:"a".into(),deleted:false};101],false).is_err());
    }
    #[test] fn app_wide_scan_is_bounded_and_applies_active_clubs_and_exclusions(){
        let manager=MemoryManager::init(VectorMemory::default());let mut b=open(&manager);b.begin(binding()).unwrap();
        let mut edges=vec![Edge::Role{subject:p(1),club:None},Edge::Excluded{subject:p(1),club:"c003".into()}];
        for i in 0..205{edges.push(Edge::Club{id:format!("c{i:03}"),deleted:i==4});}
        for (n,chunk) in edges.chunks(100).enumerate(){b.ingest(&binding(),n as u64,chunk.to_vec(),n==2).unwrap();}
        while !b.status().complete{b.advance().unwrap();}
        let (first,next,scanned)=b.effective_clubs_for(&binding(),p(1),None).unwrap();assert_eq!(scanned,100);assert_eq!(first.len(),98);
        let (second,next,scanned)=b.effective_clubs_for(&binding(),p(1),next).unwrap();assert_eq!(scanned,100);assert_eq!(second.len(),100);
        let (last,next,scanned)=b.effective_clubs_for(&binding(),p(1),next).unwrap();assert_eq!(scanned,5);assert_eq!(last.len(),5);assert!(next.is_none());
        let mut drift=binding();drift.revision=2;let before=b.status();assert!(b.begin(drift.clone()).is_err());assert!(b.ingest(&drift,0,vec![],true).is_err());assert!(b.effective_clubs_for(&drift,p(1),None).is_err());assert_eq!(b.status(),before);
    }
    #[test] fn missing_or_deleted_team_never_establishes_family_membership(){
        let manager=MemoryManager::init(VectorMemory::default());let mut b=open(&manager);b.begin(binding()).unwrap();
        b.ingest(&binding(),0,vec![Edge::Club{id:"a".into(),deleted:false},Edge::Parent{child:"child".into(),subject:p(1)},Edge::ChildTeam{child:"child".into(),team:"gone".into()},Edge::ChildTeam{child:"child".into(),team:"missing".into()},Edge::Team{id:"gone".into(),club:"a".into(),deleted:true},Edge::Role{subject:p(2),club:Some("a".into())},Edge::Excluded{subject:p(2),club:"a".into()}],true).unwrap();
        while !b.status().complete{b.advance().unwrap();}assert!(b.clubs_for(p(1),None).unwrap().0.is_empty());assert!(b.clubs_for(p(2),None).unwrap().0.is_empty());
    }
    #[test]fn pre_index_completed_build_cannot_claim_empty_subject_coverage(){
        let manager=MemoryManager::init(VectorMemory::default());let mut b=open(&manager);b.begin(binding()).unwrap();
        b.ingest(&binding(),0,vec![Edge::Club{id:"a".into(),deleted:false},Edge::Role{subject:p(1),club:Some("a".into())}],true).unwrap();while !b.status().complete{b.advance().unwrap();}
        let mut legacy=b.status();legacy.subject_index_version=0;b.save(&legacy);drop(b);
        let b=open(&manager);assert_eq!(b.clubs_for(p(1),None).unwrap().0,vec!["a"]);assert!(b.subjects(&binding(),None).is_err());
    }
}