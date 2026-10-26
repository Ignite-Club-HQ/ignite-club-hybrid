// One-time account claims for clubs moving from Supabase.
//
// The migration tool (governor) registers SHA-256 hashes of random tokens that it
// emails only to each member's Supabase address. Redeeming a token binds the
// authenticated caller's principal to that Supabase user, once. The tool later
// reads claimed pairs to load member-owned data under the right principal.
// Raw tokens are never stored; a principal binds to at most one Supabase user
// per club; erasure removes a principal's bindings.
import Map "mo:core/Map";
import Text "mo:core/Text";
import Principal "mo:core/Principal";
import Nat8 "mo:core/Nat8";
import Sha256 "mo:sha2/Sha256";
import Iter "mo:core/Iter";
import Array "mo:core/Array";
import Char "mo:core/Char";

module {
  public type Claim = { club_id : Text; source_user : Text; email_hint : Text; expires_ms : Nat64; claimed_by : ?Principal; claimed_ms : ?Nat64 };
  public type Registration = { token_hash : Text; source_user : Text; email_hint : Text; expires_ms : Nat64 };
  public type Claimed = { source_user : Text; principal : Principal; claimed_ms : Nat64 };
  public let MAX_PAGE = 500;

  public func hashToken(token : Text) : Text {
    let digest = Sha256.fromBlob(#sha256, Text.encodeUtf8(token));
    var out = "";
    for (b in digest.vals()) {
      let hex = "0123456789abcdef".chars().toArray();
      let n = Nat8.toNat(b);
      out #= Text.fromChar(hex[n / 16]) # Text.fromChar(hex[n % 16]);
    };
    out
  };

  func isHex(t : Text, len : Nat) : Bool =
    t.size() == len and t.chars().all(func c = (c >= '0' and c <= '9') or (c >= 'a' and c <= 'f'));

  func principalKey(p : Principal, club : Text) : Text = Principal.toText(p) # "\u{1f}" # club;

  public func register(claims : Map.Map<Text, Claim>, club : Text, rows : [Registration]) : { #Ok : Nat; #Err : Text } {
    if (club.size() == 0 or club.size() > 64) return #Err("Invalid club");
    if (rows.size() > MAX_PAGE) return #Err("Too many claims in one page");
    for (r in rows.vals()) {
      if (not isHex(r.token_hash, 64)) return #Err("Invalid token hash");
      if (r.source_user.size() == 0 or r.source_user.size() > 64 or r.email_hint.size() > 128) return #Err("Invalid claim");
      switch (Map.get(claims, Text.compare, r.token_hash)) {
        case (?old) if (old.club_id != club or old.source_user != r.source_user) return #Err("Token hash collision");
        case null {};
      };
    };
    var added = 0;
    for (r in rows.vals()) {
      switch (Map.get(claims, Text.compare, r.token_hash)) {
        case (?old) if (old.claimed_by == null) Map.add(claims, Text.compare, r.token_hash, { old with expires_ms = r.expires_ms; email_hint = r.email_hint });
        case null { Map.add(claims, Text.compare, r.token_hash, { club_id = club; source_user = r.source_user; email_hint = r.email_hint; expires_ms = r.expires_ms; claimed_by = null; claimed_ms = null }); added += 1 };
      };
    };
    #Ok(added)
  };

  public func redeem(claims : Map.Map<Text, Claim>, byPrincipal : Map.Map<Text, Text>, caller : Principal, token : Text, now : Nat64) : { #Ok : { club_id : Text }; #Err : Text } {
    if (Principal.isAnonymous(caller)) return #Err("Sign in with Internet Identity first");
    if (not isHex(token, 64)) return #Err("This link isn't valid");
    let key = hashToken(token);
    let c = switch (Map.get(claims, Text.compare, key)) { case (?c) c; case null return #Err("This link isn't valid") };
    switch (c.claimed_by) {
      case (?p) return if (Principal.equal(p, caller)) #Ok({ club_id = c.club_id }) else #Err("This link has already been used");
      case null {};
    };
    if (now > c.expires_ms) return #Err("This link has expired; ask your club for a new one");
    let pk = principalKey(caller, c.club_id);
    switch (Map.get(byPrincipal, Text.compare, pk)) {
      case (?other) if (other != c.source_user) return #Err("This Internet Identity is already linked to another account in this club");
      case null {};
    };
    Map.add(claims, Text.compare, key, { c with claimed_by = ?caller; claimed_ms = ?now });
    Map.add(byPrincipal, Text.compare, pk, c.source_user);
    #Ok({ club_id = c.club_id })
  };

  public func claimed(claims : Map.Map<Text, Claim>, club : Text, offset : Nat, limit : Nat) : [Claimed] {
    let take = if (limit > MAX_PAGE) MAX_PAGE else limit;
    var seen = 0;
    var out : [Claimed] = [];
    label scan for ((_, c) in Map.entries(claims)) {
      if (c.club_id != club) continue scan;
      switch (c.claimed_by, c.claimed_ms) {
        case (?p, ?at) {
          if (seen >= offset) out := out.concat([{ source_user = c.source_user; principal = p; claimed_ms = at }]);
          seen += 1;
          if (out.size() >= take) break scan;
        };
        case _ {};
      };
    };
    out
  };

  /** Erasure: forget every binding held by these principals. */
  public func erase(claims : Map.Map<Text, Claim>, byPrincipal : Map.Map<Text, Text>, principals : [Principal]) {
    for ((k, c) in Map.entries(claims).toArray().vals()) {
      switch (c.claimed_by) {
        case (?p) if (principals.any(func q = Principal.equal(p, q))) {
          Map.remove(claims, Text.compare, k);
          Map.remove(byPrincipal, Text.compare, principalKey(p, c.club_id));
        };
        case null {};
      };
    };
  };
};
