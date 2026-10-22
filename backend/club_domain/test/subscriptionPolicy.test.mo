import Policy "../src/subscriptionPolicy";
import Types "../src/types";
let base : Types.ClubSubscription = {
  club_id = "club"; is_pro = true; is_pro_football = false; admin_pro_override = false;
  admin_pro_football_override = false; expires_at_ms = ?200; plan = "standard";
  team_limit = ?20; trial_ends_at_ms = null; is_trial = false; cancelled_at_ms = null; activated_at_ms = null;
};
assert Policy.limit(null, 100) == 20;
assert Policy.limit(?base, 100) == 20;
assert Policy.limit(?{ base with team_limit = ?21 }, 100) == 21;
assert Policy.limit(?{ base with team_limit = ?21 }, 200) == 20;
assert Policy.limit(?{ base with is_pro = false; is_trial = true; trial_ends_at_ms = ?200; team_limit = ?21 }, 100) == 20;
assert Policy.limit(?{ base with team_limit = ?3 }, 100) == 3;
assert Policy.limit(?{ base with team_limit = ?5 }, 100) == 5;