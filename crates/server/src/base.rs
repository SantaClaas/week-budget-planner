//! The path the app is served under, such as `/` or `/week-budget-planner/`: the base the app was
//! built for (Vite's `base`), so its pages and files are found under it.

/// Why a base isn't one.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum Error {
    #[error("the base must start and end with a slash, like / or /week-budget-planner/: {0:?}")]
    Slashes(String),
}

/// A path that starts and ends with a slash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Base(String);

impl Base {
    /// Checks a base as it's written in the configuration.
    ///
    /// # Errors
    ///
    /// [`Error::Slashes`] when it doesn't start and end with a slash.
    pub(crate) fn parse(text: &str) -> Result<Self, Error> {
        if !text.starts_with('/') || !text.ends_with('/') {
            return Err(Error::Slashes(text.to_owned()));
        }

        Ok(Self(text.to_owned()))
    }

    /// What follows the base in a request's path, or `None` for a path that isn't under it. The
    /// base without its last slash counts as the base itself, as the app reads a typed address.
    pub(crate) fn strip<'path>(&self, path: &'path str) -> Option<&'path str> {
        if path.len() + 1 == self.0.len() && self.0.starts_with(path) {
            return Some("");
        }

        path.strip_prefix(self.0.as_str())
    }
}

#[cfg(test)]
mod test {
    use super::{Base, Error};

    #[test]
    fn takes_a_path_between_slashes() {
        assert!(Base::parse("/").is_ok());
        assert!(Base::parse("/week-budget-planner/").is_ok());
    }

    #[test]
    fn refuses_a_path_without_its_slashes() {
        for text in ["", "week-budget-planner/", "/week-budget-planner"] {
            assert_eq!(Base::parse(text), Err(Error::Slashes(text.to_owned())));
        }
    }

    #[test]
    fn strips_itself_from_paths_under_it() {
        let base = Base::parse("/week-budget-planner/").unwrap();
        assert_eq!(base.strip("/week-budget-planner/"), Some(""));
        assert_eq!(base.strip("/week-budget-planner"), Some(""));
        assert_eq!(
            base.strip("/week-budget-planner/settings"),
            Some("settings")
        );
        assert_eq!(
            base.strip("/week-budget-planner/assets/a.js"),
            Some("assets/a.js")
        );
        assert_eq!(base.strip("/other/settings"), None);
        assert_eq!(base.strip("/week-budget-plannerx"), None);
        assert_eq!(base.strip("/"), None);
    }

    #[test]
    fn strips_the_root_from_every_path() {
        let base = Base::parse("/").unwrap();
        assert_eq!(base.strip("/"), Some(""));
        assert_eq!(base.strip("/activities"), Some("activities"));
    }
}
