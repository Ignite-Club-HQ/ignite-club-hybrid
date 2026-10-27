import Map "mo:core/Map";
module {
  type Authority = { #NoName; #Unresolved; #Existing : { sink : Principal; subject : Principal } };
  type Account = { account_id : Text; principals : [Principal]; account_version : Nat64; revision : Nat64; original_authority : Authority };
  type Intent = { id : Text; club : Text; user : Principal; account : ?Account; submitted : Bool };
  public func migration(_ : {}) : { var private_name_cleanup_rows : Map.Map<Text, Intent> } {
    { var private_name_cleanup_rows = Map.empty<Text, Intent>() }
  }
}