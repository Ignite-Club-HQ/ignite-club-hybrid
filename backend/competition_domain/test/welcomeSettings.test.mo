import Array "mo:core/Array";
import Welcome "../src/welcomeSettings";

let row : Welcome.Settings = { competition_id = "competition-1"; enabled = true; subject = "Welcome!"; message = "See you on the pitch." };
assert Welcome.read([], "competition-1", true, true) == #Ok({ competition_id = "competition-1"; enabled = false; subject = "Welcome to {{competitionName}}"; message = "We're glad you're here." });
assert Welcome.read([row], row.competition_id, true, false) == #Err("Competition management forbidden");
assert Welcome.write([], row, true, false) == #Err("Competition management forbidden");
assert Welcome.write([], row, false, true) == #Err("Competition not found");
switch (Welcome.write([], row, true, true)) {
  case (#Ok(rows)) {
    assert Welcome.read(rows, row.competition_id, true, true) == #Ok(row);
    let changed = { row with enabled = false; message = "Changed" };
    assert Welcome.write(rows, changed, true, true) == #Ok([changed]);
  };
  case (#Err(_)) assert false;
};
assert Welcome.write([], { row with subject = " \n\t" }, true, true) == #Err("Subject must contain 1–160 characters");
func repeat(n : Nat) : Text { var value = ""; for (_ in Array.tabulate<Nat>(n, func(i) = i).values()) { value #= "a" }; value };
assert Welcome.write([], { row with subject = repeat(160) }, true, true) == #Ok([{ row with subject = repeat(160) }]);
assert Welcome.write([], { row with subject = repeat(161) }, true, true) == #Err("Subject must contain 1–160 characters");
assert Welcome.write([], { row with message = repeat(4000) }, true, true) == #Ok([{ row with message = repeat(4000) }]);
assert Welcome.write([], { row with message = repeat(4001) }, true, true) == #Err("Message cannot exceed 4000 characters");