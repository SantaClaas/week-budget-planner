//! The app as the server serves it: its pages, its files and a real 404 for the rest. Answering a
//! request is a pure function of the files and the request ([`respond`]); the router around it is
//! the edge.

use std::sync::Arc;

use axum::Router;
use axum::body::Body;
use axum::extract::{Request, State};
use axum::http::{HeaderMap, HeaderValue, Method, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;

use crate::asset::encoding::{self, Encoding};
use crate::asset::{Asset, Assets, Caching};
use crate::base::Base;
use crate::header as security;

/// The paths of the app's pages after the base, which all show `index.html`: its `PATHS` in
/// src/page/index.ts. The browser test for the server asks for each of the app's destinations, so it
/// fails when the app gets a page this list doesn't have.
const PAGES: [&str; 3] = ["", "activities", "settings"];

/// What the server serves, prepared once at startup.
#[derive(Debug)]
pub(crate) struct Site {
    pub(crate) assets: Assets,
    pub(crate) base: Base,
    /// The page's Content Security Policy as a header (see [`security::read_policy`]).
    pub(crate) policy: HeaderValue,
}

/// Whether a path after the base is one of the app's pages. A trailing slash and `index.html` are
/// other spellings of the same page, as the app reads them.
fn is_page(rest: &str) -> bool {
    let page = rest.strip_suffix("index.html").unwrap_or(rest);
    let page = page.strip_suffix('/').unwrap_or(page);
    PAGES.contains(&page)
}

/// Whether the request already has these bytes, by the tag it sent in `If-None-Match`.
fn is_current(request_headers: &HeaderMap, entity_tag: &str) -> bool {
    let Some(tags) = request_headers
        .get(header::IF_NONE_MATCH)
        .and_then(|value| value.to_str().ok())
    else {
        return false;
    };

    tags.split(',').any(|tag| {
        let tag = tag.trim();
        tag == "*" || tag.trim_start_matches("W/") == entity_tag
    })
}

/// A file as a response: in the encoding the request takes, with its caching and its tag, or "not
/// modified" when the browser's copy is current.
fn respond_with_asset(
    site: &Site,
    asset: &Asset,
    status: StatusCode,
    method: &Method,
    request_headers: &HeaderMap,
) -> Response {
    let accept_encoding = request_headers
        .get(header::ACCEPT_ENCODING)
        .and_then(|value| value.to_str().ok());
    let available = asset.encodings();
    let encoding = encoding::choose(accept_encoding, &available);
    let entity_tag = asset.entity_tag(encoding);
    let is_not_modified = status == StatusCode::OK && is_current(request_headers, &entity_tag);

    let body = asset.body(encoding);
    let length = body.len();
    let mut response = if is_not_modified || method == Method::HEAD {
        Response::new(Body::empty())
    } else {
        Response::new(Body::from(body))
    };
    *response.status_mut() = if is_not_modified {
        StatusCode::NOT_MODIFIED
    } else {
        status
    };
    let headers = response.headers_mut();
    security::add_common(headers);
    if asset.content_type.starts_with("text/html") {
        security::add_page(headers, &site.policy);
    }

    headers.insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static(asset.content_type),
    );
    let caching = if status == StatusCode::OK {
        asset.caching
    } else {
        Caching::Revalidate
    };
    headers.insert(
        header::CACHE_CONTROL,
        HeaderValue::from_static(caching.header()),
    );
    if let Ok(value) = HeaderValue::try_from(entity_tag) {
        headers.insert(header::ETAG, value);
    }

    if !available.is_empty() {
        headers.insert(header::VARY, HeaderValue::from_static("accept-encoding"));
    }

    if encoding != Encoding::Identity {
        headers.insert(
            header::CONTENT_ENCODING,
            HeaderValue::from_static(encoding.token()),
        );
    }

    // A HEAD response says how long the body of a GET would be.
    if method == Method::HEAD && !is_not_modified {
        headers.insert(header::CONTENT_LENGTH, HeaderValue::from(length));
    }

    response
}

/// A response without a file: the 404 outside the base, or the methods the server doesn't take.
fn respond_plainly(status: StatusCode, text: &'static str) -> Response {
    let mut response = (status, text).into_response();
    let headers = response.headers_mut();
    security::add_common(headers);
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    if status == StatusCode::METHOD_NOT_ALLOWED {
        headers.insert(header::ALLOW, HeaderValue::from_static("GET, HEAD"));
    }

    response
}

