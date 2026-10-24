module {
  public type Receipt = { authority : Principal; queue : Principal; user : Principal; club : Text; competition : Text; teams : [Text]; officials : [Principal]; body : Text; key : Text; audience : [Text]; count : ?Nat16 };
}