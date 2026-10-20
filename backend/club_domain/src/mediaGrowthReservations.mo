import Map "mo:core/Map";
import Text "mo:core/Text";
import Retained "mediaRetainedQuota";
module {
  // Budgets are physical bytes, not headline canister capacity. Account for
  // worst-case power-of-two rounding plus the global 100,000-object slot floor.
  public let slotOverhead : Nat = 6_553_600_000;
  public type State = { var configured : Bool; var usable : Nat; var unassigned : Nat; var freeBytes : Nat; var revision : Nat; commitments : Map.Map<Text, Nat> };
  public func empty() : State { { var configured = false; var usable = 0; var unassigned = 0; var freeBytes = 0; var revision = 0; commitments = Map.empty() } };
  public func committed(state : State) : Nat {
    var sum = state.unassigned + slotOverhead;
    for ((_, bytes) in state.commitments.entries()) sum += bytes;
    sum
  };
  public func reserve(state : State, ledger : Retained.Ledger, club : Text, allowance : Nat) : Bool {
    if (not state.configured or club.size() == 0 or club.size() > 128) return false;
    let usage = Retained.usage(ledger, club);
    let logical = if (allowance > usage.finalized + usage.pending) allowance else usage.finalized + usage.pending;
    let want = logical * 2;
    let old = state.commitments.get(club) ?? 0;
    // Downgrades/deletions never release a growth promise automatically.
    if (old >= want) return true;
    if (state.commitments.size() >= 100_000 and old == 0) return false;
    if (committed(state) + want - old > state.usable) return false;
    state.commitments.add(club, want); state.revision += 1; true
  };
}