/// The response to a request for anything but the health check.
///
/// * `path` - The request's path, as it came, without its query.
pub(crate) fn respond(site: &Site, method: &Method, path: &str, headers: &HeaderMap) -> Response {
    if method != Method::GET && method != Method::HEAD {
        return respond_plainly(StatusCode::METHOD_NOT_ALLOWED, "Method not allowed");
    }

    let Some(rest) = site.base.strip(path) else {
        return respond_plainly(StatusCode::NOT_FOUND, "Not found");
    };

    if is_page(rest)
        && let Some(index) = site.assets.get("index.html")
    {
        return respond_with_asset(site, index, StatusCode::OK, method, headers);
    }

    if let Some(asset) = site.assets.get(rest) {
        return respond_with_asset(site, asset, StatusCode::OK, method, headers);
    }

    // The app's own page for a path it doesn't have (404.html, a copy of index.html the build
    // makes), with the status that says so.
    match site
        .assets
        .get("404.html")
        .or(site.assets.get("index.html"))
    {
        Some(page) => respond_with_asset(site, page, StatusCode::NOT_FOUND, method, headers),
        None => respond_plainly(StatusCode::NOT_FOUND, "Not found"),
    }
}

async fn serve(State(site): State<Arc<Site>>, request: Request) -> Response {
    respond(
        &site,
        request.method(),
        request.uri().path(),
        request.headers(),
    )
}

