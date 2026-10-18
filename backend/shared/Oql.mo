import Json "mo:json";
import Array "mo:core/Array";
import List "mo:core/List";
import Text "mo:core/Text";
import Int "mo:core/Int";
import Order "mo:core/Order";
import Runtime "mo:core/Runtime";

// Local, read-only dialect of the official schema()/execute(text) convention.
// Authorization is evaluated before projection, filtering, counts or paging.
module {
  public type Value = { #text : Text; #int : Int; #bool : Bool; #null_ };
  public type Cell = { name : Text; value : Value };
  public type Row = [Cell];
  public type Result = { hasMore : Bool; rows : [Row] };
  public type Field = { name : Text; kind : Text };
  public type Entity = { name : Text; fields : [Field] };
  type Filter = { field : Text; op : Text; value : Value };
  public type Query = {
    entity : Text; select : [Text]; filters : [Filter]; limit : Nat;
    offset : Nat; orderBy : ?Text; descending : Bool;
    count : Bool; groupBy : ?Text;
  };
  func fail(message : Text) : None { Runtime.trap("OQL: " # message) };
  public func text(name : Text, value : Text) : Cell { { name; value = #text(value) } };
  public func optional(name : Text, value : ?Text) : Cell {
    { name; value = switch (value) { case (?v) #text(v); case null #null_ } }
  };
  public func integer(name : Text, value : Int) : Cell { { name; value = #int(value) } };
  public func boolean(name : Text, value : Bool) : Cell { { name; value = #bool(value) } };
  func readObject(value : Json.Json, allowed : [Text]) : [(Text, Json.Json)] {
    let entries = switch (value) { case (#object_(e)) e; case (_) fail("Expected object") };
    var seen : [Text] = [];
    for ((key, _) in entries.values()) {
      if (not allowed.any(func(k) = k == key)) fail("Unknown property: " # key);
      if (seen.any(func(k) = k == key)) fail("Duplicate property: " # key);
      seen := seen.concat([key]);
    };
    entries
  };
  func get(entries : [(Text, Json.Json)], key : Text) : ?Json.Json {
    switch (entries.find(func(e) = e.0 == key)) { case (?e) ?e.1; case null null }
  };
  func string(value : Json.Json) : Text {
    switch (value) { case (#string(t)) t; case (_) fail("Expected text") }
  };
  func required(entries : [(Text, Json.Json)], key : Text) : Json.Json {
    switch (get(entries, key)) { case (?v) v; case null fail("Missing " # key) }
  };
  func natural(value : Json.Json) : Nat {
    switch (value) { case (#number(#int(n))) { if (n < 0) fail("Expected nonnegative integer"); Int.abs(n) }; case (_) fail("Expected integer") }
  };
  func scalar(value : Json.Json) : Value {
    switch (value) {
      case (#string(t)) #text(t); case (#number(#int(n))) #int(n);
      case (#bool(b)) #bool(b); case (#null_) #null_;
      case (_) fail("Only text, integer, boolean and null values are supported")
    }
  };
  func field(fields : [Field], name : Text) : Field {
    switch (fields.find(func(f) = f.name == name)) { case (?f) f; case null fail("Unknown field: " # name) }
  };
  func bounded(input : Text) {
    if (input.size() > 8192) fail("Query exceeds 8192 characters");
    var depth = 0; var quoted = false; var escaped = false;
    for (c in input.chars()) {
      if (quoted) {
        if (escaped) escaped := false
        else if (c == '\\') escaped := true
        else if (c == '\"') quoted := false;
      } else {
        if (c == '\"') quoted := true
        else if (c == '{' or c == '[') { depth += 1; if (depth > 8) fail("Query nesting exceeds 8") }
        else if (c == '}' or c == ']') { if (depth == 0) fail("Invalid JSON nesting"); depth -= 1 };
      };
    };
  };
  public func parse(input : Text, entities : [Entity]) : Query {
    bounded(input);
    let json = switch (Json.parse(input)) { case (#ok(v)) v; case (#err(_)) fail("Invalid JSON") };
    let root = readObject(json, ["entity", "select", "filters", "limit", "offset", "orderBy", "aggregate", "groupBy"]);
    let entity = string(required(root, "entity"));
    let fields = switch (entities.find(func(e) = e.name == entity)) { case (?e) e.fields; case null fail("Unknown entity: " # entity) };
    let select = switch (get(root, "select")) {
      case null fields.map(func(f) = f.name);
      case (?#array(values)) {
        if (values.size() == 0 or values.size() > fields.size()) fail("Invalid projection");
        let names = values.map(string); var seen : [Text] = [];
        for (name in names.values()) { ignore field(fields, name); if (seen.any(func(n) = n == name)) fail("Duplicate projection"); seen := seen.concat([name]) };
        names
      };
      case (_) fail("select must be an array")
    };
    let filters = switch (get(root, "filters")) {
      case null [];
      case (?#array(values)) {
        if (values.size() > 12) fail("At most 12 filters");
        values.map(func(value) : Filter {
          let obj = readObject(value, ["field", "op", "value"]);
          let name = string(required(obj, "field")); let f = field(fields, name);
          let op = string(required(obj, "op")); let v = scalar(required(obj, "value"));
          if (not ["eq", "ne", "gt", "gte", "lt", "lte", "contains"].any(func(x) = x == op)) fail("Unknown filter operator");
          let kind = switch (v) { case (#text(_)) "text"; case (#int(_)) "int"; case (#bool(_)) "bool"; case (#null_) "null" };
          if (kind != "null" and kind != f.kind) fail("Filter type mismatch");
          if (op == "contains" and kind != "text") fail("contains requires text");
          if (kind == "null" or kind == "bool") { if (op != "eq" and op != "ne") fail("Only eq/ne supported for boolean/null") };
          { field = name; op; value = v }
        })
      };
      case (_) fail("filters must be an array")
    };
    let limit = switch (get(root, "limit")) { case (?v) natural(v); case null 50 };
    if (limit == 0 or limit > 100) fail("limit must be 1..100");
    let offset = switch (get(root, "offset")) { case (?v) natural(v); case null 0 };
    if (offset > 10000) fail("offset exceeds 10000");
    var descending = false;
    let orderBy = switch (get(root, "orderBy")) {
      case null null;
      case (?v) {
        let obj = readObject(v, ["field", "direction"]); let name = string(required(obj, "field")); ignore field(fields, name);
        let direction = switch (get(obj, "direction")) { case (?d) string(d); case null "asc" };
        if (direction != "asc" and direction != "desc") fail("direction must be asc or desc");
        descending := direction == "desc"; ?name
      }
    };
    let count = switch (get(root, "aggregate")) { case null false; case (?v) { if (string(v) != "count") fail("Only count aggregation supported"); true } };
    let groupBy = switch (get(root, "groupBy")) { case null null; case (?v) { let name = string(v); ignore field(fields, name); if (not count) fail("groupBy requires count"); ?name } };
    if (count and (get(root, "select") != null or orderBy != null)) fail("Count queries omit select and orderBy");
    { entity; select; filters; limit; offset; orderBy; descending; count; groupBy }
  };
  func cell(row : Row, name : Text) : Value {
    switch (row.find(func(c) = c.name == name)) { case (?c) c.value; case null fail("Unavailable field") }
  };
  func compare(a : Value, b : Value) : Order.Order {
    switch (a, b) {
      case (#text(x), #text(y)) Text.compare(x, y);
      case (#int(x), #int(y)) Int.compare(x, y);
      case (#bool(x), #bool(y)) { if (x == y) #equal else if (x) #greater else #less };
      case (#null_, #null_) #equal; case (#null_, _) #less; case (_, #null_) #greater;
      case (_) fail("Incompatible types")
    }
  };
  func matches(row : Row, filter : Filter) : Bool {
    let v = cell(row, filter.field);
    if (filter.op == "eq") return v == filter.value;
    if (filter.op == "ne") return v != filter.value;
    if (filter.op == "contains") return switch (v, filter.value) { case (#text(a), #text(b)) Text.contains(a, #text b); case (_) false };
    if (v == #null_) return false;
    let cmp = compare(v, filter.value);
    switch (filter.op) { case "gt" cmp == #greater; case "gte" cmp != #less; case "lt" cmp == #less; case "lte" cmp != #greater; case (_) false }
  };
  public func run<T>(request : Query, source : [T], authorized : T -> Bool, serialize : T -> Row) : Result {
    if (source.size() > 50000) fail("Dataset exceeds scan budget; use the domain-specific API");
    let collected = List.empty<Row>();
    var total : Int = 0;
    for (item in source.values()) {
      if (authorized(item)) {
        let row = serialize(item);
        if (request.filters.all(func(f) = matches(row, f))) {
          total += 1;
          if (not request.count or request.groupBy != null) {
            if (List.size(collected) >= 10000) fail("Too many matches; narrow filters");
            List.add(collected, row);
          }
        }
      }
    };
    var rows = List.toArray(collected);
    if (request.count) {
      switch (request.groupBy) {
        case null rows := [[integer("count", total)]];
        case (?name) {
          var groups : [(Value, Int)] = [];
          for (row in rows.values()) {
            let value = cell(row, name);
            switch (groups.findIndex(func(g) = g.0 == value)) {
              case (?index) groups := Array.tabulate<(Value, Int)>(groups.size(), func(i) { if (i == index) (value, groups[i].1 + 1) else groups[i] });
              case null { if (groups.size() >= 1000) fail("Too many groups"); groups := groups.concat([(value, 1)]) }
            }
          };
          rows := groups.map(func((value, count)) : Row { [{ name; value }, integer("count", count)] });
        }
      }
    } else {
      switch (request.orderBy) {
        case null {};
        case (?name) rows := Array.sort<Row>(rows, func(a, b) { if (request.descending) compare(cell(b, name), cell(a, name)) else compare(cell(a, name), cell(b, name)) });
      };
      rows := rows.map(func(row) : Row { request.select.map(func(name) : Cell { { name; value = cell(row, name) } }) });
    };
    let size = rows.size();
    let start = if (request.offset < size) request.offset else size;
    let length = if (size - start < request.limit) size - start else request.limit;
    { hasMore = start + length < size; rows = Array.tabulate<Row>(length, func(i) = rows[start + i]) }
  };
  public func schema(entities : [Entity], example : Text) : Text {
    Json.stringify(Json.obj([
      ("version", Json.str("1.0")), ("dialect", Json.str("ignite-readonly-oql")),
      ("authentication", Json.str("Internet Identity delegation required. Only caller-authorized rows participate, including counts. No writes, PII decryption, joins or Supabase access.")),
      ("entities", Json.arr(entities.map(func(e) { Json.obj([
        ("name", Json.str(e.name)), ("fields", Json.arr(e.fields.map(func(f) { Json.obj([("name", Json.str(f.name)), ("type", Json.str(f.kind)), ("role", Json.str("caller-authorized")), ("nullable", Json.bool(true))]) })))
      ]) }))), ("edges", Json.arr([])),
      ("query", Json.obj([
        ("keys", Json.arr(["entity", "select", "filters", "orderBy", "limit", "offset", "aggregate", "groupBy"].map(Json.str))),
        ("filters", Json.str("AND array of {field,op,value}; op=eq|ne|gt|gte|lt|lte|contains; types must match; null/bool use eq/ne")),
        ("orderBy", Json.str("{field,direction:asc|desc}; omitted preserves source order")),
        ("aggregate", Json.str("count only; optional groupBy field; omit select/orderBy; output count plus group field")),
        ("paging", Json.str("limit 1..100 (default 50), offset 0..10000; advance offset by returned rows while hasMore; queries are live, not snapshot-isolated")),
        ("timestamps", Json.str("Unix milliseconds; replace example starts_at_ms value with the actual current time")),
        ("bounds", Json.str("8192 characters, nesting 8, filters 12, scan 50000, matches 10000, groups 1000")),
        ("errors", Json.str("Invalid/unsupported queries trap with OQL error; unauthorized records are absent, never counted"))
      ])), ("example", Json.str(example))
    ]), null)
  };
}