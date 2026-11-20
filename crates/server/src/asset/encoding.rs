//! Which compression a response uses, from the request's `Accept-Encoding`.

/// A way a file's bytes can be sent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Encoding {
    Brotli,
    Gzip,
    Identity,
}

impl Encoding {
    /// The token for it in `Accept-Encoding` and `Content-Encoding`.
    pub(crate) fn token(self) -> &'static str {
        match self {
            Self::Brotli => "br",
            Self::Gzip => "gzip",
            Self::Identity => "identity",
        }
    }
}

/// Whether `Accept-Encoding` allows an encoding: it's named, or `*` is, without `q=0`.
fn is_accepted(accept_encoding: &str, encoding: Encoding) -> bool {
    let mut named = None;
    let mut wildcard = None;
    for item in accept_encoding.split(',') {
        let mut parts = item.split(';');
        let token = parts.next().unwrap_or_default().trim();
        let is_refused = parts.any(|parameter| {
            let parameter = parameter.trim();
            let Some(quality) = parameter
                .strip_prefix("q=")
                .or(parameter.strip_prefix("Q="))
            else {
                return false;
            };
            quality
                .trim()
                .parse::<f32>()
                .is_ok_and(|value| value <= 0.0)
        });
        if token.eq_ignore_ascii_case(encoding.token()) {
            named = Some(!is_refused);
            continue;
        }

        if token == "*" {
            wildcard = Some(!is_refused);
        }
    }

    named.or(wildcard).unwrap_or(false)
}

/// The smallest encoding the request accepts among those a file has: Brotli, then gzip, then the
/// bytes as they are.
///
/// * `accept_encoding` - The request's header, if it sent one.
/// * `available` - The compressed encodings the file has.
pub(crate) fn choose(accept_encoding: Option<&str>, available: &[Encoding]) -> Encoding {
    let Some(accept_encoding) = accept_encoding else {
        return Encoding::Identity;
    };

    [Encoding::Brotli, Encoding::Gzip]
        .into_iter()
        .find(|encoding| available.contains(encoding) && is_accepted(accept_encoding, *encoding))
        .unwrap_or(Encoding::Identity)
}

#[cfg(test)]
mod test {
    use super::{Encoding, choose};

    const BOTH: &[Encoding] = &[Encoding::Brotli, Encoding::Gzip];

    #[test]
    fn prefers_brotli_then_gzip() {
        assert_eq!(
            choose(Some("gzip, deflate, br, zstd"), BOTH),
            Encoding::Brotli
        );
        assert_eq!(choose(Some("gzip, deflate"), BOTH), Encoding::Gzip);
        assert_eq!(choose(Some("BR"), BOTH), Encoding::Brotli);
    }

    #[test]
    fn sends_the_bytes_as_they_are_when_nothing_fits() {
        assert_eq!(choose(None, BOTH), Encoding::Identity);
        assert_eq!(choose(Some("deflate"), BOTH), Encoding::Identity);
        assert_eq!(choose(Some(""), BOTH), Encoding::Identity);
        assert_eq!(choose(Some("br, gzip"), &[]), Encoding::Identity);
    }

    #[test]
    fn takes_only_encodings_the_file_has() {
        assert_eq!(choose(Some("br, gzip"), &[Encoding::Gzip]), Encoding::Gzip);
    }

    #[test]
    fn leaves_out_an_encoding_with_a_quality_of_zero() {
        assert_eq!(choose(Some("br;q=0, gzip"), BOTH), Encoding::Gzip);
        assert_eq!(
            choose(Some("br; q=0.0, gzip;q=0"), BOTH),
            Encoding::Identity
        );
        assert_eq!(choose(Some("br;q=0.5"), BOTH), Encoding::Brotli);
    }

    #[test]
    fn reads_the_wildcard_unless_an_encoding_is_named() {
        assert_eq!(choose(Some("*"), BOTH), Encoding::Brotli);
        assert_eq!(choose(Some("br;q=0, *"), BOTH), Encoding::Gzip);
        assert_eq!(choose(Some("*;q=0, gzip"), BOTH), Encoding::Gzip);
    }
}
