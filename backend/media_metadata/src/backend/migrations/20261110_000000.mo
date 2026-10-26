module {
  // Photo albums: named groupings referenced by Asset.album_id, preserving
  // Supabase photo_albums metadata (title/cover) across migration.
  type Album = { id : Text; club_id : Text; title : Text; cover_asset_id : ?Text; created_by : Principal; created_at_ms : Nat64 };
  public func migration(_ : {}) : { var albums : [Album] } {
    { var albums = [] }
  };
}
