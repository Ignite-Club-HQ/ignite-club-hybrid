// Wire round-trip coverage; operator actor integration remains separate.
import Snapshot "../src/clubSnapshot";
import Privacy "../src/scorePrivacy";
import Types "../src/types";
persistent actor {
public func runTests() : async () {
let c : Types.Competition = { id = "c"; club_id = "club"; name = "Cup"; season = "2026"; status = "open"; description = null; visibility = "public"; points_win = 3; points_draw = 1; points_loss = 0; revision = 1 };
let older = { competitions = [c]; roles = [] : [Types.RoleGrant]; entries = [] : [Types.TeamEntry]; tokens = [] : [Types.JoinToken]; seasons = [] : [Types.Season]; matches = [] : [Types.Match]; chat_settings = []; welcome = []; invites = []; join_links = []; official_invites = []; welcome_jobs = []; eoi = []; divisions = []; ladders = []; broadcasts = []; owners = []; role_links = []; official_chats = [] };
let legacy : ?Snapshot.FenceSnapshot = from_candid(to_candid(older));
let decoded = switch (legacy) { case (?s) s; case null { assert false; loop {} } };
assert decoded.score_privacy == null;
assert not Privacy.hidden(decoded.score_privacy ?? [], "c", null);
let rows : [Privacy.Setting] = [{ competition_id = "c"; division = null; hide_scores = true }, { competition_id = "c"; division = ?"show"; hide_scores = false }];
let exported : Snapshot.FenceSnapshot = { decoded with score_privacy = ?rows };
let imported : ?Snapshot.FenceSnapshot = from_candid(to_candid(exported));
assert imported == ?exported;
assert Privacy.hidden(rows, "c", ?"inherit");
assert not Privacy.hidden(rows, "c", ?"show");

};
};
