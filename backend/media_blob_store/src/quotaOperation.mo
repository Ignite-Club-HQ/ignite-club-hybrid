import Principal "mo:core/Principal";
module {
  public type Operation = {
    owner : Principal; path : Text; club_id : Text; category : Text;
    bytes : Nat; cycle : Nat; created_at : Int;
    status : { #reserving; #uploading; #committing; #committed; #aborting; #aborted };
    result : ?{ path : Text; content_hash : Text; content_length : Nat64 };
  };
  public func canWrite(op : Operation) : Bool { op.status == #uploading };
  public func canAbort(op : Operation) : Bool {
    op.status == #reserving or op.status == #uploading or op.status == #aborting or op.status == #aborted
  };
}