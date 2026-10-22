import Map "mo:core/Map";
import Text "mo:core/Text";
import Nat64 "mo:core/Nat64";
import Nat "mo:core/Nat";
import List "mo:core/List";
import Types "types";

module {
  public type Index = Map.Map<Text, Map.Map<Text, Nat>>;
  public type Cursor = { club_id : Text; revision : Nat; before : Text };
  public type Page = { assets : [Types.Asset]; next : ?Cursor; scanned : Nat };
  public type Result = { #Ok : Page; #Err : Text };
  public func key(asset : Types.Asset) : Text {
    let time = asset.created_at_ms.toText();
    var padded = time;
    while (padded.size() < 20) padded := "0" # padded;
    padded # ":" # asset.id
  };
  public func add(index : Index, asset : Types.Asset, position : Nat) {
    let club = switch (index.get(asset.club_id)) {
      case (?rows) rows;
      case null { let rows = Map.empty<Text, Nat>(); index.add(asset.club_id, rows); rows }
    };
    club.add(key(asset), position);
  };
  // Every continuation is pinned to the authoritative mutation revision.
  // Seek by ordered key, not a full-array filter or a visible-row offset.
  public func read(index : Index, assets : [Types.Asset], clubId : Text, revision : Nat,
    cursor : ?Cursor, limit : Nat, visible : Types.Asset -> Bool) : Result {
    if (limit == 0 or limit > 60) return #Err("Invalid media page limit");
    switch (cursor) {
      case (?c) { if (c.club_id != clubId or c.revision != revision or c.before.size() > 256) return #Err("Media page revision changed") };
      case null {}
    };
    let rows = switch (index.get(clubId)) {
      case (?rows) rows;
      case null return #Ok({ assets = []; next = null; scanned = 0 })
    };
    let entries = switch (cursor) { case (?c) rows.reverseEntriesFrom(c.before); case null rows.reverseEntries() };
    let result = List.empty<Types.Asset>();
    var scanned = 0;
    var last : ?Text = null;
    var more = false;
    label scan for ((k, position) in entries) {
      if (switch (cursor) { case (?c) k == c.before; case null false }) { continue scan };
      if (scanned >= 200 or result.size() >= limit) { more := true; break scan };
      scanned += 1; last := ?k;
      if (position < assets.size()) {
        let asset = assets[position];
        if (asset.club_id == clubId and key(asset) == k and not asset.deleted and visible(asset)) result.add(asset);
      };
    };
    let next = if (more) switch (last) { case (?before) ?{ club_id = clubId; revision; before }; case null null } else null;
    #Ok({ assets = result.toArray(); next; scanned })
  }
}