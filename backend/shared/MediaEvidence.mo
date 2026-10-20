import Nat "mo:core/Nat";
module {
  public type Reference = { resource_id : Text; url : Text; store : ?Text; path : ?Text; content_hash : ?Text };
  public type Page = { revision : Nat; scanned : Nat; next : ?Nat; references : [Reference] };
  // Offset indexes the complete underlying collection, not caller-visible
  // rows. Empty pages are not terminal; only next=null proves completion.
  public func bounds(offset : Nat, size : Nat) : (Nat, Nat) {
    (Nat.min(offset, size), Nat.min(offset + 200, size))
  };
}