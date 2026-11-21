//! The headers the app needs on every response: cross-origin isolation for the database engine's
//! `SharedArrayBuffer`, and the Content Security Policy with its companions (see Hosting in
//! docs/spec/persistence.md and docs/spec/security.md). They're the ones the service worker adds
//! on GitHub Pages (public/service-worker.js), so the app gets the same either way.

use axum::http::{HeaderMap, HeaderName, HeaderValue, header};

/// Why the page's policy can't be used.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum Error {
    #[error("the policy file is empty")]
    Empty,
    #[error("the policy can't be sent as a header: {0}")]
    Invalid(String),
}

/// The page's Content Security Policy as a header, from the file the build writes next to the page
/// (`content-security-policy.txt`, by vite-plugins/content-security-policy.ts): the policy of the
/// page's `<meta>`, with `frame-ancestors 'none'`, which a `<meta>` can't carry. The build makes
/// both from one string, so they can't disagree, although the inline scripts' hashes change with
/// every edit to them.
///
/// # Errors
///
/// [`Error::Empty`] when the file holds nothing, and [`Error::Invalid`] when its text can't be a
/// header value.
pub(crate) fn parse_policy(text: &str) -> Result<HeaderValue, Error> {
    let policy = text.trim();
    if policy.is_empty() {
        return Err(Error::Empty);
    }

    HeaderValue::try_from(policy).map_err(|error| Error::Invalid(error.to_string()))
}

const CROSS_ORIGIN_OPENER_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-opener-policy");
const CROSS_ORIGIN_EMBEDDER_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-embedder-policy");
const CROSS_ORIGIN_RESOURCE_POLICY: HeaderName =
    HeaderName::from_static("cross-origin-resource-policy");
const PERMISSIONS_POLICY: HeaderName = HeaderName::from_static("permissions-policy");

/// Adds the headers every response gets: cross-origin isolation, and the companions that hold for
/// any file.
pub(crate) fn add_common(headers: &mut HeaderMap) {
    headers.insert(
        CROSS_ORIGIN_OPENER_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        CROSS_ORIGIN_EMBEDDER_POLICY,
        HeaderValue::from_static("require-corp"),
    );
    headers.insert(
        CROSS_ORIGIN_RESOURCE_POLICY,
        HeaderValue::from_static("same-origin"),
    );
    headers.insert(
        header::X_CONTENT_TYPE_OPTIONS,
        HeaderValue::from_static("nosniff"),
    );
    headers.insert(
        header::REFERRER_POLICY,
        HeaderValue::from_static("strict-origin-when-cross-origin"),
    );
}

/// Adds the headers a page gets on top: its policy, and the features it turns off.
pub(crate) fn add_page(headers: &mut HeaderMap, policy: &HeaderValue) {
    headers.insert(header::CONTENT_SECURITY_POLICY, policy.clone());
    headers.insert(
        PERMISSIONS_POLICY,
        HeaderValue::from_static("camera=(), microphone=(), geolocation=()"),
    );
}

#[cfg(test)]
mod test {
    use super::{Error, parse_policy};

    #[test]
    fn takes_the_policy_the_build_wrote() {
        assert_eq!(
            parse_policy("default-src 'self'; frame-ancestors 'none'\n").unwrap(),
            "default-src 'self'; frame-ancestors 'none'"
        );
    }

    #[test]
    fn refuses_an_empty_file_and_text_no_header_can_hold() {
        assert_eq!(parse_policy(" \n"), Err(Error::Empty));
        assert!(matches!(
            parse_policy("default-src 'self'\nobject-src 'none'"),
            Err(Error::Invalid(_))
        ));
    }
}
