import Array "mo:core/Array";
module {
type TeamInvite = {
    id : Text;
    club_id : Text;
    team_id : Text;
    email : Text;
    role : Text;
    invited_by : Principal;
    created_at_ms : Nat64;
    expires_at_ms : Nat64;
    accepted_by : ?Principal;
    revoked : Bool;
  };
type PendingInvite = {
    id : Text;
    kind : Text;
    club_id : Text;
    team_id : ?Text;
    child_id : ?Text;
    email : Text;
    role : ?Text;
    invited_by : Principal;
    created_at_ms : Nat64;
    status : Text; // "pending" | "resent" | "revoked" | "accepted"
    resent_at_ms : ?Nat64;
    // Set when accept_pending_invite succeeds — backs the engagement
    // analytics "new members" / invite-acceptance surfaces.
    accepted_at_ms : ?Nat64;
    accepted_by : ?Principal;
  };
  public func migration(old : { var teamInvites : [TeamInvite]; var pendingInvites : [PendingInvite] }) : { var teamInvites : [TeamInvite]; var pendingInvites : [PendingInvite] } {
    { var teamInvites = old.teamInvites.map(func i = { i with email = "pii:email" });
      var pendingInvites = old.pendingInvites.map(func i = { i with email = "pii:email" }) }
  };
}
