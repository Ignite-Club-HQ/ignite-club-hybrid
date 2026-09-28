import Array "mo:core/Array";
import Char "mo:core/Char";
import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Iter "mo:core/Iter";
import Text "mo:core/Text";
import Int "mo:core/Int";
import Time "mo:core/Time";
import Types "types";

persistent actor {
  var governor : Principal;
  var assets : [Types.Asset];
  var capabilities : [Types.Capability];
  var reactions : [Types.Reaction];
  var comments : [Types.Comment];
  var roles : [Types.RoleGrant];

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required");
  };

  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func validCapabilityAction(action : Text) : Bool { action == "upload" or action == "download" or action == "delete" };

  func validMime(mime : Text) : Bool {
    mime.size() <= 128 and Text.contains(mime, #text "/") and Iter.all(Text.toIter(mime), func(character) = not Char.isWhitespace(character))
  };

  func validPurpose(purpose : Text) : Bool { purpose != "" and purpose.size() <= 128 };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  func validRoleAssignment(role : Text, club_id : ?Text, team_id : ?Text) : Bool {
    switch (role) {
      case ("member" or "club_admin") { club_id != null and team_id == null };
      case ("team_admin" or "coach") { club_id != null and team_id != null };
      case (_) { false };
    }
  };

  func hasRole(caller : Principal, role : Text, club_id : ?Text) : Bool {
    roles.any(func(grant) {
      grant.user.equal(caller) and grant.role == role and grant.club_id == club_id
    })
  };

  // Club/team membership is intentionally coarse for the lab: any granted
  // role scoped to the asset's club (member, admin, coach) counts as a
  // viewer, matching the source app's "any club member can see club media"
  // rule without replicating its full roster sync.
  func isClubMember(caller : Principal, club_id : Text) : Bool {
    hasRole(caller, "member", ?club_id)
      or hasRole(caller, "club_admin", ?club_id)
      or hasRole(caller, "team_admin", ?club_id)
      or hasRole(caller, "coach", ?club_id)
  };

  func canView(caller : Principal, asset : Types.Asset) : Bool {
    asset.expires_at_ms > nowMs()
      and (asset.owner.equal(caller) or isGovernor(caller) or asset.visibility == "public" or isClubMember(caller, asset.club_id))
  };

  func validReactionKind(kind : Text) : Bool { kind != "" and kind.size() <= 32 };

  func validCommentBody(body : Text) : Bool { body != "" and body.size() <= 2000 };

  public shared ({ caller }) func register_asset(
    club_id : Text,
    kind : Text,
    mime : Text,
    checksum : Text,
    storage_path : Text,
    visibility : Text,
    expires_at_ms : Nat64,
  ) : async { #Ok : Types.Asset; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(kind) or not validMime(mime) or not valid(checksum) or not valid(storage_path) or not valid(visibility)) return #Err("Invalid asset");
    let encrypted = kind == "child_photo" or kind == "minor_media";
    if (encrypted and visibility == "public") return #Err("Child-sensitive media cannot be public");
    if (expires_at_ms <= nowMs()) return #Err("Asset expiry must be in the future");
    let asset : Types.Asset = {
      id = "asset-" # club_id # "-" # Nat.toText(assets.size() + 1);
      club_id;
      owner = caller;
      kind;
      mime;
      checksum;
      storage_path;
      visibility;
      content_length = 0;
      encrypted;
      child_sensitive = encrypted;
      retention_until_ms = expires_at_ms;
      deleted = false;
      expires_at_ms;
    };
    assets := assets.concat([asset]);
    #Ok(asset)
  };

  public shared ({ caller }) func issue_capability(asset_id : Text, action : Text, purpose : Text, expires_at_ms : Nat64) : async { #Ok : Types.Capability; #Err : Text } {
    auth(caller);
    if (not validCapabilityAction(action) or not validPurpose(purpose) or expires_at_ms <= nowMs()) return #Err("Invalid or expired capability");
    var found_asset : ?Types.Asset = null;
    for (a in assets.values()) {
      if (a.id == asset_id) { found_asset := ?a };
    };
    switch (found_asset) {
      case null { #Err("Asset not found") };
      case (?asset) {
        if (not asset.owner.equal(caller)) return #Err("Asset owner required");
        let capability : Types.Capability = { asset_id; action; owner = caller; allowed = true; purpose; expires_at_ms };
        capabilities := capabilities.concat([capability]);
        #Ok(capability)
      };
    }
  };

  public query ({ caller }) func get_asset(asset_id : Text) : async ?Types.Asset {
    for (a in assets.values()) {
      if (a.id == asset_id and not a.deleted and canView(caller, a)) return ?a;
    };
    null
  };

  public shared ({ caller }) func delete_asset(asset_id : Text) : async { #Ok : Types.Asset; #Err : Text } {
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (a in assets.values()) {
      if (a.id == asset_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Asset not found") };
      case (?i) {
        let asset = assets[i];
        if (not asset.owner.equal(caller)) return #Err("Asset owner required");
        let updated : Types.Asset = { asset with deleted = true; retention_until_ms = 0 };
        assets := Array.tabulate<Types.Asset>(assets.size(), func(position) {
          if (position == i) updated else assets[position]
        });
        capabilities := capabilities.filter(func(cap) = cap.asset_id != asset_id);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : ?Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not validRoleAssignment(role, club_id, team_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(grant) = grant.user.equal(principal) and grant.role == role and grant.club_id == club_id and grant.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  };

  // Team-level scoping is not modeled by this canister's Asset type yet; the
  // lab feed filters by club only, matching the source app's club-wide view.
  public query ({ caller }) func list_assets(club_id : Text) : async [Types.Asset] {
    if (caller.equal(Principal.anonymous())) return [];
    Array.filter<Types.Asset>(assets, func(a) {
      not a.deleted and a.club_id == club_id and canView(caller, a)
    })
  };

  public shared ({ caller }) func add_reaction(asset_id : Text, kind : Text, created_at_ms : Nat64) : async { #Ok : Types.Reaction; #Err : Text } {
    auth(caller);
    if (not validReactionKind(kind)) return #Err("Invalid reaction kind");
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id and not a.deleted) { found := ?a } };
    switch (found) {
      case null { #Err("Asset not found") };
      case (?asset) {
        if (not canView(caller, asset)) return #Err("Not authorized to react to this asset");
        // Supabase parity: a user holds exactly one reaction per asset —
        // replace any prior reaction (regardless of kind), never accumulate.
        reactions := reactions.filter(func(r) = not (r.asset_id == asset_id and r.user.equal(caller)));
        let reaction : Types.Reaction = { asset_id; user = caller; kind; created_at_ms };
        reactions := reactions.concat([reaction]);
        #Ok(reaction)
      };
    }
  };

  public shared ({ caller }) func remove_reaction(asset_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    reactions := reactions.filter(func(r) = not (r.asset_id == asset_id and r.user.equal(caller)));
    #Ok
  };

  public query ({ caller }) func list_reactions(asset_id : Text) : async [Types.Reaction] {
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id) { found := ?a } };
    switch (found) {
      case null { [] };
      case (?asset) {
        if (not canView(caller, asset)) return [];
        Array.filter<Types.Reaction>(reactions, func(r) = r.asset_id == asset_id)
      };
    }
  };

  public shared ({ caller }) func add_comment(asset_id : Text, body : Text, created_at_ms : Nat64) : async { #Ok : Types.Comment; #Err : Text } {
    auth(caller);
    if (not validCommentBody(body)) return #Err("Invalid comment");
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id and not a.deleted) { found := ?a } };
    switch (found) {
      case null { #Err("Asset not found") };
      case (?asset) {
        if (not canView(caller, asset)) return #Err("Not authorized to comment on this asset");
        let comment : Types.Comment = {
          id = "comment-" # asset_id # "-" # Nat.toText(comments.size() + 1);
          asset_id;
          author = caller;
          body;
          created_at_ms;
          deleted = false;
        };
        comments := comments.concat([comment]);
        #Ok(comment)
      };
    }
  };

  public query ({ caller }) func list_comments(asset_id : Text) : async [Types.Comment] {
    var found : ?Types.Asset = null;
    for (a in assets.values()) { if (a.id == asset_id) { found := ?a } };
    switch (found) {
      case null { [] };
      case (?asset) {
        if (not canView(caller, asset)) return [];
        Array.filter<Types.Comment>(comments, func(c) = c.asset_id == asset_id and not c.deleted)
      };
    }
  };

  public shared ({ caller }) func delete_comment(comment_id : Text) : async { #Ok : Types.Comment; #Err : Text } {
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (c in comments.values()) {
      if (c.id == comment_id) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Comment not found") };
      case (?i) {
        let comment = comments[i];
        if (not comment.author.equal(caller) and not isGovernor(caller)) return #Err("Comment author required");
        let updated : Types.Comment = { comment with deleted = true };
        comments := Array.tabulate<Types.Comment>(comments.size(), func(position) {
          if (position == i) updated else comments[position]
        });
        #Ok(updated)
      };
    }
  };

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok({ schema = 2; governor; assets; capabilities; reactions; comments; roles })
  };
};