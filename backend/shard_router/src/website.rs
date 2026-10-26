//! Club-website resolution. The website registers every ICP club against this
//! router once; `GET /club?id=<uuid>&scope=<..>` answers with a 307 redirect to
//! the owning group's club_domain `/club` endpoint, so moving a club between
//! groups never requires re-registering with the website. Public by design:
//! it reveals only which public club_domain endpoint serves a club ID the
//! caller already knows; club_domain still filters to website-safe fields.
use candid::{CandidType, Principal};
use serde::Deserialize;

pub const SCOPES: [&str; 5] = ["club", "subscription", "teams", "sponsors", "all"];

#[derive(CandidType, Deserialize)]
pub struct HttpRequest {
    pub method: String,
    pub url: String,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

#[derive(CandidType, Deserialize, Debug, PartialEq)]
pub struct HttpResponse {
    pub status_code: u16,
    pub headers: Vec<(String, String)>,
    pub body: Vec<u8>,
}

fn json(status: u16, body: &str) -> HttpResponse {
    HttpResponse {
        status_code: status,
        headers: vec![
            ("content-type".into(), "application/json".into()),
            ("cache-control".into(), "no-store".into()),
        ],
        body: body.as_bytes().to_vec(),
    }
}

fn is_club_uuid(id: &str) -> bool {
    id.len() == 36 && id.bytes().all(|c| c.is_ascii_hexdigit() || c == b'-')
}

/// Parses `/club?id=..&scope=..`; returns (club_id, scope) or an error response.
pub fn parse(req: &HttpRequest) -> Result<(String, String), HttpResponse> {
    if !req.method.eq_ignore_ascii_case("GET") {
        return Err(json(405, r#"{"error":"Method not allowed"}"#));
    }
    let (path, query) = req.url.split_once('?').unwrap_or((req.url.as_str(), ""));
    if path != "/club" {
        return Err(json(404, r#"{"error":"Not found"}"#));
    }
    let mut id = None;
    let mut scope = "all".to_string();
    for pair in query.split('&') {
        match pair.split_once('=') {
            Some(("id", v)) => id = Some(v.to_ascii_lowercase()),
            Some(("scope", v)) => scope = v.to_string(),
            _ => {}
        }
    }
    let id = id.filter(|v| is_club_uuid(v)).ok_or_else(|| json(400, r#"{"error":"id must be the club's UUID"}"#))?;
    if !SCOPES.contains(&scope.as_str()) {
        return Err(json(400, r#"{"error":"Invalid scope"}"#));
    }
    Ok((id, scope))
}

pub fn redirect(club_domain: Option<Principal>, id: &str, scope: &str) -> HttpResponse {
    match club_domain {
        None => json(404, r#"{"error":"Club is not hosted on ICP"}"#),
        Some(canister) => HttpResponse {
            status_code: 307,
            headers: vec![
                ("location".into(), format!("https://{}.icp0.io/club?id={id}&scope={scope}", canister.to_text())),
                ("cache-control".into(), "no-store".into()),
            ],
            body: Vec::new(),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    fn get(url: &str) -> HttpRequest {
        HttpRequest { method: "GET".into(), url: url.into(), headers: vec![], body: vec![] }
    }
    const ID: &str = "0b6f2a3c-1d2e-4f50-8a9b-0c1d2e3f4a5b";

    #[test]
    fn redirects_to_owning_club_domain() {
        let (id, scope) = parse(&get(&format!("/club?id={ID}&scope=teams"))).unwrap();
        let p = Principal::from_text("aaaaa-aa").unwrap();
        let r = redirect(Some(p), &id, &scope);
        assert_eq!(r.status_code, 307);
        assert_eq!(r.headers[0].1, format!("https://aaaaa-aa.icp0.io/club?id={ID}&scope=teams"));
    }

    #[test]
    fn rejects_bad_input_and_unknown_clubs() {
        assert_eq!(parse(&get("/club?id=x")).unwrap_err().status_code, 400);
        assert_eq!(parse(&get(&format!("/club?id={ID}&scope=evil"))).unwrap_err().status_code, 400);
        assert_eq!(parse(&get("/other")).unwrap_err().status_code, 404);
        assert_eq!(redirect(None, ID, "all").status_code, 404);
    }
}
