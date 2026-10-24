module {
  public type Input = { competition_id : Text; home_team : Text; away_team : Text; division_id : ?Text; scheduled_at_ms : ?Nat64; venue : ?Text; pitch_number : ?Text; round_number : ?Nat16; duration_minutes : ?Nat16; arrival_minutes_before : ?Nat16; notes : ?Text };
  public type Receipt = { creator : Principal; input : Input; match_id : Text };
}