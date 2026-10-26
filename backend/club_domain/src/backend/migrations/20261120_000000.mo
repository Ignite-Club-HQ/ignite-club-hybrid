// Scrub plaintext addresses from legacy team invites; delivery uses the encrypted outbox.
module {
  type TeamInvite = { id : Text; club_id : Text; team_id : Text; email : Text; role : Text; invited_by : Principal; created_at_ms : Nat64; expires_at_ms : Nat64; accepted_by : ?Principal; revoked : Bool };
  public func migration(old : { var teamInvites : [TeamInvite] }) : { var teamInvites : [TeamInvite] } {
    var teamInvites = old.teamInvites;
    teamInvites := teamInvites.map(func(i : TeamInvite) : TeamInvite = { i with email = if (i.email == "") "" else "pii:email" });
    { var teamInvites }
  };
};
