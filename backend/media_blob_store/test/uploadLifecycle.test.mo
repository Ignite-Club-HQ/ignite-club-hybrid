import Store "../src/main";

let upload = switch (await Store.begin_upload("test/ciphertext", "application/octet-stream", 3, 1)) {
  case (#Ok(id)) id;
  case (#Err(message)) { assert false; message };
};
assert (await Store.put_chunk(upload, 0, "abcd")) == #Err("Chunk exceeds size or memory budget");
assert (await Store.put_chunk(upload, 0, "abc")) == #Ok;
switch (await Store.finalize_upload(upload)) {
  case (#Ok(saved)) {
    assert saved.content_length == 3;
    assert saved.content_hash == "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";
  };
  case (#Err(_)) { assert false };
};
let response = await Store.http_request({ method = "GET"; url = "/test/ciphertext"; headers = []; body = "" });
assert response.status_code == 200;
assert response.body == "abc";
assert (await Store.begin_upload("test/oversized", "application/octet-stream", 10_551_297, 11)) == #Err("FileTooLarge");
let after = await Store.http_request({ method = "GET"; url = "/test/ciphertext"; headers = []; body = "" });
assert after.body == "abc";
let replacement = switch (await Store.begin_upload("test/ciphertext", "application/octet-stream", 3, 1)) {
  case (#Ok(id)) id;
  case (#Err(message)) { assert false; message };
};
assert (await Store.finalize_upload(replacement)) == #Err("Missing chunks");
let stillReadable = await Store.http_request({ method = "GET"; url = "/test/ciphertext"; headers = []; body = "" });
assert stillReadable.body == "abc";
assert (await Store.abort_upload(replacement)) == #Ok;