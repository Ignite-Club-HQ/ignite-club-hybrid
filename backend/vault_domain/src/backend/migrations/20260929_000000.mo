import Principal "mo:core/Principal";
module {
  type OldActor = {};
  type NewActor = {
    var governor : Principal;
    var folders : [{
      id : Text;
      club : Text;
      team : ?Text;
      parent_id : ?Text;
      name : Text;
      restricted_roles : [Text];
      created_by : Principal;
      created_at_ms : Nat64;
      deleted_at_ms : ?Nat64;
    }];
    var files : [{
      id : Text;
      folder_id : Text;
      club : Text;
      team : ?Text;
      name : Text;
      file_url : Text;
      size : Nat64;
      mime : Text;
      uploaded_by : Principal;
      created_at_ms : Nat64;
      deleted_at_ms : ?Nat64;
      is_external_link : Bool;
      blob_ref : ?{ canister : Text; path : Text; content_hash : Text };
    }];
    var roles : [{
      user : Principal;
      role : Text;
      club_id : ?Text;
      team_id : ?Text;
    }];
  };
  public func run(old : OldActor) : NewActor {
    {
      var governor = Principal.anonymous();
      var folders = [];
      var files = [];
      var roles = [];
    }
  };
};