/// Whether the server is up, for whatever watches it.
async fn check_health() -> Response {
    let mut response = (StatusCode::OK, "ok").into_response();
    let headers = response.headers_mut();
    security::add_common(headers);
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// The router: the health check, and the app for every other path.
pub(crate) fn route(site: Site) -> Router {
    Router::new()
        .route("/health", get(check_health))
        .fallback(serve)
        .with_state(Arc::new(site))
}

#[cfg(test)]
mod test {
    use axum::body::Body;
    use axum::http::{HeaderMap, HeaderValue, Method, Request, StatusCode, header};
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::{Site, respond, route};
    use crate::asset::Assets;
    use crate::base::Base;

    const PAGE: &str = "<!doctype html><title>Week Budget Planner</title>";
    const NOT_FOUND_PAGE: &str = "<!doctype html><title>Page not found</title>";

    fn create_site(base: &str) -> Site {
        let script = "let block = 1;\n".repeat(200);
        Site {
            assets: Assets::new([
                ("index.html".to_owned(), PAGE.as_bytes().to_vec()),
                ("404.html".to_owned(), NOT_FOUND_PAGE.as_bytes().to_vec()),
                ("assets/index-D0LmUKDL.js".to_owned(), script.into_bytes()),
                ("service-worker.js".to_owned(), b"self;".to_vec()),
            ]),
            base: Base::parse(base).unwrap(),
            policy: HeaderValue::from_static("default-src 'self'; frame-ancestors 'none'"),
        }
    }

    fn get(site: &Site, path: &str) -> axum::response::Response {
        respond(site, &Method::GET, path, &HeaderMap::new())
    }

    async fn read_body(response: axum::response::Response) -> String {
        let bytes = response.into_body().collect().await.unwrap().to_bytes();
        String::from_utf8(bytes.to_vec()).unwrap()
    }

    #[tokio::test]
    async fn shows_the_page_on_every_path_of_the_app() {
        let site = create_site("/week-budget-planner/");
        for path in [
            "/week-budget-planner",
            "/week-budget-planner/",
            "/week-budget-planner/index.html",
            "/week-budget-planner/activities",
            "/week-budget-planner/activities/",
            "/week-budget-planner/settings",
        ] {
            let response = get(&site, path);
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(read_body(response).await, PAGE, "{path}");
        }
    }

    #[tokio::test]
    async fn answers_any_other_path_with_the_app_s_404_page() {
        let site = create_site("/week-budget-planner/");
        let response = get(&site, "/week-budget-planner/nothing-here");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
        assert_eq!(read_body(response).await, NOT_FOUND_PAGE);
    }

    #[tokio::test]
    async fn answers_a_path_outside_the_base_with_a_plain_404() {
        let site = create_site("/week-budget-planner/");
        let response = get(&site, "/settings");
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(read_body(response).await, "Not found");
    }

    #[test]
    fn serves_the_app_at_the_root_by_default() {
        let site = create_site("/");
        assert_eq!(get(&site, "/").status(), StatusCode::OK);
        assert_eq!(get(&site, "/settings").status(), StatusCode::OK);
        assert_eq!(
            get(&site, "/assets/index-D0LmUKDL.js").status(),
            StatusCode::OK
        );
        assert_eq!(
            get(&site, "/week-budget-planner/").status(),
            StatusCode::NOT_FOUND
        );
    }

    #[test]
    fn isolates_every_response_and_gives_pages_their_policy() {
        let site = create_site("/");
        for path in ["/", "/assets/index-D0LmUKDL.js", "/nothing-here"] {
            let response = get(&site, path);
            let headers = response.headers();
            assert_eq!(
                headers["cross-origin-opener-policy"], "same-origin",
                "{path}"
            );
            assert_eq!(
                headers["cross-origin-embedder-policy"], "require-corp",
                "{path}"
            );
            assert_eq!(
                headers["cross-origin-resource-policy"], "same-origin",
                "{path}"
            );
            assert_eq!(headers[header::X_CONTENT_TYPE_OPTIONS], "nosniff", "{path}");
            assert_eq!(
                headers[header::REFERRER_POLICY],
                "strict-origin-when-cross-origin"
            );
        }

        let page = get(&site, "/");
        assert_eq!(
            page.headers()[header::CONTENT_SECURITY_POLICY],
            "default-src 'self'; frame-ancestors 'none'"
        );
        assert_eq!(
            page.headers()["permissions-policy"],
            "camera=(), microphone=(), geolocation=()"
        );
        let script = get(&site, "/assets/index-D0LmUKDL.js");
        assert!(
            script
                .headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .is_none()
        );
    }

    #[test]
    fn caches_hashed_files_for_a_year_and_the_page_never_unasked() {
        let site = create_site("/");
        let script = get(&site, "/assets/index-D0LmUKDL.js");
        assert_eq!(
            script.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        assert_eq!(get(&site, "/").headers()[header::CACHE_CONTROL], "no-cache");
        assert_eq!(
            get(&site, "/service-worker.js").headers()[header::CACHE_CONTROL],
            "no-cache"
        );
    }

    #[tokio::test]
    async fn sends_brotli_where_the_browser_takes_it() {
        let site = create_site("/");
        let mut headers = HeaderMap::new();
        headers.insert(
            header::ACCEPT_ENCODING,
            HeaderValue::from_static("gzip, br"),
        );
        let response = respond(&site, &Method::GET, "/assets/index-D0LmUKDL.js", &headers);
        assert_eq!(response.headers()[header::CONTENT_ENCODING], "br");
        assert_eq!(response.headers()[header::VARY], "accept-encoding");
        let compressed = response.into_body().collect().await.unwrap().to_bytes();
        let mut decompressed = Vec::new();
        brotli::BrotliDecompress(&mut &compressed[..], &mut decompressed).unwrap();
        assert_eq!(decompressed, "let block = 1;\n".repeat(200).as_bytes());

        let plain = get(&site, "/assets/index-D0LmUKDL.js");
        assert!(plain.headers().get(header::CONTENT_ENCODING).is_none());
    }

    #[tokio::test]
    async fn says_not_modified_when_the_browser_s_copy_is_current() {
        let site = create_site("/");
        let first = get(&site, "/");
        let tag = first.headers()[header::ETAG].clone();
        let mut headers = HeaderMap::new();
        headers.insert(header::IF_NONE_MATCH, tag.clone());
        let again = respond(&site, &Method::GET, "/", &headers);
        assert_eq!(again.status(), StatusCode::NOT_MODIFIED);
        assert_eq!(again.headers()[header::ETAG], tag);
        assert_eq!(read_body(again).await, "");

        headers.insert(header::IF_NONE_MATCH, HeaderValue::from_static("\"other\""));
        assert_eq!(
            respond(&site, &Method::GET, "/", &headers).status(),
            StatusCode::OK
        );
    }

    #[tokio::test]
    async fn answers_head_without_a_body_and_refuses_other_methods() {
        let site = create_site("/");
        let head = respond(&site, &Method::HEAD, "/", &HeaderMap::new());
        assert_eq!(head.status(), StatusCode::OK);
        assert_eq!(
            head.headers()[header::CONTENT_LENGTH],
            PAGE.len().to_string()
        );
        assert_eq!(read_body(head).await, "");

        let post = respond(&site, &Method::POST, "/", &HeaderMap::new());
        assert_eq!(post.status(), StatusCode::METHOD_NOT_ALLOWED);
        assert_eq!(post.headers()[header::ALLOW], "GET, HEAD");
    }

    #[tokio::test]
    async fn reports_its_health_and_serves_the_app_through_the_router() {
        let router = route(create_site("/"));
        let health = router
            .clone()
            .oneshot(Request::get("/health").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(health.status(), StatusCode::OK);
        assert_eq!(read_body(health).await, "ok");

        let page = router
            .oneshot(Request::get("/activities?x=1").body(Body::empty()).unwrap())
            .await
            .unwrap();
        assert_eq!(page.status(), StatusCode::OK);
        assert_eq!(read_body(page).await, PAGE);
    }
}
