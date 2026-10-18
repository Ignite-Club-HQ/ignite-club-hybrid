import Migration "../src/backend/migrations/20261018_015713";
import Principal "mo:core/Principal";

let migrated = Migration.migration({});
assert migrated.memoryReports.size() == 0;
// The migrated field has the same mutable record shape consumed by the actor.
migrated.memoryReports := [{
  at = 123;
  source = "manual";
  readings_json = "{}";
  analysis_json = "";
  author = Principal.anonymous();
}];
assert migrated.memoryReports.size() == 1;
assert migrated.memoryReports[0].at == 123;