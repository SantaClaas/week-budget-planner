//! The app as the server serves it: its files, compressed at build time (`pnpm compress`), its
//! pages, and a real 404 for the rest, with the headers the app needs on every response.

use std::path::Path;

use axum::Router;
use axum::extract::{Request, State};
use axum::http::{HeaderValue, StatusCode, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tower_http::services::{ServeDir, ServeFile};

use crate::base::Base;
use crate::header as security;

/// The paths of the app's pages after the base, besides the base itself, which all show
/// `index.html`: its `PATHS` in src/page/index.ts. The browser test for the server asks for each of
/// the app's destinations, so it fails when the app gets a page this list doesn't have.
const PAGES: [&str; 2] = ["activities", "settings"];

/// What the headers depend on: the base, for which files are hashed, and the page's policy.
#[derive(Debug, Clone)]
struct Headers {
    base: Base,
    policy: HeaderValue,
}

/// How long a browser may keep a response before it asks again.
///
/// * `path` - The request's path.
fn choose_caching(base: &Base, path: &str, status: StatusCode) -> &'static str {
    let is_found = status.is_success() || status == StatusCode::NOT_MODIFIED;
    // A file under assets/ has a hash of its content in its name (Vite's), so it never changes.
    if is_found
        && base
            .strip(path)
            .is_some_and(|rest| rest.starts_with("assets/"))
    {
        return "public, max-age=31536000, immutable";
    }

    // Everything else is checked again each time, and comes back "not modified" while it's current.
    "no-cache"
}

/// Adds the headers every response gets, a page's on top, and how long to keep it.
async fn add_headers(State(headers): State<Headers>, request: Request, next: Next) -> Response {
    let path = request.uri().path().to_owned();
    let mut response = next.run(request).await;
    let status = response.status();
    let response_headers = response.headers_mut();
    security::add_common(response_headers);
    let is_page = response_headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|content_type| content_type.starts_with("text/html"));
    if is_page {
        security::add_page(response_headers, &headers.policy);
    }

    if !response_headers.contains_key(header::CACHE_CONTROL) {
        let caching = choose_caching(&headers.base, &path, status);
        response_headers.insert(header::CACHE_CONTROL, HeaderValue::from_static(caching));
    }

    response
}

/// A file as tower-http serves it: the Brotli, zstd or gzip copy the build made, where the browser
/// takes it, or the file itself.
fn serve_file(path: &Path) -> ServeFile {
    ServeFile::new(path)
        .precompressed_br()
        .precompressed_zstd()
        .precompressed_gzip()
}

/// Whether the server is up, for whatever watches it.
async fn check_health() -> Response {
    let mut response = (StatusCode::OK, "ok").into_response();
    response
        .headers_mut()
        .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
    response
}

/// A path outside the base, which isn't the app's.
async fn refuse() -> Response {
    (StatusCode::NOT_FOUND, "Not found").into_response()
}

/// The router: the health check, the app's pages and files under the base, and a plain 404
/// outside it.
///
/// * `app` - The folder of the app's build.
/// * `policy` - The page's Content Security Policy as a header (see [`security::read_policy`]).
pub(crate) fn route(app: &Path, base: Base, policy: HeaderValue) -> Router {
    let page = serve_file(&app.join("index.html"));
    // The app's own page for a path it doesn't have (404.html, a copy of index.html the build
    // makes), with the status that says so.
    let files = ServeDir::new(app)
        .precompressed_br()
        .precompressed_zstd()
        .precompressed_gzip()
        .not_found_service(serve_file(&app.join("404.html")));

    let mut router = Router::new().route("/health", get(check_health));
    for name in PAGES {
        router = router
            .route_service(&format!("{}{name}", base.as_str()), page.clone())
            .route_service(&format!("{}{name}/", base.as_str()), page.clone());
    }

    let router = match base.as_str().strip_suffix('/') {
        Some("") | None => router.fallback_service(files),
        Some(prefix) => router.nest_service(prefix, files).fallback(refuse),
    };
    router.layer(middleware::from_fn_with_state(
        Headers { base, policy },
        add_headers,
    ))
}

