import Nat "mo:core/Nat";
import List "mo:core/List";
module {
  public type Edge = {
    #Club : { id : Text; deleted : Bool };
    #Role : { subject : Principal; club : ?Text };
    #Parent : { child : Text; subject : Principal };
    #Guardian : { child : Text; subject : Principal };
    #ChildTeam : { child : Text; team : Text };
    #Team : { id : Text; club : Text; deleted : Bool };
    #Excluded : { subject : Principal; club : Text };
  };
  public type Cursor = { revision : Nat; phase : Nat; offset : Nat; nested : Nat };
  public type Page = { revision : Nat; edges : [Edge]; next : ?Cursor; scanned : Nat };
  // Callbacks expose one source slot/edge at a time. No filtering, joins or
  // currentMemberIndex rebuild runs inside the bounded source traversal.
  public func read(revision : Nat, cursor : ?Cursor, sizes : [Nat],
    width : (Nat, Nat) -> Nat, edge : (Nat, Nat, Nat) -> ?Edge) : { #Ok : Page; #Err : Text } {
    var phase = 0; var offset = 0; var nested = 0;
    switch (cursor) {
      case (?c) {
        if (c.revision != revision) return #Err("Membership source revision changed");
        phase := c.phase; offset := c.offset; nested := c.nested;
        if (phase >= sizes.size() or offset > sizes[phase]) return #Err("Invalid membership source cursor");
        if (offset == sizes[phase] and nested != 0) return #Err("Invalid exhausted membership source cursor");
      };
      case null {}
    };
    let out = List.empty<Edge>(); var scanned = 0;
    while (phase < sizes.size() and scanned < 100) {
      if (offset >= sizes[phase]) { phase += 1; offset := 0; nested := 0 }
      else {
        let count = Nat.max(1, width(phase, offset));
        if (nested >= count) return #Err("Invalid membership edge cursor");
        switch (edge(phase, offset, nested)) { case (?e) out.add(e); case null {} };
        scanned += 1; nested += 1;
        if (nested == count) { offset += 1; nested := 0 };
      }
    };
    while (phase < sizes.size() and offset >= sizes[phase]) { phase += 1; offset := 0; nested := 0 };
    #Ok({ revision; edges = out.toArray(); scanned;
      next = if (phase < sizes.size()) ?{ revision; phase; offset; nested } else null })
  }
}