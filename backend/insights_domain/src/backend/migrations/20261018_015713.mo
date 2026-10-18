import Principal "mo:core/Principal";

module {
  // Partial migration: all existing analytics state carries through unchanged.
  // This new field is seeded once on fresh install or the first upgrade here.
  type MemoryReport = {
    at : Int;
    source : Text;
    readings_json : Text;
    analysis_json : Text;
    author : Principal;
  };

  public func migration(_old : {}) : { var memoryReports : [MemoryReport] } {
    { var memoryReports = [] }
  };
};