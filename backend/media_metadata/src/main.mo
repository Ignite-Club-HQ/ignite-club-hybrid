import Array "mo:core/Array";
import Char "mo:core/Char";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Iter "mo:core/Iter";
import Text "mo:core/Text";
import Int "mo:core/Int";
import Time "mo:core/Time";
import Types "types";

persistent actor class Main(governorInit : Principal) {
  var governor : Principal;

  if (governor.equal(Principal.anonymous()) and not governorInit.equal(Principal.anonymous())) {
    governor := governorInit;
  };

  var assets : [Types.Asset];
  var capabilities : [Types.Capability];
  var reactions : [Types.Reaction];
  var comments : [Types.Comment];
  var roles : [Types.RoleGrant];
  var bulkAccessPrincipals : [Principal];
  var galleryChatCards : [Types.GalleryChatCard];

  transient let MAX_ASSETS = 20_000;
  transient let MAX_CAPABILITIES = 20_000;
  transient let MAX_REACTIONS = 20_000;
  transient let MAX_COMMENTS = 20_000;
  transient let MAX_ROLES = 5_000;
  transient let MAX_BULK_ACCESS = 200;
  transient let MAX_GALLERY_CHAT_CARDS = 20_000;
  transient let MAX_PHOTO_IDS = 200;

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };

  func auth(caller : Principal) {
    if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required");
  };

  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };

  func hasBulkAccess(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and bulkAccessPrincipals.any(func(p) = p.equal(caller))
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
    isGovernor(caller)
      or hasRole(caller, "member", ?club_id)
      or hasRole(caller, "club_admin", ?club_id)
      or hasRole(caller, "team_admin", ?club_id)
      or hasRole(caller, "coach", ?club_id)
  };

  // Club staff (not plain members) — used to gate gallery-card creation and
  // moderation, matching the source app's "team admin/coach/club admin can
  // post or remove a gallery card" rule.
  func isClubStaff(caller : Principal, club_id : Text) : Bool {
    isGovernor(caller)
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
    if (assets.size() >= MAX_ASSETS) return #Err("Asset limit reached");
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
      blob_ref = null;
      visibility;
      content_length = 0;
      encrypted;
      child_sensitive = encrypted;
      retention_until_ms = expires_at_ms;
      deleted = false;
      expires_at_ms;
      created_at_ms = nowMs();
      team_id = null;
      mini_league_id = null;
      competition_id = null;
      event_id = null;
      caption = null;
      album_id = null;
    };
    assets := assets.concat([asset]);
    #Ok(asset)
  };

  // Tags a registered asset with its audience scope (team / mini league /
  // competition / event), caption and album grouping. Kept separate from
  // register_asset so the registration signature stays stable; the frontend
  // calls this immediately after registering. Owner or club staff may tag.
  public shared ({ caller }) func set_asset_scope(
    asset_id : Text,
    team_id : ?Text,
    mini_league_id : ?Text,
    competition_id : ?Text,
    event_id : ?Text,
    caption : ?Text,
    album_id : ?Text,
  ) : async { #Ok : Types.Asset; #Err : Text } {
    auth(caller);
    func validOptLength(value : ?Text, max : Nat) : Bool {
      switch (value) { case null { true }; case (?v) { v.size() <= max } };
    };
    if (not validOptLength(team_id, 128) or not validOptLength(mini_league_id, 128) or not validOptLength(competition_id, 128) or not validOptLength(event_id, 128) or not validOptLength(album_id, 128) or not validOptLength(caption, 2000)) return #Err("Invalid scope");
    var found_idx : ?Nat = null;
    var idx = 0;
    for (a in assets.values()) {
      if (a.id == asset_id and not a.deleted) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Asset not found") };
      case (?i) {
        let asset = assets[i];
        if (not asset.owner.equal(caller) and not isClubStaff(caller, asset.club_id)) return #Err("Asset owner or club staff required");
        let updated : Types.Asset = { asset with team_id; mini_league_id; competition_id; event_id; caption; album_id };
        assets := Array.tabulate<Types.Asset>(assets.size(), func(position) {
          if (position == i) updated else assets[position]
        });
        #Ok(updated)
      };
    }
  };

  // Points an asset at bytes held by an ICP blob-store canister instead of
  // the off-chain storage_path. The blob store is a separate canister; this
  // canister only records where the bytes live. Passing null clears the
  // pointer and returns the asset to off-chain storage resolution.
  public shared ({ caller }) func set_blob_ref(asset_id : Text, blob_ref : ?Types.BlobRef) : async { #Ok : Types.Asset; #Err : Text } {
    auth(caller);
    var found_idx : ?Nat = null;
    var idx = 0;
    for (a in assets.values()) {
      if (a.id == asset_id and not a.deleted) { found_idx := ?idx };
      idx += 1;
    };
    switch (found_idx) {
      case null { #Err("Asset not found") };
      case (?i) {
        let asset = assets[i];
        if (not asset.owner.equal(caller) and not isGovernor(caller)) return #Err("Asset owner required");
        switch (blob_ref) {
          case (?r) {
            if (not valid(r.canister) or not valid(r.path) or not valid(r.content_hash)) return #Err("Invalid blob reference");
          };
          case null {};
        };
        let updated : Types.Asset = { asset with blob_ref };
        assets := Array.tabulate<Types.Asset>(assets.size(), func(position) {
          if (position == i) updated else assets[position]
        });
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func issue_capability(asset_id : Text, action : Text, purpose : Text, expires_at_ms : Nat64) : async { #Ok : Types.Capability; #Err : Text } {
    auth(caller);
    if (not validCapabilityAction(action) or not validPurpose(purpose) or expires_at_ms <= nowMs()) return #Err("Invalid or expired capability");
    if (capabilities.size() >= MAX_CAPABILITIES) return #Err("Capability limit reached");
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
      if (roles.size() >= MAX_ROLES) return #Err("Role limit reached");
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
        if (reactions.size() >= MAX_REACTIONS) return #Err("Reaction limit reached");
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
    if (comments.size() >= MAX_COMMENTS) return #Err("Comment limit reached");
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

  // ---------------- Gallery chat cards ----------------
  // Mirrors the Supabase gallery_chat_cards row shape (photo-share prompt
  // cards surfaced in team chat). Supabase remains the writer today — rows
  // are created by a DB trigger/edge function outside the frontend, not by
  // app code — so these methods exist so the II read path returns real data
  // once the lab is seeded, not to replace the Supabase writer.

  func validGalleryPhotoIds(photo_ids : [Text]) : Bool {
    photo_ids.size() <= MAX_PHOTO_IDS and Iter.all(photo_ids.values(), func(pid : Text) : Bool { valid(pid) })
  };

  func findGalleryCardIndex(card_id : Text) : ?Nat {
    var found_idx : ?Nat = null;
    var idx = 0;
    for (c in galleryChatCards.values()) {
      if (c.id == card_id) { found_idx := ?idx };
      idx += 1;
    };
    found_idx
  };

  public shared ({ caller }) func save_gallery_chat_card(
    id : ?Text,
    club_id : Text,
    team_id : Text,
    event_id : ?Text,
    message_id : Text,
    hero_photo_id : ?Text,
    hero_image_url : ?Text,
    photo_count : Nat32,
    photo_ids : [Text],
    is_prompt : Bool,
    push_sent : Bool,
  ) : async { #Ok : Types.GalleryChatCard; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(team_id) or not valid(message_id)) return #Err("Invalid gallery chat card");
    if (not validGalleryPhotoIds(photo_ids)) return #Err("Too many photo ids");
    switch (id) {
      case null {
        if (not isClubStaff(caller, club_id)) return #Err("Club staff required");
        if (galleryChatCards.size() >= MAX_GALLERY_CHAT_CARDS) return #Err("Gallery chat card limit reached");
        let now = nowMs();
        let card : Types.GalleryChatCard = {
          id = "gallery-card-" # team_id # "-" # Nat.toText(galleryChatCards.size() + 1);
          club_id;
          team_id;
          event_id;
          message_id;
          hero_photo_id;
          hero_image_url;
          photo_count;
          photo_ids;
          is_prompt;
          push_sent;
          uploader_id = caller;
          created_at_ms = now;
          updated_at_ms = now;
        };
        galleryChatCards := galleryChatCards.concat([card]);
        #Ok(card)
      };
      case (?card_id) {
        switch (findGalleryCardIndex(card_id)) {
          case null { #Err("Gallery chat card not found") };
          case (?i) {
            let existing = galleryChatCards[i];
            if (not existing.uploader_id.equal(caller) and not isClubStaff(caller, existing.club_id)) return #Err("Card author or club staff required");
            let updated : Types.GalleryChatCard = {
              existing with
              club_id;
              team_id;
              event_id;
              message_id;
              hero_photo_id;
              hero_image_url;
              photo_count;
              photo_ids;
              is_prompt;
              push_sent;
              updated_at_ms = nowMs();
            };
            galleryChatCards := Array.tabulate<Types.GalleryChatCard>(galleryChatCards.size(), func(position) {
              if (position == i) updated else galleryChatCards[position]
            });
            #Ok(updated)
          };
        }
      };
    }
  };

  public query ({ caller }) func get_gallery_chat_card(card_id : Text) : async ?Types.GalleryChatCard {
    for (c in galleryChatCards.values()) {
      if (c.id == card_id and isClubMember(caller, c.club_id)) return ?c;
    };
    null
  };

  public query ({ caller }) func list_gallery_chat_cards(club_id : Text, team_id : Text) : async [Types.GalleryChatCard] {
    if (caller.equal(Principal.anonymous()) or not isClubMember(caller, club_id)) return [];
    Array.filter<Types.GalleryChatCard>(galleryChatCards, func(c) = c.club_id == club_id and c.team_id == team_id)
  };

  public shared ({ caller }) func delete_gallery_chat_card(card_id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (findGalleryCardIndex(card_id)) {
      case null { #Err("Gallery chat card not found") };
      case (?i) {
        let existing = galleryChatCards[i];
        if (not existing.uploader_id.equal(caller) and not isClubStaff(caller, existing.club_id)) return #Err("Card author or club staff required");
        galleryChatCards := galleryChatCards.filter(func(c) = c.id != card_id);
        #Ok
      };
    }
  };

  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) {
      if (bulkAccessPrincipals.size() >= MAX_BULK_ACCESS) return #Err("Bulk access limit reached");
      bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]);
    };
    #Ok
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Governor only");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor only");
    #Ok(bulkAccessPrincipals)
  };

  public query ({ caller }) func export_state() : async { #Ok : Types.State; #Err : Text } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor only");
    #Ok({ schema = 4; governor; assets; capabilities; reactions; comments; roles; galleryChatCards })
  };
};
