import Types "types";
import Source "membershipSource";
import Directory "membershipDirectorySource";
module {
  // One immutable generation. Array references are captured, never flattened
  // or copied on membership writes. Live changes remain in the dirty journal.
  public type Data = {
    profiles : [Types.ClubProfile]; roles : [Types.RoleGrant];
    children : [Types.Child]; guardians : [Types.Guardian];
    aclTeams : [Types.Team]; teams : [Types.ClubTeam];
    exclusions : [Types.Exclusion]; removed : [Types.RemovedMember];
  };
  public type Snapshot = {
    binding : Directory.Binding; revision : Nat; data : Data;
    var started : Bool; var next : ?Source.Cursor;
    var last : ?{ cursor : ?Source.Cursor; page : Source.Page };
  };
  public type State = { var snapshot : ?Snapshot };
  public func acquire(state : State, binding : Directory.Binding, revision : Nat,
    cursor : ?Source.Cursor, capture : () -> Data) : { #Ok : Snapshot; #Err : Text } {
    switch (state.snapshot) {
      case (?s) {
        if (not Directory.same(s.binding, binding)) return #Err("Retained source binding changed");
        switch (cursor) { case (?c) { if (c.revision != s.revision) return #Err("Retained source revision changed") }; case null {} };
        #Ok(s)
      };
      case null {
        switch (cursor) {
          case (?c) { if (c.revision != revision or c.phase != 0 or c.offset != 0 or c.nested != 0) return #Err("Retained source start changed") };
          case null {}
        };
        let s : Snapshot = { binding; revision; data = capture(); var started = false; var next = null; var last = null };
        state.snapshot := ?s; #Ok(s)
      }
    }
  };
  public func read(s : Snapshot, cursor : ?Source.Cursor) : { #Ok : Source.Page; #Err : Text } {
    // Canonicalize the explicit revision-pinned start and null start.
    let request = switch (cursor) {
      case (?c) { if (c.revision == s.revision and c.phase == 0 and c.offset == 0 and c.nested == 0) null else ?c };
      case null null
    };
    switch (s.last) { case (?saved) { if (saved.cursor == request) return #Ok(saved.page) }; case null {} };
    if (s.started and (s.next == null or request != s.next)) return #Err("Sequential retained source cursor required");
    if (not s.started and request != null) return #Err("Retained source must start at the first page");
    let d = s.data;
    let sizes = [d.profiles.size(), d.roles.size(), d.children.size(), d.guardians.size(), d.aclTeams.size(), d.teams.size(), d.exclusions.size(), d.removed.size()];
    func width(phase : Nat, offset : Nat) : Nat { if (phase == 2) d.children[offset].teams.size() + 1 else 1 };
    func edge(phase : Nat, offset : Nat, nested : Nat) : ?Source.Edge {
      switch (phase) {
        case (0) { let c = d.profiles[offset]; ?#Club({ id = c.id; deleted = c.deleted_at_ms != null }) };
        case (1) { let g = d.roles[offset]; ?#Role({ subject = g.user; club = g.club }) };
        case (2) { let c = d.children[offset]; if (nested == 0) switch (c.parent) { case (?subject) ?#Parent({ child = c.id; subject }); case null null } else ?#ChildTeam({ child = c.id; team = c.teams[nested - 1] }) };
        case (3) { let g = d.guardians[offset]; ?#Guardian({ child = g.child; subject = g.user }) };
        case (4) { let t = d.aclTeams[offset]; ?#Team({ id = t.id; club = t.club; deleted = false }) };
        case (5) { let t = d.teams[offset]; ?#Team({ id = t.id; club = t.club_id; deleted = t.deleted_at_ms != null }) };
        case (6) { let e = d.exclusions[offset]; ?#Excluded({ subject = e.user; club = e.club }) };
        case (7) { let e = d.removed[offset]; ?#Excluded({ subject = e.user; club = e.club }) };
        case (_) null
      }
    };
    switch (Source.read(s.revision, request, sizes, width, edge)) {
      case (#Err(e)) #Err(e);
      case (#Ok(page)) { s.started := true; s.next := page.next; s.last := ?{ cursor = request; page }; #Ok(page) }
    }
  };
  // Release only a fully traversed exact generation, with idempotent readback
  // handled by the durable acknowledged revision outside the retention slot.
  public func complete(state : State, binding : Directory.Binding, revision : Nat) : Bool {
    switch (state.snapshot) {
      case (?s) {
        if (not Directory.same(s.binding, binding) or revision != s.revision or not s.started or s.next != null) return false;
        state.snapshot := null; true
      };
      case null false
    }
  };
}