import Oql "../../shared/Oql";
import Types "types";
module {
  public let entities : [Oql.Entity] = [
    { name = "clubs"; fields = [
      { name = "id"; kind = "text" }, { name = "name"; kind = "text" },
      { name = "slug"; kind = "text" }, { name = "sport"; kind = "text" }, { name = "is_active"; kind = "bool" }
    ] },
    { name = "teams"; fields = [
      { name = "id"; kind = "text" }, { name = "club_id"; kind = "text" }, { name = "name"; kind = "text" },
      { name = "division"; kind = "text" }, { name = "age_group"; kind = "text" }, { name = "is_active"; kind = "bool" }
    ] }
  ];
  public func clubRow(club : Types.ClubProfile) : Oql.Row {
    [Oql.text("id", club.id), Oql.text("name", club.name), Oql.text("slug", club.slug),
     Oql.optional("sport", club.sport), Oql.boolean("is_active", club.is_active)]
  };
  public func teamRow(team : Types.ClubTeam) : Oql.Row {
    [Oql.text("id", team.id), Oql.text("club_id", team.club_id), Oql.text("name", team.name),
     Oql.optional("division", team.division), Oql.optional("age_group", team.age_group), Oql.boolean("is_active", team.is_active)]
  };
}
