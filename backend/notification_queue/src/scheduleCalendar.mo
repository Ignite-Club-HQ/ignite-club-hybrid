import Nat64 "mo:core/Nat64";
import Types "types";

module {
  let dayMs : Nat = 86_400_000;
  func leap(year : Nat) : Bool {
    year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)
  };
  func daysInMonth(year : Nat, month : Nat) : Nat {
    if (month == 2) { if (leap(year)) { 29 } else { 28 } }
    else if (month == 4 or month == 6 or month == 9 or month == 11) { 30 }
    else { 31 }
  };
  // UTC calendar arithmetic, clamping to the target month's end.
  public func addMonth(slot : Nat64) : Nat64 {
    let ms = Nat64.toNat(slot);
    var days = ms / dayMs;
    let cycles = days / 146_097;
    days %= 146_097;
    var year = 1970 + cycles * 400;
    var yearDays = if (leap(year)) { 366 } else { 365 };
    while (days >= yearDays) {
      days -= yearDays;
      year += 1;
      yearDays := if (leap(year)) { 366 } else { 365 };
    };
    var month = 1;
    while (days >= daysInMonth(year, month)) {
      days -= daysInMonth(year, month);
      month += 1;
    };
    let nextYear = if (month == 12) { year + 1 } else { year };
    let nextMonth = if (month == 12) { 1 } else { month + 1 };
    let maxDay = daysInMonth(nextYear, nextMonth);
    let targetDay = if (days + 1 > maxDay) { maxDay } else { days + 1 };
    let elapsed = daysInMonth(year, month) - days + targetDay - 1;
    Nat64.fromNat((ms / dayMs + elapsed) * dayMs + ms % dayMs)
  };
  public func next(slot : Nat64, recurrence : Types.Recurrence, now : Nat64, until : ?Nat64) : ?Nat64 {
    let candidate = switch (recurrence) {
      case (#None) { return null };
      case (#Daily or #Weekly) {
        let step : Nat64 = if (recurrence == #Daily) { 86_400_000 } else { 604_800_000 };
        let count : Nat64 = if (now >= slot) { (now - slot) / step + 1 } else { 1 };
        slot + count * step
      };
      case (#Monthly) {
        var value = addMonth(slot);
        while (value <= now) { value := addMonth(value) };
        value
      };
    };
    switch (until) {
      case (?end) { if (candidate > end) { null } else { ?candidate } };
      case null { ?candidate };
    }
  };
}