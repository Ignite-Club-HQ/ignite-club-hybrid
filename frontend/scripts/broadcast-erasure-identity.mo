// Disposable test authority only; never part of a deploy recipe.
import Principal "mo:core/Principal";
persistent actor class Authority(owner : Principal, alias : Principal) {
  public shared func read_service_account(subject : Principal) : async { #Ok : {id : Text; principals : [Principal]; version : Nat64; status : {#Active; #Suspended}}; #Err : Text } {
    if (subject != owner and subject != alias) return #Err("Unknown subject");
    #Ok({id="test-account";principals=[owner,alias];version=1;status=#Active})
  };
}