//! The headers the app needs on every response: cross-origin isolation for the database engine's
//! `SharedArrayBuffer`, and the Content Security Policy with its companions (see Hosting in
//! docs/spec/persistence.md and docs/spec/security.md). They're the ones the service worker adds
//! on GitHub Pages (public/service-worker.js), so the app gets the same either way.

use axum::http::{HeaderMap, HeaderName, HeaderValue, header};

/// Why the page's policy couldn't be read.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum Error {
    #[error("index.html has no Content-Security-Policy <meta>, which the build adds")]
    Missing,
    #[error("index.html's Content-Security-Policy can't be sent as a header: {0}")]
    Invalid(String),
}

/// The value of an HTML attribute as text: the build writes `'` as `&#39;`, and the other
/// characters HTML escapes may appear too.
fn decode_attribute(value: &str) -> String {
    let mut decoded = String::with_capacity(value.len());
    let mut rest = value;
    while let Some(start) = rest.find('&') {
        decoded.push_str(&rest[..start]);
        rest = &rest[start..];
        let Some(end) = rest.find(';') else {
            break;
        };
        let entity = &rest[1..end];
        let character = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix('#')
                .and_then(|number| number.parse::<u32>().ok())
                .and_then(char::from_u32),
        };
        let Some(character) = character else {
            decoded.push('&');
            rest = &rest[1..];
            continue;
        };

        decoded.push(character);
        rest = &rest[end + 1..];
    }

    decoded.push_str(rest);
    decoded
}

/// The marker the policy's `<meta>` starts with, as the build writes it
/// (vite-plugins/content-security-policy.ts).
const POLICY_META: &str = r#"<meta http-equiv="Content-Security-Policy" content=""#;

/// The page's Content Security Policy as a header: the `<meta>` policy the build put in
/// `index.html`, with `frame-ancestors 'none'`, which a `<meta>` policy can't carry. Taking it from
/// the build keeps the header and the `<meta>` from ever disagreeing: the inline scripts' hashes
/// change with every edit to them.
///
/// # Errors
///
/// [`Error::Missing`] when the page has no policy `<meta>`, and [`Error::Invalid`] when it can't
/// be a header value.
pub(crate) fn read_policy(index_html: &str) -> Result<HeaderValue, Error> {
    let start = index_html.find(POLICY_META).ok_or(Error::Missing)? + POLICY_META.len();
    let length = index_html[start..].find('"').ok_or(Error::Missing)?;
    let policy = decode_attribute(&index_html[start..start + length]);
    let policy = format!(
        "{}; frame-ancestors 'none'",
        policy.trim().trim_end_matches(';')
    );
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
    use super::{Error, decode_attribute, read_policy};

    #[test]
    fn decodes_what_html_escapes() {
        assert_eq!(decode_attribute("&#39;self&#39;"), "'self'");
        assert_eq!(
            decode_attribute("a &amp; b &lt;c&gt; &quot;d&quot; &apos;"),
            "a & b <c> \"d\" '"
        );
        assert_eq!(decode_attribute("no entities"), "no entities");
        assert_eq!(decode_attribute("&unknown; &"), "&unknown; &");
    }

    #[test]
    fn reads_the_build_s_policy_and_adds_frame_ancestors() {
        let page = r#"<head><meta http-equiv="Content-Security-Policy" content="default-src &#39;self&#39;; script-src &#39;self&#39; &#39;sha256-a+b/c=&#39;"><title>x</title>"#;
        assert_eq!(
            read_policy(page).unwrap(),
            "default-src 'self'; script-src 'self' 'sha256-a+b/c='; frame-ancestors 'none'"
        );
    }

    #[test]
    fn refuses_a_page_without_a_policy() {
        assert_eq!(
            read_policy("<head><title>x</title></head>"),
            Err(Error::Missing)
        );
    }
}
