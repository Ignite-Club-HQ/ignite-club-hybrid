import Nat64 "mo:core/Nat64";
module {
  public func canAppend(rows : Nat) : Bool { rows < 2500 };
  // A stored read frontier covers only messages at/before its server sequence.
  // Missing/deleted/legacy-zero frontiers never imply another message was read.
  public func covers(target : Nat64, frontier : Nat64, exact : Bool) : Bool {
    exact or (target > 0 and frontier > 0 and target <= frontier)
  };
};