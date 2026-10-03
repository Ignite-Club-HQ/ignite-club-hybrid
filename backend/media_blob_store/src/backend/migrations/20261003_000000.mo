import Principal "mo:core/Principal";
module {
  type BlobRecord = {
    path : Text;
    mime : Text;
    owner : Principal;
    bytes : Blob;
    content_hash : Text;
  };
  type PendingUpload = {
    id : Text;
    path : Text;
    mime : Text;
    owner : Principal;
    total_size : Nat64;
    chunk_count : Nat32;
    chunks : [?Blob];
  };
  type OldActor = {
    var blobs : [BlobRecord];
    var pending_uploads : [PendingUpload];
    var next_upload_seq : Nat64;
  };
  type NewActor = {
    var blobs : [BlobRecord];
    var pending_uploads : [PendingUpload];
    var next_upload_seq : Nat64;
    var club_domain_canister : ?Principal;
  };
  // Adds the club_domain canister pointer (unset = owner/governor deletes only).
  public func migration(old : OldActor) : NewActor {
    {
      var blobs = old.blobs;
      var pending_uploads = old.pending_uploads;
      var next_upload_seq = old.next_upload_seq;
      var club_domain_canister = null;
    }
  };
};
