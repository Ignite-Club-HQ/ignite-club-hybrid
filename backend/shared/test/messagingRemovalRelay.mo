import Principal "mo:core/Principal";
import RemovalReceiver "../RemovalReceiver";
import AccountAdmission "../AccountAdmission";
import Nat16 "mo:core/Nat16";

// Test-only authority: always Eligible, observed held membership replies.
// Its relay methods exercise receiver authentication through real canister calls.
persistent actor MessagingRemovalRelay {
  var calls : Nat = 0;
  var holdAt : Nat = 0;
  var released : Bool = true;
  var notificationHeld : Bool = false;
  var notificationCalls : Nat = 0;
  var holdAdmission : Bool = false;
  var admissionCalls : Nat = 0;
  public shared func hold_admission() : async () { admissionCalls := 0; holdAdmission := true };
  public shared func release_admission() : async () { holdAdmission := false };
  public query func admission_progress() : async (Nat, Bool) { (admissionCalls, holdAdmission) };
  public shared func hold_notifications() : async () { notificationCalls := 0; notificationHeld := true };
  public shared func release_notifications() : async () { notificationHeld := false };
  public query func notification_progress() : async (Nat, Bool) { (notificationCalls, notificationHeld) };
  public shared func record_chat_notify_batch(_message : Text, _conversation : Text, _sender : Text, _preview : Text, recipients : [Text], _muted : [Text]) : async { #Ok : Nat16; #Err : Text } {
    notificationCalls += 1;
    while (notificationHeld) { await MessagingRemovalRelay.pulse() };
    #Ok(Nat16.fromNat(recipients.size()))
  };
  public shared func hold_on(n : Nat) : async () { calls := 0; holdAt := n; released := false };
  public shared func release() : async () { released := true };
  public query func progress() : async (Nat, Bool) { (calls, released) };
  public shared func pulse() : async () {};
  public shared func read_principal_eligibility(subject : Principal) : async { #Ok : AccountAdmission.Evidence; #Err : Text } {
    admissionCalls += 1;
    while (holdAdmission) { await MessagingRemovalRelay.pulse() };
    #Ok({ subject; decision = #Eligible; account_version = ?1; denied_through_version = null })
  };
  public shared func read_has_club_membership(_subject : Principal, _club : Text) : async Bool {
    calls += 1;
    if (calls == holdAt) { while (not released) { await MessagingRemovalRelay.pulse() } };
    true
  };
  public shared func prepare(target : Principal, request : RemovalReceiver.Request) : async { #Ok; #Err : Text } {
    let receiver : actor { prepare_account_removal : shared (RemovalReceiver.Request) -> async { #Ok; #Err : Text } } = actor(target.toText());
    await receiver.prepare_account_removal(request)
  };
  public shared func drain(target : Principal, request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    let receiver : actor { read_account_removal_drain : shared (RemovalReceiver.Request) -> async { #Ok : RemovalReceiver.Receipt; #Err : Text } } = actor(target.toText());
    await receiver.read_account_removal_drain(request)
  };
  public shared func seal(target : Principal, request : RemovalReceiver.Request) : async { #Ok : RemovalReceiver.Receipt; #Err : Text } {
    let receiver : actor { seal_account_removal : shared (RemovalReceiver.Request) -> async { #Ok : RemovalReceiver.Receipt; #Err : Text } } = actor(target.toText());
    await receiver.seal_account_removal(request)
  };
}