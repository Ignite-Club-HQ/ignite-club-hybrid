import Nat "mo:core/Nat";
import Nat64 "mo:core/Nat64";
import Principal "mo:core/Principal";
module {
  type BlobRecord = {
    path : Text;
    mime : Text;
    owner : Principal;
    bytes : Blob;
    content_hash : Text;
  };
  type OldActor = {
    var blobs : [BlobRecord];
  };
  type NewActor = {
    var blobs : [BlobRecord];
    var total_bytes : Nat64;
    var capacity_limit_bytes : Nat64;
  };
  // Photo-store sharding: a running byte counter (seeded from the existing
  // blobs) and a capacity limit. begin_upload refuses new uploads with
  // "StoreFull" once the store passes 80% of the limit; the app then uploads
  // to the next store. Default limit 40 GiB (governor can change it).
  public func migration(old : OldActor) : NewActor {
    var sum : Nat = 0;
    for (record in old.blobs.values()) { sum += record.bytes.size() };
    {
      var blobs = old.blobs;
      var total_bytes = Nat.toNat64(sum);
      var capacity_limit_bytes = 42_949_672_960;
    }
  };
};
