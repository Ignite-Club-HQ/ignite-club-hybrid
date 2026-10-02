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
  type OldActor = {};
  type NewActor = {
    var blobs : [BlobRecord];
    var pending_uploads : [PendingUpload];
    var next_upload_seq : Nat64;
  };
  // Initial bootstrap: seeds empty state.
  public func migration(_old : OldActor) : NewActor {
    {
      var blobs = [];
      var pending_uploads = [];
      var next_upload_seq = 0;
    }
  };
};
