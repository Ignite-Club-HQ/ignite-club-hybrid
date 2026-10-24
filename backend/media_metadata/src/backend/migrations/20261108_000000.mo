import Array "mo:core/Array";
import Map "mo:core/Map";
module {
  type OldComment = { id : Text; asset_id : Text; author : Principal; body : Text; created_at_ms : Nat64; deleted : Bool };
  type Comment = { id : Text; asset_id : Text; author : Principal; body : Text; created_at_ms : Nat64; deleted : Bool; reply_to_id : ?Text };
  public func migration(old : { var comments : [OldComment] }) : {
    var comments : [Comment]; var galleryClubAuthority : ?Principal; var galleryVaultAuthority : ?Principal;
    var galleryNoticeAttempts : Map.Map<Text, Text>; var hiddenGalleryAssets : Map.Map<Text, Bool>;
  } {
    { var comments = old.comments.map(func c = { c with reply_to_id = null });
      var galleryClubAuthority = null; var galleryVaultAuthority = null;
      var galleryNoticeAttempts = Map.empty<Text, Text>(); var hiddenGalleryAssets = Map.empty<Text, Bool>() }
  }
}
