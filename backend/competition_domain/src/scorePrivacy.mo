import Array "mo:core/Array";
import Types "types";
module {
  public type Setting = { competition_id : Text; division : ?Text; hide_scores : Bool };
  public func hidden(settings : [Setting], competition : Text, division : ?Text) : Bool {
    switch (settings.find(func(x) = x.competition_id == competition and x.division == division)) {
      case (?x) x.hide_scores;
      case null settings.any(func(x) = x.competition_id == competition and x.division == null and x.hide_scores);
    }
  };
  public func mask(game : Types.Match, hide : Bool) : Types.MatchRead {
    { game with home_score = if (hide) null else ?game.home_score; away_score = if (hide) null else ?game.away_score }
  };
}
