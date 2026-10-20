import Types "types";
import Json "mo:json";
import Array "mo:core/Array";
module {
  public type Read = {
    id : Text; team_id : Text; event_id : ?Text; sport : Text;
    home_label : Text; away_label : Text; home_score : ?Nat32; away_score : ?Nat32;
    period_scores_json : Text; player_stats_json : Text; mvp_player_id : ?Text;
    mvp_player_name : ?Text; saved_by : Principal; updated_at_ms : Nat64; scores_hidden : Bool;
  };
  // Preserve player identity/time/position/discipline/MVP metadata only. All
  // other keys are omitted, since sport-specific scoring can reconstruct totals.
  public func players(raw : Text) : Text {
    switch (Json.parse(raw)) {
      case (#err(_)) "[]";
      case (#ok(#array(rows))) {
        let safe = rows.map(func(row : Json.Json) : Json.Json {
          switch (row) {
            case (#object_(fields)) #object_(fields.filter(func(field : (Text, Json.Json)) : Bool {
              let (key,value) = field;
              let allowed = key == "id" or key == "name" or key == "secondsPlayed" or key == "finalPosition" or
                key == "fouls" or key == "isFouledOut" or key == "isInjured" or key == "yellow" or key == "red" or key == "award";
              allowed and (switch (value) { case (#array(_)) false; case (#object_(_)) false; case _ true })
            }));
            case _ #null_
          }
        });
        Json.stringify(#array(safe),null)
      };
      case _ "[]"
    }
  };
  public func read(row : Types.GameResult, hidden : Bool) : Read {
    { row with home_score = if (hidden) null else ?row.home_score;
      away_score = if (hidden) null else ?row.away_score;
      period_scores_json = if (hidden) "[]" else row.period_scores_json;
      player_stats_json = if (hidden) players(row.player_stats_json) else row.player_stats_json;
      scores_hidden = hidden }
  };
}