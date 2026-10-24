import Array "mo:core/Array";
import Types "types";

module {
  public type Input = {
    request_id : Text; club_id : Text; team_id : ?Text; title : Text; description : Text;
    event_type : Text; location : ?Text; opponent : ?Text; address : ?Text; mini_league_id : ?Text;
    rsvp_audience : ?Text; adults_only : Bool; restricted_to_roles : ?[Text]; target_team_ids : ?[Text];
    occurrences : [{ starts_at_ms : Nat64; ends_at_ms : Nat64 }];
    duties : [{ duty : Text; account_id : ?Text }]; duty_team_id : ?Text; reminder_hours : ?Nat16;
  };
  public type Result = { first_event_id : Text; series_id : ?Text; event_ids : [Text] };
  public func valid(input : Input) : Bool {
    if (input.request_id.size() == 0 or input.request_id.size() > 128 or input.occurrences.size() == 0 or input.occurrences.size() > 366 or input.duties.size() > 30) return false;
    var previous : ?Nat64 = null;
    for (date in input.occurrences.values()) {
      if (date.starts_at_ms >= date.ends_at_ms or (switch (previous) { case null false; case (?p) date.starts_at_ms <= p })) return false;
      previous := ?date.starts_at_ms;
    };
    switch (input.reminder_hours) { case (?h) { if (h == 0 or h > 720) return false }; case null {} };
    if (input.duties.any(func(d) = d.duty.size() == 0 or d.duty.size() > 128 or (switch (d.account_id) { case null false; case (?id) id.size() == 0 or id.size() > 128 }))) return false;
    // The existing assigned-duty ledger has one slot per account/event.
    var assigned : [Text] = [];
    for (duty in input.duties.values()) switch (duty.account_id) {
      case null {};
      case (?id) { if (assigned.any(func(a) = a == id)) return false; assigned := assigned.concat([id]) };
    };
    true
  };
}