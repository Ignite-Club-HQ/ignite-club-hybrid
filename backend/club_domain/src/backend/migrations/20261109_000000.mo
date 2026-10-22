module {
  public func migration(_ : {}) : {
    var membershipDirectorySource : {
      var binding : ?{
        identity : Principal; router : Principal; group : Text; deployment : Text;
        generation : Nat64; inventory_digest : Blob;
      };
      var enabled : Bool;
    };
  } {
    { var membershipDirectorySource = { var binding = null; var enabled = false } }
  }
}