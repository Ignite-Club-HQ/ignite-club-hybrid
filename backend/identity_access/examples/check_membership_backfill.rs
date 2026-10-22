//! Disposable local source parity harness, never an installed canister API.
#[path = "../src/membership_materializer.rs"]
mod membership_materializer;
use membership_materializer::{Builder,Edge,Binding};
use candid::Principal;
use ic_stable_structures::{VectorMemory,memory_manager::{MemoryManager,MemoryId}};
use std::io::{self,BufRead};
fn main(){
    let manager=MemoryManager::init(VectorMemory::default());
    let mut b=Builder::open(std::array::from_fn(|i|manager.get(MemoryId::new(i as u8))));
    let binding=Binding{authority:Principal::from_slice(&[9,1]),generation:1,revision:1,inventory_digest:[1;32]};
    b.begin(binding.clone()).expect("disposable local binding");
    let mut chunk=vec![];let mut sequence=0;
    for line in io::stdin().lock().lines(){
        let line=line.expect("source line");let x:Vec<_>=line.split('\t').collect();
        let principal=|i:usize|Principal::from_text(x[i]).expect("source principal");
        let edge=match x[0]{
            "Club"=>Edge::Club{id:x[1].into(),deleted:x[2]=="true"},
            "Role"=>Edge::Role{subject:principal(1),club:if x[2]=="*"{None}else{Some(x[2].into())}},
            "Parent"=>Edge::Parent{child:x[1].into(),subject:principal(2)},
            "Guardian"=>Edge::Guardian{child:x[1].into(),subject:principal(2)},
            "ChildTeam"=>Edge::ChildTeam{child:x[1].into(),team:x[2].into()},
            "Team"=>Edge::Team{id:x[1].into(),club:x[2].into(),deleted:x[3]=="true"},
            "Excluded"=>Edge::Excluded{subject:principal(1),club:x[2].into()},
            _=>panic!("unknown source edge"),
        };
        chunk.push(edge);if chunk.len()==100{b.ingest(&binding,sequence,std::mem::take(&mut chunk),false).expect("source chunk");sequence+=1;}
    }
    b.ingest(&binding,sequence,chunk,true).expect("source terminal");
    while !b.status().complete{assert!(b.advance().expect("join progress")<=100);}
    for subject in std::env::args().skip(1){let p=Principal::from_text(&subject).expect("subject");
        println!("APP\t{}\t{}",subject,b.app_wide(p).expect("app role"));
        let mut cursor=None;loop {let (clubs,next,scanned)=b.effective_clubs_for(&binding,p,cursor).expect("pairs");assert!(scanned<=100);for club in clubs{println!("PAIR\t{subject}\t{club}");}cursor=next;if cursor.is_none(){break;}}
    }
}