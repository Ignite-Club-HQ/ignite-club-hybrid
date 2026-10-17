import Array "mo:core/Array";
import Text "mo:core/Text";

module {
  public type Settings = { competition_id : Text; enabled : Bool; subject : Text; message : Text };
  public type Result = { #Ok : Settings; #Err : Text };

  public func read(rows : [Settings], competition_id : Text, exists : Bool, allowed : Bool) : Result {
    if (not exists) return #Err("Competition not found");
    if (not allowed) return #Err("Competition management forbidden");
    switch (rows.find(func(row) = row.competition_id == competition_id)) {
      case (?row) #Ok(row);
      case null #Ok({ competition_id; enabled = false; subject = "Welcome to {{competitionName}}"; message = "We're glad you're here." });
    }
  };

  public func write(rows : [Settings], settings : Settings, exists : Bool, allowed : Bool) : { #Ok : [Settings]; #Err : Text } {
    if (not exists) return #Err("Competition not found");
    if (not allowed) return #Err("Competition management forbidden");
    if (Text.trim(settings.subject, #predicate(func(c) = c == ' ' or c == '\n' or c == '\r' or c == '\t')) == "" or settings.subject.size() > 160) return #Err("Subject must contain 1–160 characters");
    if (settings.message.size() > 4000) return #Err("Message cannot exceed 4000 characters");
    #Ok(rows.filter(func(row) = row.competition_id != settings.competition_id).concat([settings]))
  };
}