import Feed "../src/playhqFeed";
import Json "mo:json";
assert Feed.rows("{\"metadata\":{\"hasMore\":true},\"data\":[]}")==#Err("Feed requires another page; partial import refused");
assert Feed.rows("broken")==#Err("Invalid PlayHQ JSON");
let row=switch(Json.parse("{\"home\":23,\"away\":17,\"bad\":-1}")){case(#ok(r))r;case _ #null_};
assert Feed.score(row,"home")==?23;
assert Feed.score(row,"away")==?17;
assert Feed.score(row,"bad")==null;
switch(Feed.page("{\"metadata\":{\"hasMore\":true,\"nextCursor\":\"next-1\"},\"data\":[]}")){
case(#Ok(p))assert p.cursor==?"next-1";case _ assert false
};
assert Feed.page("{\"metadata\":{\"hasMore\":true},\"data\":[]}")==#Err("Missing pagination cursor");