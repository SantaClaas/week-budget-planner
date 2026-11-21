//! The headers the app needs on every response: cross-origin isolation for the database engine's
//! `SharedArrayBuffer`, and the Content Security Policy with its companions (see Hosting in
//! docs/spec/persistence.md and docs/spec/security.md). They're the ones the service worker adds
//! on GitHub Pages (public/service-worker.js), so the app gets the same either way.
//!
//! Every value is a constant made with `HeaderValue::from_static`, which the compiler runs: a value
//! with bytes no header may hold, such as a line break, is a compile error, not a panic later.

use axum::http::{HeaderMap, HeaderName, HeaderValue, header};

/// The page's Content Security Policy as a header: the policy of the page's `<meta>`, with
/// `frame-ancestors 'none'`, which a `<meta>` can't carry. It's compiled in from
/// content-security-policy.txt, which `pnpm policy` writes from index.html's inline scripts, and
/// the app's build fails when the two disagree (vite-plugins/content-security-policy.ts). So the
/// server builds without the app having been built, and can't be built without a policy.
pub(crate) const POLICY: HeaderValue =
    HeaderValue::from_static(include_str!("../../../content-security-policy.txt").trim_ascii_end());

const CROSS_ORIGIN_OPENER_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-opener-policy");
const CROSS_ORIGIN_EMBEDDER_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-embedder-policy");
const CROSS_ORIGIN_RESOURCE_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-resource-policy");
const PERMISSIONS_POLICY: HeaderName = HeaderName::from_static("permissions-policy");

const SAME_ORIGIN: HeaderValue = HeaderValue::from_static("same-origin");
const REQUIRE_CORP: HeaderValue = HeaderValue::from_static("require-corp");
const NO_SNIFF: HeaderValue = HeaderValue::from_static("nosniff");
const REFERRER: HeaderValue = HeaderValue::from_static("strict-origin-when-cross-origin");
/// The features the app doesn't use, turned off.
const PERMISSIONS: HeaderValue =
    HeaderValue::from_static("camera=(), microphone=(), geolocation=()");

/// Adds the headers every response gets: cross-origin isolation, and the companions that hold for
/// any file.
pub(crate) fn add_common(headers: &mut HeaderMap) {
    headers.insert(CROSS_ORIGIN_OPENER_POLICY, SAME_ORIGIN);
    headers.insert(CROSS_ORIGIN_EMBEDDER_POLICY, REQUIRE_CORP);
    headers.insert(CROSS_ORIGIN_RESOURCE_POLICY, SAME_ORIGIN);
    headers.insert(header::X_CONTENT_TYPE_OPTIONS, NO_SNIFF);
    headers.insert(header::REFERRER_POLICY, REFERRER);
}

/// Adds the headers a page gets on top: its policy, and the features it turns off.
pub(crate) fn add_page(headers: &mut HeaderMap) {
    headers.insert(header::CONTENT_SECURITY_POLICY, POLICY);
    headers.insert(PERMISSIONS_POLICY, PERMISSIONS);
}

#[cfg(test)]
mod test {
    use super::POLICY;

    #[test]
    fn compiles_in_the_policy_with_frame_ancestors() {
        let value = POLICY;
        let policy = value.to_str().unwrap();
        assert!(policy.starts_with("default-src 'self';"));
        assert!(policy.ends_with("; frame-ancestors 'none'"));
    }
}
