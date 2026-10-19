module {
  public type Phase = { #legacy; #indexed; #pending; #journal; #done };
  public type Cursor = { phase : Phase; offset : Nat; after : Text };
  public type Entry = {
    kind : { #blob; #pending; #journal };
    path : Text;
    upload_id : Text;
    content_hash : Text;
    content_length : Nat;
    unsettled : Bool;
  };
  public type Page = {
    revision : Nat;
    fenced : Bool;
    fence_revision : ?Nat;
    quota_shared : Bool;
    quota_authority : ?Principal;
    entries : [Entry];
    next : ?Cursor;
    scanned : Nat;
  };
  public let pageLimit : Nat = 200;
}