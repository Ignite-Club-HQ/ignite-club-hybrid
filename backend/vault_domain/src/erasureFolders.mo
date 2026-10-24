import Principal "mo:core/Principal";
import Array "mo:core/Array";
import Types "types";

module {
  // Retain other people's hierarchy and ancestors needed by their files.
  // Removed ownership is scrubbed even when a shared ancestor must survive.
  public func scrub(subject : Principal, folders : [Types.VaultFolder], files : [Types.VaultFile]) : [Types.VaultFolder] {
    var required = folders.filter(func f = not f.created_by.equal(subject)).map(func f = f.id);
    required := required.concat(files.map(func f = f.folder_id));
    for (_ in Array.tabulate<Nat>(32, func i = i).values()) {
      var added = false;
      for (f in folders.values()) {
        if (required.any(func id = id == f.id)) switch (f.parent_id) {
          case (?parent) if (not required.any(func id = id == parent)) { required := required.concat([parent]); added := true };
          case null {}
        }
      };
      if (not added) break
    };
    folders.filter(func f = required.any(func id = id == f.id)).map(func f = if (f.created_by.equal(subject) or f.deleted_by == ?subject) ({ f with created_by = if (f.created_by.equal(subject)) Principal.anonymous() else f.created_by; deleted_by = if (f.deleted_by == ?subject) null else f.deleted_by }) else f)
  }
}