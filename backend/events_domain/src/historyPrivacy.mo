import Types "types";
module {
  public type Read = {
    id : Text; team_id : Text; event_id : ?Text; sport : Text;
    home_label : Text; away_label : Text; home_score : ?Nat32; away_score : ?Nat32;
    period_scores_json : Text; player_stats_json : Text; mvp_player_id : ?Text;
    mvp_player_name : ?Text; saved_by : Principal; updated_at_ms : Nat64; scores_hidden : Bool;
  };
  // Opaque scoring JSON cannot be safely partially parsed here. Keep it stored,
  // but omit it on masked reads instead of leaking totals through individual points.
  public func read(row : Types.GameResult, hidden : Bool) : Read {
    { row with home_score = if (hidden) null else ?row.home_score;
      away_score = if (hidden) null else ?row.away_score;
      period_scores_json = if (hidden) "[]" else row.period_scores_json;
      player_stats_json = if (hidden) "[]" else row.player_stats_json;
      scores_hidden = hidden }
  };
}