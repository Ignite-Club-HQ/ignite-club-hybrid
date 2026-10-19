import Array "mo:core/Array";
import Nat "mo:core/Nat";
module {
  type OldGroup = { id : Text; event_id : Text; name : Text; created_at_ms : Nat64; team_letter : ?Text; colour : ?Text; team_b_colour : ?Text; display_order : Nat16; ability_band : ?Text; pitch_name : ?Text };
  type NewGroup = { id : Text; event_id : Text; name : Text; created_at_ms : Nat64; team_letter : ?Text; colour : ?Text; team_b_colour : ?Text; display_order : Nat16; ability_band : ?Text; pitch_name : ?Text; timer_state_json : ?Text; pitch_state_json : ?Text; state_revision : Nat64 };
  type OldDuty = { group_id : Text; duty : Text; account_id : ?Text };
  type NewDuty = { id : Text; group_id : Text; duty : Text; account_id : ?Text };
  public func migration(old : { var eventGroups : [OldGroup]; var eventGroupDuties : [OldDuty] }) : { var eventGroups : [NewGroup]; var eventGroupDuties : [NewDuty] } {
    { var eventGroups = old.eventGroups.map(func(g) : NewGroup = { g with timer_state_json = null; pitch_state_json = null; state_revision = 0 });
      var eventGroupDuties = Array.tabulate<NewDuty>(old.eventGroupDuties.size(), func(i) { let d = old.eventGroupDuties[i]; { id = "migrated:" # Nat.toText(i); group_id = d.group_id; duty = d.duty; account_id = d.account_id } }) }
  }
}