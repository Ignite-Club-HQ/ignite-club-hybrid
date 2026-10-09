// Adds competition / mini-league targeting for news posts, mirroring the
// Supabase club_news.target_competition_id / target_mini_league_id columns.
// Stored as a separate (post_id, kind, target_id) list so the NewsPost
// record — and every migration mentioning it — stays untouched.
module {
  public func migration(_ : {}) : {
    var newsTargets : [(Text, Text, Text)];
  } {
    {
      var newsTargets = [];
    }
  };
};
