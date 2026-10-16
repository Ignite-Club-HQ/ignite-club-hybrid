module {
  // Club -> association links (parity with Supabase clubs.parent_org_id).
  // Each pair is (club_id, association_club_id); a club has at most one.
  public func migration(_ : {}) : {
    var clubParentOrgs : [(Text, Text)];
  } {
    { var clubParentOrgs = [] }
  };
};
