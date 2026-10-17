import Principal "mo:core/Principal";
import Erasure "../src/accountErasure";
let owner = Principal.fromText("aaaaa-aa");
let other = Principal.fromText("2vxsx-fae");
assert not Erasure.keepRole({ user = owner; role = "coach"; club = ?"club"; team = ?"team" }, [owner]);
assert not Erasure.keepRole({ user = owner; role = "app_admin"; club = null; team = null }, [owner]);
assert Erasure.keepRole({ user = other; role = "player"; club = ?"club"; team = ?"team" }, [owner]);