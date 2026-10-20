import Privacy "../src/scorePrivacy";
let settings : [Privacy.Setting] = [
  { competition_id = "c"; division = null; hide_scores = true },
  { competition_id = "c"; division = ?"show"; hide_scores = false },
  { competition_id = "open"; division = ?"hide"; hide_scores = true }
];
assert Privacy.hidden(settings, "c", null);
assert Privacy.hidden(settings, "c", ?"inherit");
assert not Privacy.hidden(settings, "c", ?"show");
assert Privacy.hidden(settings, "open", ?"hide");
assert not Privacy.hidden(settings, "open", null);
let game = { id = "m"; competition_id = "c"; home_team = "h"; away_team = "a"; status = "completed"; home_score = 3 : Nat16; away_score = 1 : Nat16; division_id = null; scheduled_at_ms = null; venue = null; pitch_number = null; round_number = null; duration_minutes = null; arrival_minutes_before = null; notes = null; revision = 1 : Nat64 };
assert Privacy.mask(game, false).home_score == ?3; // manager
assert Privacy.mask(game, true).home_score == null; // member
assert Privacy.mask(game, true).away_score == null; // anonymous
