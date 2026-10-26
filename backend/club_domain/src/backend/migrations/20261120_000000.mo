// Scrub plaintext addresses from legacy team invites; delivery uses the encrypted outbox.
import Array "mo:core/Array";

module {
  type TeamInvite = { id : Text; club_id : Text; team_id : Text; email : Text; role : Text; invited_by : Principal; created_at_ms : Nat64; expires_at_ms : Nat64; accepted_by : ?Principal; revoked : Bool };
  public func migration(old : { var teamInvites : [TeamInvite] }) : { var teamInvites : [TeamInvite] } {
    let teamInvites = Array.map<TeamInvite, TeamInvite>(old.teamInvites, func(i : TeamInvite) : TeamInvite = { i with email = if (i.email == "") "" else "pii:email" });
    { var teamInvites }
  };
};
