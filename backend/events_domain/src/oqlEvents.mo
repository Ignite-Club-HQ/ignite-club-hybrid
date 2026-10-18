import Oql "../../shared/Oql";
import Types "types";
import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Nat64 "mo:core/Nat64";

module {
  public let entity : Oql.Entity = { name = "events"; fields = [
    { name = "id"; kind = "text" }, { name = "club_id"; kind = "text" },
    { name = "team_id"; kind = "text" }, { name = "title"; kind = "text" },
    { name = "event_type"; kind = "text" }, { name = "location"; kind = "text" },
    { name = "starts_at_ms"; kind = "int" }, { name = "ends_at_ms"; kind = "int" },
    { name = "cancelled"; kind = "bool" }, { name = "opponent"; kind = "text" }
  ] };
  public func canView(caller : Principal, governor : Principal, roles : [Types.RoleGrant], event : Types.Event) : Bool {
    not caller.equal(Principal.anonymous()) and (
      governor.equal(caller) or event.creator.equal(caller) or
      roles.any(func(grant) = grant.user.equal(caller) and grant.club_id == event.club_id)
    )
  };
  public func row(event : Types.Event) : Oql.Row {
    [Oql.text("id", event.id), Oql.text("club_id", event.club_id),
     Oql.optional("team_id", event.team_id), Oql.text("title", event.title),
     Oql.text("event_type", event.event_type), Oql.optional("location", event.location),
     Oql.integer("starts_at_ms", Nat64.toNat(event.starts_at_ms)), Oql.integer("ends_at_ms", Nat64.toNat(event.ends_at_ms)),
     Oql.boolean("cancelled", event.cancelled), Oql.optional("opponent", event.opponent)]
  };
}