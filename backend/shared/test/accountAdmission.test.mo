import Principal "mo:core/Principal";
import Admission "../AccountAdmission";
let subject = Principal.fromText("rrkah-fqaaa-aaaaa-aaaaq-cai");
let other = Principal.fromText("ryjl3-tyaaa-aaaaa-aaaba-cai");
let good : Admission.Evidence = { subject; decision = #Eligible; account_version = ?4; denied_through_version = null };
assert Admission.matches(subject, good);
assert not Admission.matches(other, good);
assert not Admission.matches(subject, { good with decision = #Denied });
assert not Admission.matches(subject, { good with account_version = null });
assert not Admission.matches(Principal.anonymous(), { good with subject = Principal.anonymous() });
let account : Admission.Account = { id = "account"; principals = [subject]; version = 4; status = #Active };
assert Admission.owns(subject, account);
assert not Admission.owns(other, account);
assert not Admission.owns(subject, { account with status = #Suspended });
let run = async {
  assert not (await Admission.Gate(true, null).eligible(subject));
  assert (await Admission.Gate(false, null).eligible(subject));
};