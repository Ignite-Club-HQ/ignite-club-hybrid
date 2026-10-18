// Adds per-club home-country recording (jurisdiction routing metadata),
// mirroring the Supabase clubs.home_country column. Stored as a separate
// map so the ClubProfile record — and every migration that mentions it —
// stays untouched. Empty at first; the creator's country is recorded by
// set_club_home_country right after create_club, and the governor can
// backfill existing clubs.
module {
  public func migration(_ : {}) : {
    var clubHomeCountries : [(Text, Text)];
  } {
    {
      var clubHomeCountries = [];
    }
  };
};
