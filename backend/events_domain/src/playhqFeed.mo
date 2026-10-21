import Json "mo:json";
import Array "mo:core/Array";
import Nat16 "mo:core/Nat16";
import Text "mo:core/Text";
module {
  public func field(row:Json.Json,key:Text):Json.Json {
    switch(row){case(#object_(fields))switch(fields.find(func(pair)=pair.0==key)){case null #null_;case(?pair)pair.1};case _ #null_}
  };
  public func str(row:Json.Json,key:Text):Text {switch(field(row,key)){case(#string(v))v;case _ ""}};
  public func score(row:Json.Json,key:Text):?Nat16 {switch(field(row,key)){case(#number(#int(v)))if(v>=0 and v<=65535)?Nat16.fromIntWrap(v)else null;case _ null}};
  public func rows(raw:Text):{#Ok:[Json.Json];#Err:Text} {
    switch(Json.parse(raw)){
      case(#ok(doc)){
        let meta=field(doc,"metadata");
        if(field(meta,"hasMore")==#bool(true)) return #Err("Feed requires another page; partial import refused");
        switch(field(doc,"data")){case(#array(values))if(values.size()<=200)#Ok(values)else #Err("Feed exceeds 200 records");case _ #Err("Malformed PlayHQ data")}
      };case(#err(_))#Err("Invalid PlayHQ JSON")
    }
  };
  public func numeric(raw:Json.Json):Text {
    switch(raw){case(#object_(fields))Json.stringify(#object_(fields.filter(func(pair)=switch(pair.1){case(#number(_))true;case _ false})),null);case _ "{}"}
  };
  public func page(raw:Text):{#Ok:{rows:[Json.Json];cursor:?Text};#Err:Text}{
    switch(Json.parse(raw)){
      case(#err(_))#Err("Invalid PlayHQ JSON");
      case(#ok(doc)){
        let values=switch(field(doc,"data")){case(#array(v))v;case _ return #Err("Malformed PlayHQ data")};
        if (values.size() > 200) return #Err("Feed exceeds 200 records");
        let meta=field(doc,"metadata");
        if(field(meta,"hasMore")==#bool(true)){
          let cursor=str(meta,"nextCursor");
          if(cursor=="")return #Err("Missing pagination cursor");
          #Ok({rows=values;cursor=?cursor})
        }else #Ok({rows=values;cursor=null})
      }
    }
  };
}