#[cfg(test)]
mod test {
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicUsize, Ordering};

    use axum::body::Body;
    use axum::http::{HeaderValue, Request, StatusCode, header};
    use axum::response::Response;
    use http_body_util::BodyExt;
    use tower::ServiceExt;

    use super::route;
    use crate::base::Base;

    const PAGE: &str = "<!doctype html><title>Week Budget Planner</title>";
    const NOT_FOUND_PAGE: &str = "<!doctype html><title>Page not found</title>";
    const SCRIPT: &str = "let block = 1;";
    /// Stands in for the Brotli copy `pnpm compress` makes: only which file is sent matters here.
    const SCRIPT_BROTLI: &[u8] = b"brotli bytes";
    const POLICY: &str = "default-src 'self'; frame-ancestors 'none'";

    /// A build folder of its own for each test, in the system's temporary folder.
    fn create_build() -> PathBuf {
        static COUNT: AtomicUsize = AtomicUsize::new(0);
        let folder = std::env::temp_dir().join(format!(
            "week-budget-planner-server-{}-{}",
            std::process::id(),
            COUNT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir_all(folder.join("assets")).unwrap();
        std::fs::write(folder.join("index.html"), PAGE).unwrap();
        std::fs::write(folder.join("404.html"), NOT_FOUND_PAGE).unwrap();
        std::fs::write(folder.join("assets/index-D0LmUKDL.js"), SCRIPT).unwrap();
        std::fs::write(folder.join("assets/index-D0LmUKDL.js.br"), SCRIPT_BROTLI).unwrap();
        std::fs::write(folder.join("service-worker.js"), "self;").unwrap();
        folder
    }

    async fn send(base: &str, request: Request<Body>) -> Response {
        let router = route(
            &create_build(),
            Base::parse(base).unwrap(),
            HeaderValue::from_static(POLICY),
        );
        router.oneshot(request).await.unwrap()
    }

    async fn get(base: &str, path: &str) -> Response {
        send(base, Request::get(path).body(Body::empty()).unwrap()).await
    }

    async fn read_body(response: Response) -> Vec<u8> {
        response
            .into_body()
            .collect()
            .await
            .unwrap()
            .to_bytes()
            .to_vec()
    }

    #[tokio::test]
    async fn shows_the_page_on_every_path_of_the_app() {
        for path in [
            "/week-budget-planner",
            "/week-budget-planner/",
            "/week-budget-planner/index.html",
            "/week-budget-planner/activities",
            "/week-budget-planner/activities/",
            "/week-budget-planner/settings",
        ] {
            let response = get("/week-budget-planner/", path).await;
            assert_eq!(response.status(), StatusCode::OK, "{path}");
            assert_eq!(read_body(response).await, PAGE.as_bytes(), "{path}");
        }
    }

    #[tokio::test]
    async fn answers_any_other_path_with_the_app_s_404_page() {
        let response = get("/week-budget-planner/", "/week-budget-planner/nothing-here").await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-cache");
        assert_eq!(read_body(response).await, NOT_FOUND_PAGE.as_bytes());
    }

    #[tokio::test]
    async fn answers_a_path_outside_the_base_with_a_plain_404() {
        let response = get("/week-budget-planner/", "/settings").await;
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(read_body(response).await, b"Not found");
    }

    #[tokio::test]
    async fn serves_the_app_at_the_root_by_default() {
        assert_eq!(get("/", "/").await.status(), StatusCode::OK);
        assert_eq!(get("/", "/settings").await.status(), StatusCode::OK);
        let script = get("/", "/assets/index-D0LmUKDL.js").await;
        assert_eq!(script.status(), StatusCode::OK);
        assert_eq!(read_body(script).await, SCRIPT.as_bytes());
        assert_eq!(
            get("/", "/nothing-here").await.status(),
            StatusCode::NOT_FOUND
        );
    }

    #[tokio::test]
    async fn isolates_every_response_and_gives_pages_their_policy() {
        for path in ["/", "/assets/index-D0LmUKDL.js", "/nothing-here", "/health"] {
            let response = get("/", path).await;
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

        let page = get("/", "/").await;
        assert_eq!(page.headers()[header::CONTENT_SECURITY_POLICY], POLICY);
        assert_eq!(
            page.headers()["permissions-policy"],
            "camera=(), microphone=(), geolocation=()"
        );
        let not_found = get("/", "/nothing-here").await;
        assert_eq!(not_found.headers()[header::CONTENT_SECURITY_POLICY], POLICY);
        let script = get("/", "/assets/index-D0LmUKDL.js").await;
        assert!(
            script
                .headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .is_none()
        );
    }

    #[tokio::test]
    async fn caches_hashed_files_for_a_year_and_the_rest_never_unasked() {
        let script = get("/", "/assets/index-D0LmUKDL.js").await;
        assert_eq!(
            script.headers()[header::CACHE_CONTROL],
            "public, max-age=31536000, immutable"
        );
        assert_eq!(
            get("/", "/").await.headers()[header::CACHE_CONTROL],
            "no-cache"
        );
        assert_eq!(
            get("/", "/service-worker.js").await.headers()[header::CACHE_CONTROL],
            "no-cache"
        );
        let missing = get("/", "/assets/missing.js").await;
        assert_eq!(missing.headers()[header::CACHE_CONTROL], "no-cache");
        assert_eq!(
            get("/", "/health").await.headers()[header::CACHE_CONTROL],
            "no-store"
        );
    }

    #[tokio::test]
    async fn sends_the_compressed_copy_where_the_browser_takes_it() {
        let request = Request::get("/assets/index-D0LmUKDL.js")
            .header(header::ACCEPT_ENCODING, "gzip, br")
            .body(Body::empty())
            .unwrap();
        let response = send("/", request).await;
        assert_eq!(response.headers()[header::CONTENT_ENCODING], "br");
        assert_eq!(response.headers()[header::VARY], "accept-encoding");
        assert_eq!(read_body(response).await, SCRIPT_BROTLI);
    }

    #[tokio::test]
    async fn reports_its_health() {
        let health = get("/week-budget-planner/", "/health").await;
        assert_eq!(health.status(), StatusCode::OK);
        assert_eq!(read_body(health).await, b"ok");
    }
}
