import Board "../src/boardSync";
import Types "../src/types";
import Principal "mo:core/Principal";
let row : Types.ActiveGame = { id = "board-t"; user_id = Principal.fromText("aaaaa-aa"); team_id = ?"t"; timer_state_json = "clock"; pitch_state_json = "pitch"; board_session_id = "device"; is_active = true; updated_at_ms = 9 };
assert Board.matches(?row, ?9);
assert not Board.matches(?row, ?8);
assert not Board.matches(?row, null);
assert Board.matches(null, null);
assert not Board.matches(null, ?9);
assert Board.nextRevision(?row, 9) == 10;
assert Board.nextRevision(?row, 8) == 10;
assert Board.nextRevision(?row, 12) == 12;
let duties : [Types.EventGroupDuty] = [
  { id = "1"; group_id = "g"; duty = "Referee"; account_id = ?"ref" },
  { id = "2"; group_id = "g"; duty = "Subs Manager"; account_id = ?"subs" },
  { id = "3"; group_id = "g"; duty = "Referee"; account_id = ?"ref" },
  { id = "4"; group_id = "other"; duty = "Referee"; account_id = ?"foreign" },
  { id = "5"; group_id = "g"; duty = "Fruit"; account_id = ?"fruit" },
  { id = "6"; group_id = "g"; duty = "Subs Manager"; account_id = null }
];
assert Board.dutyRecipients(duties, "g") == ["ref", "subs"];
assert Board.dutyRecipients(duties, "missing") == [];