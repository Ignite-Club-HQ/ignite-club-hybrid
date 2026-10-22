//! Exact Candid transport for directory-only source reads. All unbounded
//! Motoko Nat fields are checked before entering the bounded worker core.
use candid::{CandidType, Nat, Principal};
use serde::{Deserialize, Serialize};
use crate::{membership_materializer::Edge, membership_propagation::{Cursor, SourcePage}};

#[derive(Clone, Debug, CandidType, Deserialize, Serialize, PartialEq, Eq)]
pub struct SourceBinding {
    pub identity: Principal, pub router: Principal, pub group: String,
    pub deployment: String, pub generation: u64, pub inventory_digest: Vec<u8>,
}
#[derive(Clone, Debug, CandidType, Deserialize)]
pub enum UnitReply { Ok, Err(String) }
#[derive(Clone, Debug, CandidType, Deserialize)]
pub enum Reply<T> { Ok(T), Err(String) }
impl<T> Reply<T> {
    pub fn result(self) -> Result<T,String> { match self { Self::Ok(v)=>Ok(v),Self::Err(e)=>Err(e) } }
}
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct Status { pub revision: Nat, pub acknowledged: Nat, pub pending: bool }
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct WireCursor { pub revision: Nat, pub phase: Nat, pub offset: Nat, pub nested: Nat }
#[derive(Clone, Debug, CandidType, Deserialize)]
pub enum WireEdge {
    Club { id:String, deleted:bool }, Role { subject:Principal, club:Option<String> },
    Parent { child:String, subject:Principal }, Guardian { child:String, subject:Principal },
    ChildTeam { child:String, team:String }, Team { id:String, club:String, deleted:bool },
    Excluded { subject:Principal, club:String },
}
#[derive(Clone, Debug, CandidType, Deserialize)]
pub struct WirePage { pub revision:Nat, pub edges:Vec<WireEdge>, pub next:Option<WireCursor>, pub scanned:Nat }
pub fn number(n:&Nat)->Result<u64,String> {
    let digits=n.0.to_u64_digits();
    if digits.len()>1 { return Err("Membership source Nat exceeds u64".into()); }
    Ok(digits.first().copied().unwrap_or(0))
}
impl Status {
    pub fn checked(&self)->Result<(u64,u64,bool),String> {
        let revision=number(&self.revision)?; let acknowledged=number(&self.acknowledged)?;
        if revision==0 || acknowledged>revision || self.pending!=(revision!=acknowledged) {
            return Err("Invalid membership source status".into());
        }
        Ok((revision,acknowledged,self.pending))
    }
}
impl From<Cursor> for WireCursor {
    fn from(c:Cursor)->Self { Self{revision:c.revision.into(),phase:c.phase.into(),offset:c.offset.into(),nested:c.nested.into()} }
}
impl WirePage {
    pub fn checked(self)->Result<SourcePage,String> {
        let revision=number(&self.revision)?; let scanned=number(&self.scanned)?;
        if revision==0 || scanned>100 || self.edges.len()>scanned as usize { return Err("Source page budget exceeded".into()); }
        let next=self.next.map(|n|->Result<Cursor,String>{
            let c=Cursor{revision:number(&n.revision)?,phase:number(&n.phase)?,offset:number(&n.offset)?,nested:number(&n.nested)?};
            if c.revision!=revision || c.phase>=8 || scanned==0 { return Err("Invalid source continuation".into()); } Ok(c)
        }).transpose()?;
        let mut edges=Vec::with_capacity(self.edges.len());
        for e in self.edges {
            edges.push(match e {
                WireEdge::Club{id,deleted}=>Edge::Club{id,deleted},
                WireEdge::Role{subject,club}=>Edge::Role{subject,club},
                WireEdge::Parent{child,subject}=>Edge::Parent{child,subject},
                WireEdge::Guardian{child,subject}=>Edge::Guardian{child,subject},
                WireEdge::ChildTeam{child,team}=>Edge::ChildTeam{child,team},
                WireEdge::Team{id,club,deleted}=>Edge::Team{id,club,deleted},
                WireEdge::Excluded{subject,club}=>Edge::Excluded{subject,club},
            });
        }
        Ok(SourcePage{revision,scanned:scanned as usize,edges,next})
    }
}
#[cfg(test)] mod tests {
    use super::*;
    #[test] fn nat_overflow_never_truncates() {
        assert_eq!(number(&Nat::from(u64::MAX)).unwrap(),u64::MAX);
        assert!(number(&"18446744073709551616".parse::<Nat>().unwrap()).is_err());
    }
    #[test] fn malformed_status_cannot_acknowledge_a_source() {
        assert_eq!(Status{revision:2u64.into(),acknowledged:1u64.into(),pending:true}.checked().unwrap(),(2,1,true));
        assert!(Status{revision:2u64.into(),acknowledged:1u64.into(),pending:false}.checked().is_err());
        assert!(Status{revision:2u64.into(),acknowledged:3u64.into(),pending:true}.checked().is_err());
    }
    #[test] fn oversized_or_nonadvancing_pages_are_rejected_before_ingest() {
        assert!(WirePage{revision:1u64.into(),scanned:101u64.into(),edges:vec![],next:None}.checked().is_err());
        assert!(WirePage{revision:1u64.into(),scanned:0u64.into(),edges:vec![],next:Some(WireCursor{revision:1u64.into(),phase:0u64.into(),offset:1u64.into(),nested:0u64.into()})}.checked().is_err());
    }
}