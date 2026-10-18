module {
  public func migration(_ : {}) : { var deviceVersions : [{ user : Text; platform : Text; app_version : ?Text; build_number : ?Text }] } {
    { var deviceVersions = [] }
  };
};