persistent actor { public query func get_content_hash(path : Text) : async ?Text { if (path == "clubs/club-a/vault/gallery-private") ?"private-hash" else null } }
