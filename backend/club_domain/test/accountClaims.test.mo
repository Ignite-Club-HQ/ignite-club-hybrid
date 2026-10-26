import AccountClaims "../src/accountClaims";
import Map "mo:core/Map";
import Principal "mo:core/Principal";
import Debug "mo:core/Debug";

let claims = Map.empty<Text, AccountClaims.Claim>();
let byP = Map.empty<Text, Text>();
let tokA = "1111111111111111111111111111111111111111111111111111111111111111";
let tokB = "2222222222222222222222222222222222222222222222222222222222222222";
let alice = Principal.fromText("2ibo7-dia");
let bob = Principal.fromText("w7x7r-cok77-xa");
assert AccountClaims.register(claims, "c1", [
  { token_hash = AccountClaims.hashToken(tokA); source_user = "uA"; email_hint = "a***@x"; expires_ms = 1000 },
  { token_hash = AccountClaims.hashToken(tokB); source_user = "uB"; email_hint = "b***@x"; expires_ms = 1000 }]) == #Ok(2);
// raw tokens are rejected as hashes
assert AccountClaims.register(claims, "c1", [{ token_hash = "zz"; source_user = "u"; email_hint = ""; expires_ms = 1 }]) != #Ok(0);
// anonymous callers cannot redeem
assert AccountClaims.redeem(claims, byP, Principal.anonymous(), tokA, 10) != #Ok({ club_id = "c1" });
// first redeem binds; repeat by same caller is fine; another caller is refused
assert AccountClaims.redeem(claims, byP, alice, tokA, 10) == #Ok({ club_id = "c1" });
assert AccountClaims.redeem(claims, byP, alice, tokA, 20) == #Ok({ club_id = "c1" });
assert AccountClaims.redeem(claims, byP, bob, tokA, 20) == #Err("This link has already been used");
// one principal cannot take two accounts in the same club
assert AccountClaims.redeem(claims, byP, alice, tokB, 20) == #Err("This Internet Identity is already linked to another account in this club");
// expired links refuse
assert AccountClaims.redeem(claims, byP, bob, tokB, 5000) == #Err("This link has expired; ask your club for a new one");
assert AccountClaims.claimed(claims, "c1", 0, 10).size() == 1;
assert AccountClaims.claimed(claims, "other", 0, 10).size() == 0;
// erasure forgets the binding
AccountClaims.erase(claims, byP, [alice]);
assert AccountClaims.claimed(claims, "c1", 0, 10).size() == 0;
Debug.print("account claim checks passed");
