import Array "mo:core/Array";
import Int "mo:core/Int";
import Int32 "mo:core/Int32";
import Nat "mo:core/Nat";
import Nat32 "mo:core/Nat32";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
import Runtime "mo:core/Runtime";
import Time "mo:core/Time";
import Types "types";

persistent actor {
  var governor : Principal;
  var roles : [Types.RoleGrant];
  var pointsHistory : [Types.PointsHistoryEntry];
  var userClubPoints : [Types.UserClubPoints];
  var childClubPoints : [Types.ChildClubPoints];
  var clubRewards : [Types.ClubReward];
  var redemptions : [Types.RewardRedemption];
  var cooldowns : [Types.PointsCooldown];
  var bulkAccessPrincipals : [Principal];
  var clubPointsSettings : [Types.ClubPointsSettings];

  func auth(caller : Principal) { if (caller.equal(Principal.anonymous())) Runtime.trap("Authenticated caller required") };
  func valid(value : Text) : Bool { value != "" and value.size() <= 128 };
  func validDesc(value : Text) : Bool { value.size() <= 2000 };
  func nowMs() : Nat64 { Nat.toNat64(Int.abs(Time.now()) / 1_000_000) };

  // "YYYY-MM-DD" UTC calendar day for a millisecond timestamp — mirrors the
  // Postgres `date` type used by points_cooldowns.awarded_date.
  func dayKey(ms : Nat64) : Text {
    let days = ms / 86_400_000;
    Nat64.toText(days)
  };

  func isGovernor(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and governor.equal(caller)
  };
  func hasBulkAccess(caller : Principal) : Bool {
    not caller.equal(Principal.anonymous()) and bulkAccessPrincipals.any(func(p) = p.equal(caller))
  };
  func hasRole(caller : Principal, role : Text, club : Text) : Bool {
    roles.any(func(grant) { grant.user.equal(caller) and grant.role == role and grant.club_id == club })
  };
  // Club/team admins and coaches may award points and administer rewards —
  // mirrors the Supabase RLS "club admin/coach" write policies on
  // points_history, club_rewards and reward_redemptions.
  func isClubAdminOrCoach(caller : Principal, club_id : Text) : Bool {
    isGovernor(caller) or hasRole(caller, "club_admin", club_id) or hasRole(caller, "team_admin", club_id) or hasRole(caller, "coach", club_id)
  };
  // Any role grant scoped to the club counts as membership for read
  // visibility (leaderboards, reward catalog) — mirrors events_domain's
  // isClubMember member-visibility rule.
  func isClubMember(caller : Principal, club : Text) : Bool {
    isGovernor(caller) or roles.any(func(grant) = grant.user.equal(caller) and grant.club_id == club)
  };
  // PROVISIONAL: user subject ids are matched against the caller's principal
  // text, mirroring events_domain's my_rsvps account-id trust convention,
  // until user_id/child_id are bound to principals via identity_access.
  func isSelfUser(caller : Principal, user_id : Text) : Bool {
    Principal.toText(caller) == user_id
  };
  func canReadSubject(caller : Principal, club_id : Text, subject : Types.Subject) : Bool {
    if (isClubAdminOrCoach(caller, club_id)) return true;
    switch (subject) {
      case (#User(uid)) isSelfUser(caller, uid);
      // No parent/child principal link exists canister-side yet, so child
      // balances/history are admin/coach-only for now (provisional, like
      // events_domain's account-id trust note).
      case (#Child(_)) false;
    }
  };

  func findUserPoints(club_id : Text, user_id : Text) : Int32 {
    switch (userClubPoints.find(func(item) = item.club_id == club_id and item.user_id == user_id)) {
      case (?row) row.points;
      case null 0;
    }
  };
  func findChildPoints(club_id : Text, child_id : Text) : Int32 {
    switch (childClubPoints.find(func(item) = item.club_id == club_id and item.child_id == child_id)) {
      case (?row) row.points;
      case null 0;
    }
  };
  func setUserPoints(club_id : Text, user_id : Text, points : Int32) {
    userClubPoints := userClubPoints.filter(func(item) = not (item.club_id == club_id and item.user_id == user_id));
    userClubPoints := userClubPoints.concat([{ user_id; club_id; points; updated_at_ms = nowMs() }]);
  };
  func setChildPoints(club_id : Text, child_id : Text, points : Int32) {
    childClubPoints := childClubPoints.filter(func(item) = not (item.club_id == club_id and item.child_id == child_id));
    childClubPoints := childClubPoints.concat([{ child_id; club_id; points; updated_at_ms = nowMs() }]);
  };

  public shared ({ caller }) func initialize() : async { #Ok; #Err : Text } {
    auth(caller);
    if (not governor.equal(Principal.anonymous())) return #Err("Already initialized");
    governor := caller;
    #Ok
  };

  public shared ({ caller }) func transfer_governorship(new_governor : Principal) : async { #Ok; #Err : Text } {
    auth(caller);
    if (not isGovernor(caller)) return #Err("Only governor can transfer governorship");
    if (new_governor.equal(Principal.anonymous())) return #Err("New governor cannot be anonymous");
    governor := new_governor;
    #Ok
  };

  public shared ({ caller }) func grant_role(principal : Principal, role : Text, club_id : Text, team_id : ?Text) : async { #Ok; #Err : Text } {
    auth(caller); if (not isGovernor(caller)) return #Err("Governor only");
    if (principal.equal(Principal.anonymous()) or not valid(role) or not valid(club_id)) return #Err("Invalid role assignment");
    if (not roles.any(func(item) = item.user.equal(principal) and item.role == role and item.club_id == club_id and item.team_id == team_id)) {
      roles := roles.concat([{ user = principal; role; club_id; team_id }]);
    };
    #Ok
  };

  // ---------------------------------------------------------------------
  // Awarding
  // ---------------------------------------------------------------------

  // Awards (or, with a negative amount, manually adjusts) points for a
  // subject in a club. Positive awards are cooldown-checked when daily_cap
  // is supplied: mirrors the Supabase try_insert_points_cooldown RPC, which
  // sums today's points_cooldowns rows for (user_id, action_type, scope_id,
  // club_id) and rejects the award once the daily cap would be exceeded.
  // points_cooldowns has no child_id column, so cooldown enforcement only
  // applies to #User subjects — child awards are uncapped canister-side,
  // matching the real schema.
  public shared ({ caller }) func award_points(
    club_id : Text,
    subject : Types.Subject,
    action_type : Text,
    scope_id : Text,
    amount : Int32,
    description : Text,
    source_id : ?Text,
    season_id : ?Text,
    daily_cap : ?Nat32,
  ) : async { #Ok : Types.PointsHistoryEntry; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(action_type) or not valid(scope_id) or not validDesc(description) or amount == 0) return #Err("Invalid award");
    if (not isClubAdminOrCoach(caller, club_id)) return #Err("Club admin or coach required");
    let ts = nowMs();

    if (amount > 0) {
      switch (subject, daily_cap) {
        case (#User(user_id), ?cap) {
          let today = dayKey(ts);
          let already = cooldowns.filter(func(item) = item.user_id == user_id and item.club_id == club_id and item.action_type == action_type and item.scope_id == scope_id and item.awarded_date == today);
          var sum : Nat32 = 0;
          for (item in already.values()) { sum += item.points_awarded };
          let amountNat = Nat.toNat32(Int.abs(Int32.toInt(amount)));
          if (sum + amountNat > cap) return #Err("Cooldown limit reached");
          let id = "cd-" # club_id # "-" # Nat.toText(cooldowns.size());
          cooldowns := cooldowns.concat([{ id; user_id; club_id; action_type; scope_id; awarded_date = today; points_awarded = amountNat; created_at_ms = ts }]);
        };
        case (_, _) {};
      };
    };

    let (user_id, child_id, balance_after) = switch (subject) {
      case (#User(uid)) {
        let updated = findUserPoints(club_id, uid) + amount;
        setUserPoints(club_id, uid, updated);
        (?uid, null : ?Text, updated);
      };
      case (#Child(cid)) {
        let updated = findChildPoints(club_id, cid) + amount;
        setChildPoints(club_id, cid, updated);
        (null : ?Text, ?cid, updated);
      };
    };

    let entry : Types.PointsHistoryEntry = {
      id = "ph-" # club_id # "-" # Nat.toText(pointsHistory.size());
      club_id; user_id; child_id; amount; balance_after;
      source_type = action_type; source_id; description;
      created_at_ms = ts; created_by = ?caller; season_id;
    };
    pointsHistory := pointsHistory.concat([entry]);
    #Ok(entry)
  };

  // Like award_points, but rejects the award when a points_history entry
  // with the same (club, subject, source_type, scope_id) already exists —
  // the canister-side counterpart of the Supabase early_rsvp_points_awarded
  // optimistic lock. Atomic: the dedup check and the award happen in the
  // same update call.
  public shared ({ caller }) func award_points_once(
    club_id : Text,
    subject : Types.Subject,
    action_type : Text,
    scope_id : Text,
    amount : Int32,
    description : Text,
    source_id : ?Text,
    season_id : ?Text,
  ) : async { #Ok : Types.PointsHistoryEntry; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(action_type) or not valid(scope_id) or not validDesc(description) or amount == 0) return #Err("Invalid award");
    if (not isClubAdminOrCoach(caller, club_id)) return #Err("Club admin or coach required");
    let (uid, cid) = switch (subject) {
      case (#User(u)) (?u, null : ?Text);
      case (#Child(c)) (null : ?Text, ?c);
    };
    let already = pointsHistory.any(func(item) =
      item.club_id == club_id and item.user_id == uid and item.child_id == cid and
      item.source_type == action_type and item.source_id == ?scope_id
    );
    if (already) return #Err("Already awarded");
    await award_points(club_id, subject, action_type, scope_id, amount, description, source_id, season_id, null)
  };

  // Consecutive UTC days (ending today or yesterday) with an engagement
  // entry for the user — the canister-side counterpart of the Supabase
  // get_engagement_streak RPC. Engagement sources mirror the frontend's
  // ENGAGEMENT_SOURCE_TYPES set.
  public query ({ caller }) func get_engagement_streak(club_id : Text, user_id : Text) : async { #Ok : Nat32; #Err : Text } {
    if (not canReadSubject(caller, club_id, #User(user_id))) return #Err("Forbidden");
    var days : [Nat64] = [];
    for (item in pointsHistory.values()) {
      if (item.club_id == club_id and item.user_id == ?user_id and
          (item.source_type == "chat_engagement" or item.source_type == "photo_upload" or item.source_type == "photo_comment")) {
        let d = item.created_at_ms / 86_400_000;
        if (not days.any(func(x) = x == d)) { days := days.concat([d]) };
      };
    };
    var cursor = nowMs() / 86_400_000;
    if (not days.any(func(x) = x == cursor)) {
      if (cursor == 0) return #Ok(0);
      cursor -= 1;
    };
    var streak : Nat32 = 0;
    while (days.any(func(x) = x == cursor)) {
      streak += 1;
      if (cursor == 0) return #Ok(streak);
      cursor -= 1;
    };
    #Ok(streak)
  };

  // ---------------------------------------------------------------------
  // Club points settings
  // ---------------------------------------------------------------------

  // Any club member may read the points-module settings (the kill switch and
  // display name drive UI rendering for everyone) — mirrors the public
  // select policies on club_subscriptions/clubs.
  public query ({ caller }) func get_club_points_settings(club_id : Text) : async { #Ok : ?Types.ClubPointsSettings; #Err : Text } {
    if (not isClubMember(caller, club_id)) return #Err("Club membership required");
    #Ok(clubPointsSettings.find(func(item) = item.club_id == club_id))
  };

  public shared ({ caller }) func save_club_points_settings(club_id : Text, display_name : ?Text, disabled : Bool) : async { #Ok : Types.ClubPointsSettings; #Err : Text } {
    auth(caller);
    if (not valid(club_id)) return #Err("Invalid club");
    switch (display_name) { case (?n) { if (not valid(n)) return #Err("Invalid display name") }; case null {} };
    if (not isClubAdminOrCoach(caller, club_id)) return #Err("Club admin or coach required");
    let ts = nowMs();
    let row : Types.ClubPointsSettings = { club_id; display_name; disabled; updated_at_ms = ts };
    clubPointsSettings := clubPointsSettings.filter(func(item) = item.club_id != club_id).concat([row]);
    #Ok(row)
  };

  // ---------------------------------------------------------------------
  // Balances
  // ---------------------------------------------------------------------

  public query ({ caller }) func get_user_points(club_id : Text, user_id : Text) : async { #Ok : Int32; #Err : Text } {
    if (not canReadSubject(caller, club_id, #User(user_id))) return #Err("Forbidden");
    #Ok(findUserPoints(club_id, user_id))
  };

  public query ({ caller }) func get_child_points(club_id : Text, child_id : Text) : async { #Ok : Int32; #Err : Text } {
    if (not canReadSubject(caller, club_id, #Child(child_id))) return #Err("Forbidden");
    #Ok(findChildPoints(club_id, child_id))
  };

  // ---- Bulk lookups (useAllUserClubPoints / useChildrenClubPoints parity) ----
  // Cross-club and batched reads. Results are filtered per club through the
  // same canReadSubject rule as the single-row getters, so a caller only ever
  // sees balances they could already read one at a time — no new visibility.

  public query ({ caller }) func get_user_points_all_clubs(user_id : Text) : async { #Ok : [(Text, Int32)]; #Err : Text } {
    auth(caller);
    userClubPoints
      .filter(func(item) = item.user_id == user_id and canReadSubject(caller, item.club_id, #User(user_id)))
      .map(func(item) = (item.club_id, item.points))
  };

  public query ({ caller }) func get_child_points_all_clubs(child_id : Text) : async { #Ok : [(Text, Int32)]; #Err : Text } {
    auth(caller);
    childClubPoints
      .filter(func(item) = item.child_id == child_id and canReadSubject(caller, item.club_id, #Child(child_id)))
      .map(func(item) = (item.club_id, item.points))
  };

  public query ({ caller }) func get_child_points_batch(club_id : Text, child_ids : [Text]) : async { #Ok : [(Text, Int32)]; #Err : Text } {
    auth(caller);
    if (child_ids.size() > 500) return #Err("At most 500 child ids per batch");
    childClubPoints
      .filter(func(item) = item.club_id == club_id and child_ids.any(func(id) = id == item.child_id) and canReadSubject(caller, club_id, #Child(item.child_id)))
      .map(func(item) = (item.child_id, item.points))
  };

  // Window start (ms) for leaderboard queries — mirrors the Supabase
  // _leaderboard_window_start(_window) helper: "week" = trailing 7 days,
  // "month" = trailing 30 days, anything else (including "all_time") = 0
  // (no lower bound).
  func windowStartMs(window : Text, now : Nat64) : Nat64 {
    if (window == "week") { if (now > 604_800_000) now - 604_800_000 else 0 }
    else if (window == "month") { if (now > 2_592_000_000) now - 2_592_000_000 else 0 }
    else 0
  };

  public type LeaderboardEntry = { subject_id : Text; points : Int32 };

  // Sums points_history.amount within the window per subject and ranks
  // descending. Governor/leaderboard visibility mirrors isClubMember (any
  // role grant in the club); opted-out members are filtered by the caller
  // (profiles.leaderboard_opt_out has no canister-side mirror here).
  public query ({ caller }) func get_leaderboard(club_id : Text, subjectKind : { #User; #Child }, window : Text, top_n : Nat) : async { #Ok : [LeaderboardEntry]; #Err : Text } {
    if (not isClubMember(caller, club_id)) return #Err("Forbidden");
    let start = windowStartMs(window, nowMs());
    let relevant = pointsHistory.filter(func(item) = item.club_id == club_id and item.created_at_ms >= start);
    var ids : [Text] = [];
    var totals : [Int32] = [];
    for (item in relevant.values()) {
      let idOpt : ?Text = switch (subjectKind, item.user_id, item.child_id) {
        case (#User, ?uid, _) ?uid;
        case (#Child, _, ?cid) ?cid;
        case (_, _, _) null;
      };
      switch (idOpt) {
        case null {};
        case (?id) {
          switch (ids.findIndex(func(x) = x == id)) {
            case (?index) { totals := Array.tabulate<Int32>(totals.size(), func(i) = if (i == index) totals[i] + item.amount else totals[i]) };
            case null { ids := ids.concat([id]); totals := totals.concat([item.amount]) };
          };
        };
      };
    };
    var entries = Array.tabulate<LeaderboardEntry>(ids.size(), func(i) = { subject_id = ids[i]; points = totals[i] });
    entries := entries.sort(func(a, b) = Int32.compare(b.points, a.points));
    let limit = Nat.min(top_n, entries.size());
    #Ok(Array.tabulate<LeaderboardEntry>(limit, func(i) = entries[i]))
  };

  // ---------------------------------------------------------------------
  // History
  // ---------------------------------------------------------------------

  public type HistoryPage = { items : [Types.PointsHistoryEntry]; total : Nat };

  public query ({ caller }) func list_points_history(club_id : Text, subject : ?Types.Subject, offset : Nat, limit : Nat) : async { #Ok : HistoryPage; #Err : Text } {
    let allowed = switch (subject) {
      case (?s) canReadSubject(caller, club_id, s);
      case null isClubAdminOrCoach(caller, club_id);
    };
    if (not allowed) return #Err("Forbidden");
    let matches = pointsHistory.filter(func(item) =
      item.club_id == club_id and (
        switch (subject) {
          case null true;
          case (?(#User(uid))) item.user_id == ?uid;
          case (?(#Child(cid))) item.child_id == ?cid;
        }
      )
    );
    let sorted = matches.sort(func(a, b) = Nat64.compare(b.created_at_ms, a.created_at_ms));
    let total = sorted.size();
    if (offset >= total) return #Ok({ items = []; total });
    let count = Nat.min(limit, total - offset);
    #Ok({ items = Array.tabulate<Types.PointsHistoryEntry>(count, func(i) = sorted[offset + i]); total })
  };

  // ---------------------------------------------------------------------
  // Rewards (club_admin/governor administered; club members read)
  // ---------------------------------------------------------------------

  public shared ({ caller }) func create_reward(
    club_id : Text, name : Text, description : ?Text, points_required : Nat32,
    is_default : Bool, reward_type : Text, logo_url : ?Text, show_qr_code : Bool,
    sponsor_id : ?Text, team_id : ?Text,
  ) : async { #Ok : Types.ClubReward; #Err : Text } {
    auth(caller);
    if (not valid(club_id) or not valid(name) or not valid(reward_type)) return #Err("Invalid reward");
    if (not (isGovernor(caller) or hasRole(caller, "club_admin", club_id))) return #Err("Club admin required");
    let ts = nowMs();
    let reward : Types.ClubReward = {
      id = "rwd-" # club_id # "-" # Nat.toText(clubRewards.size());
      club_id; name; description; points_required; is_default; is_active = true;
      logo_url; reward_type; qr_code_url = null; show_qr_code; sponsor_id;
      created_at_ms = ts; updated_at_ms = ts; team_id;
    };
    clubRewards := clubRewards.concat([reward]);
    #Ok(reward)
  };

  public shared ({ caller }) func update_reward(
    id : Text, name : Text, description : ?Text, points_required : Nat32,
    is_default : Bool, is_active : Bool, reward_type : Text, logo_url : ?Text,
    qr_code_url : ?Text, show_qr_code : Bool, sponsor_id : ?Text, team_id : ?Text,
  ) : async { #Ok : Types.ClubReward; #Err : Text } {
    auth(caller);
    switch (clubRewards.find(func(item) = item.id == id)) {
      case null #Err("Reward not found");
      case (?current) {
        if (not (isGovernor(caller) or hasRole(caller, "club_admin", current.club_id))) return #Err("Club admin required");
        if (not valid(name) or not valid(reward_type)) return #Err("Invalid reward update");
        let updated : Types.ClubReward = { current with name; description; points_required; is_default; is_active; reward_type; logo_url; qr_code_url; show_qr_code; sponsor_id; team_id; updated_at_ms = nowMs() };
        clubRewards := clubRewards.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func delete_reward(id : Text) : async { #Ok; #Err : Text } {
    auth(caller);
    switch (clubRewards.find(func(item) = item.id == id)) {
      case null #Err("Reward not found");
      case (?current) {
        if (not (isGovernor(caller) or hasRole(caller, "club_admin", current.club_id))) return #Err("Club admin required");
        clubRewards := clubRewards.filter(func(item) = item.id != id);
        #Ok
      };
    }
  };

  public query ({ caller }) func list_rewards(club_id : Text, team_id : ?Text, active_only : Bool) : async { #Ok : [Types.ClubReward]; #Err : Text } {
    if (not isClubMember(caller, club_id)) return #Err("Forbidden");
    #Ok(clubRewards.filter(func(item) =
      item.club_id == club_id
        and (team_id == null or item.team_id == null or item.team_id == team_id)
        and (not active_only or item.is_active)
    ))
  };

  // ---------------------------------------------------------------------
  // Redemptions
  // ---------------------------------------------------------------------

  // Members redeem for themselves (#User subject bound to caller, provisional
  // principal-text match) or club admins/coaches redeem on behalf of a child
  // (no child principal link exists canister-side). Debits the balance
  // immediately and logs a negative points_history entry; status starts
  // "pending" pending admin verification (verified_by/verified_at/redeemed_at
  // mirror the Supabase columns).
  public shared ({ caller }) func redeem_reward(club_id : Text, subject : Types.Subject, reward_id : Text, idempotency_key : ?Text) : async { #Ok : Types.RewardRedemption; #Err : Text } {
    auth(caller);
    let selfOk = switch (subject) {
      case (#User(uid)) isSelfUser(caller, uid) or isClubAdminOrCoach(caller, club_id);
      case (#Child(_)) isClubAdminOrCoach(caller, club_id);
    };
    if (not selfOk) return #Err("Forbidden");
    switch (idempotency_key) {
      case (?key) {
        switch (redemptions.find(func(item) = item.club_id == club_id and item.idempotency_key == ?key)) {
          case (?existing) return #Ok(existing);
          case null {};
        };
      };
      case null {};
    };
    switch (clubRewards.find(func(item) = item.id == reward_id and item.club_id == club_id)) {
      case null #Err("Reward not found");
      case (?reward) {
        if (not reward.is_active) return #Err("Reward not active");
        let (user_id, child_id, balance) = switch (subject) {
          case (#User(uid)) (?uid, null : ?Text, findUserPoints(club_id, uid));
          case (#Child(cid)) (null : ?Text, ?cid, findChildPoints(club_id, cid));
        };
        let cost = Int32.fromNat32(reward.points_required);
        if (balance < cost) return #Err("Insufficient points");
        let ts = nowMs();
        let newBalance = balance - cost;
        switch (subject) {
          case (#User(uid)) setUserPoints(club_id, uid, newBalance);
          case (#Child(cid)) setChildPoints(club_id, cid, newBalance);
        };
        let historyEntry : Types.PointsHistoryEntry = {
          id = "ph-" # club_id # "-" # Nat.toText(pointsHistory.size());
          club_id; user_id; child_id; amount = -cost; balance_after = newBalance;
          source_type = "redemption"; source_id = ?reward_id; description = "Redeemed: " # reward.name;
          created_at_ms = ts; created_by = ?caller; season_id = null;
        };
        pointsHistory := pointsHistory.concat([historyEntry]);
        let redemption : Types.RewardRedemption = {
          id = "rdm-" # club_id # "-" # Nat.toText(redemptions.size());
          reward_id; club_id; user_id; child_id; points_spent = reward.points_required;
          status = "pending"; verified_by = null; verified_at_ms = null;
          created_at_ms = ts; redeemed_at_ms = null; idempotency_key;
        };
        redemptions := redemptions.concat([redemption]);
        #Ok(redemption)
      };
    }
  };

  func requireRedemptionAdmin(caller : Principal, id : Text) : { #Ok : Types.RewardRedemption; #Err : Text } {
    switch (redemptions.find(func(item) = item.id == id)) {
      case null #Err("Redemption not found");
      case (?current) { if (not isClubAdminOrCoach(caller, current.club_id)) #Err("Club admin or coach required") else #Ok(current) };
    }
  };

  public shared ({ caller }) func approve_redemption(id : Text) : async { #Ok : Types.RewardRedemption; #Err : Text } {
    auth(caller);
    switch (requireRedemptionAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        if (current.status != "pending") return #Err("Redemption not pending");
        let updated = { current with status = "approved"; verified_by = ?caller; verified_at_ms = ?nowMs() };
        redemptions := redemptions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public shared ({ caller }) func fulfill_redemption(id : Text) : async { #Ok : Types.RewardRedemption; #Err : Text } {
    auth(caller);
    switch (requireRedemptionAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        if (current.status != "pending" and current.status != "approved") return #Err("Redemption not fulfillable");
        let ts = nowMs();
        let updated = { current with status = "fulfilled"; verified_by = ?caller; verified_at_ms = ?ts; redeemed_at_ms = ?ts };
        redemptions := redemptions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  // Cancelling refunds the spent points back to the subject's balance and
  // logs a compensating positive points_history entry.
  public shared ({ caller }) func cancel_redemption(id : Text) : async { #Ok : Types.RewardRedemption; #Err : Text } {
    auth(caller);
    switch (requireRedemptionAdmin(caller, id)) {
      case (#Err(e)) #Err(e);
      case (#Ok(current)) {
        if (current.status == "cancelled" or current.status == "fulfilled") return #Err("Redemption cannot be cancelled");
        let refund = Int32.fromNat32(current.points_spent);
        let ts = nowMs();
        let newBalance = switch (current.user_id, current.child_id) {
          case (?uid, _) { let bal = findUserPoints(current.club_id, uid) + refund; setUserPoints(current.club_id, uid, bal); bal };
          case (_, ?cid) { let bal = findChildPoints(current.club_id, cid) + refund; setChildPoints(current.club_id, cid, bal); bal };
          case (_, _) (0 : Int32);
        };
        let historyEntry : Types.PointsHistoryEntry = {
          id = "ph-" # current.club_id # "-" # Nat.toText(pointsHistory.size());
          club_id = current.club_id; user_id = current.user_id; child_id = current.child_id;
          amount = refund; balance_after = newBalance; source_type = "redemption_refund"; source_id = ?current.reward_id;
          description = "Refund for cancelled redemption"; created_at_ms = ts; created_by = ?caller; season_id = null;
        };
        pointsHistory := pointsHistory.concat([historyEntry]);
        let updated = { current with status = "cancelled"; verified_by = ?caller; verified_at_ms = ?ts };
        redemptions := redemptions.map(func(item) = if (item.id == id) updated else item);
        #Ok(updated)
      };
    }
  };

  public query ({ caller }) func list_redemptions(club_id : Text, subject : ?Types.Subject) : async { #Ok : [Types.RewardRedemption]; #Err : Text } {
    let isAdmin = isClubAdminOrCoach(caller, club_id);
    switch (subject) {
      case null { if (not isAdmin) return #Err("Forbidden") };
      case (?s) { if (not isAdmin and not canReadSubject(caller, club_id, s)) return #Err("Forbidden") };
    };
    #Ok(redemptions.filter(func(item) =
      item.club_id == club_id and (
        switch (subject) {
          case null true;
          case (?(#User(uid))) item.user_id == ?uid;
          case (?(#Child(cid))) item.child_id == ?cid;
        }
      )
    ))
  };

  // ---------------------------------------------------------------------
  // Governance / export
  // ---------------------------------------------------------------------

  public shared ({ caller }) func addBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    if (principal.equal(Principal.anonymous())) return #Err("Invalid principal");
    if (not bulkAccessPrincipals.any(func(p) = p.equal(principal))) { bulkAccessPrincipals := bulkAccessPrincipals.concat([principal]) };
    #Ok
  };

  public shared ({ caller }) func removeBulkAccessPrincipal(principal : Principal) : async { #Ok; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    bulkAccessPrincipals := bulkAccessPrincipals.filter(func(p) = not p.equal(principal));
    #Ok
  };

  public query ({ caller }) func listBulkAccessPrincipals() : async { #Ok : [Principal]; #Err : Text } {
    if (not isGovernor(caller)) return #Err("Governor required");
    #Ok(bulkAccessPrincipals)
  };

  public query ({ caller }) func export_state() : async {
    #Ok : {
      schema : Nat32; governor : Principal; roles : [Types.RoleGrant];
      pointsHistory : [Types.PointsHistoryEntry]; userClubPoints : [Types.UserClubPoints];
      childClubPoints : [Types.ChildClubPoints]; clubRewards : [Types.ClubReward];
      redemptions : [Types.RewardRedemption]; cooldowns : [Types.PointsCooldown];
    };
    #Err : Text;
  } {
    if (not isGovernor(caller) and not hasBulkAccess(caller)) return #Err("Governor required");
    #Ok({ schema = 1; governor; roles; pointsHistory; userClubPoints; childClubPoints; clubRewards; redemptions; cooldowns })
  };
};
