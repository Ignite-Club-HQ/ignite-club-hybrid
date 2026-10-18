import Oql "../../shared/Oql";
import Clubs "../src/oqlClubs";
import Types "../src/types";
let club : Types.ClubProfile = {
  id = "club-a"; name = "Alpha"; slug = "alpha"; sport = ?"football";
  is_active = true; deleted_at_ms = null; created_at_ms = 0; description = null;
  logo_url = null; primary_color = null; secondary_color = null;
  playhq_tenant = ?"private-tenant"; playhq_org_id = ?"private-link";
};
let request = Oql.parse("{\"entity\":\"clubs\"}", Clubs.entities);
let source : [Types.ClubProfile] = [club, { club with id = "club-b" }, { club with id = "deleted"; deleted_at_ms = ?1 }];
let result = Oql.run<Types.ClubProfile>(request, source,
  func(c) = c.id == "club-a" and c.deleted_at_ms == null, Clubs.clubRow);
assert result.rows == [[Oql.text("id", "club-a"), Oql.text("name", "Alpha"), Oql.text("slug", "alpha"), Oql.text("sport", "football"), Oql.boolean("is_active", true)]];
let count = Oql.parse("{\"entity\":\"clubs\",\"aggregate\":\"count\"}", Clubs.entities);
assert Oql.run<Types.ClubProfile>(count, source, func(_) = false, Clubs.clubRow).rows == [[Oql.integer("count", 0)]];
assert Clubs.entities[1].fields.size() == 6;
