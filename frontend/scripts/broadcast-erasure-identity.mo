// Disposable test authority only; never part of a deploy recipe.
import Principal "mo:core/Principal";
persistent actor class Authority(owner : Principal, alias : Principal) {
  public shared func read_principal_eligibility(subject : Principal) : async { #Ok : {subject : Principal; decision : {#Eligible; #Denied}; account_version : ?Nat64; denied_through_version : ?Nat64}; #Err : Text } {
    #Ok({subject;decision=#Eligible;account_version=?1;denied_through_version=null})
  };
  public shared func read_service_account(subject : Principal) : async { #Ok : {id : Text; principals : [Principal]; version : Nat64; status : {#Active; #Suspended}}; #Err : Text } {
    if (subject != owner and subject != alias) return #Err("Unknown subject");
    #Ok({id="test-account";principals=[owner,alias];version=1;status=#Active})
  };
}