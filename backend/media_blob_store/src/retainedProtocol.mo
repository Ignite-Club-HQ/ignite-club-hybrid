import Principal "mo:core/Principal";
import Text "mo:core/Text";
module {
  public type Cursor = { phase : { #legacy; #indexed; #done }; offset : Nat; after : Text };
  public type Row = { path : Text; club : ?Text; bytes : Nat; content_hash : Text; revision : Nat };
  public type Page = { frozen : Bool; pending : Nat; authority : ?Principal; revision : Nat; total : Nat; total_bytes : Nat; cursor : Cursor; next : Cursor; rows : [Row] };
  public type Deletion = { token : Text; path : Text; club : Text; bytes : Nat; revision : Nat; owner : Principal; removed : Bool };
  public func club(path : Text) : ?Text {
    let ?rest = path.stripStart(#text "clubs/") else return null;
    let ?id = rest.split(#char '/').next() else return null;
    if (id == "" or id.size() > 128 or id.contains(#char '\u{1f}') or not path.startsWith(#text("clubs/" # id # "/"))) return null;
    ?id
  };
  public func validPath(path : Text) : Bool { path.size() > 0 and path.size() <= 512 and not path.contains(#char '\u{1f}') and (not path.startsWith(#text "clubs/") or club(path) != null) };
}
