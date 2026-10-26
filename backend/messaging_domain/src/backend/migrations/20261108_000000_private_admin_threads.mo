import Principal "mo:core/Principal";
module {
  public func migration(_ : {}) : { var privateAdminThreads : [{ conversation : Text; competition : Text; member : Principal }] } {
    { var privateAdminThreads : [{ conversation : Text; competition : Text; member : Principal }] = [] }
  };
};