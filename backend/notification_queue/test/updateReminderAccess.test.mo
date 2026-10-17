import Principal "mo:core/Principal";
import Access "../src/updateReminderAccess";

let admin = Principal.fromText("aaaaa-aa");
let member = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let anonymous = Principal.anonymous();
assert Access.protectedKind("update_reminder");
assert Access.protectedKind("update_reminder_test");
assert not Access.protectedKind("schedule_refresh");

let run = async {
  var memberChecks = 0;
  func adminCheck(p : Principal) : async Bool { p == admin };
  func memberCheck(p : Principal, club : Text) : async Bool {
    memberChecks += 1;
    p == member and club == "club-1"
  };
  assert (await Access.authorize(member, [Principal.toText(member)], "club-1", adminCheck, memberCheck)) == #Err("App admin required");
  assert memberChecks == 0;
  assert (await Access.authorize(anonymous, [Principal.toText(member)], "club-1", adminCheck, memberCheck)) == #Err("App admin required");
  assert (await Access.authorize(admin, [Principal.toText(member)], "club-1", adminCheck, memberCheck)) == #Ok;
  assert (await Access.authorize(admin, [Principal.toText(member)], "club-2", adminCheck, memberCheck)) == #Err("Recipient is not in the reminder club");
  assert (await Access.authorize(admin, [Principal.toText(member), Principal.toText(admin)], "club-1", adminCheck, memberCheck)) == #Err("Recipient is not in the reminder club");
  assert (await Access.authorize(admin, [Principal.toText(anonymous)], "club-1", adminCheck, memberCheck)) == #Err("Invalid recipient");
  func denied(_ : Principal) : async Bool { false };
  assert (await Access.authorize(admin, [Principal.toText(member)], "club-1", denied, memberCheck)) == #Err("App admin required");
};