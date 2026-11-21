//! Where the server listens and what it serves, from environment variables, each with a default
//! for running it next to a fresh build (see crates/server/README.md).

use std::env::VarError;
use std::net::SocketAddr;
use std::path::PathBuf;

use crate::base::{self, Base};

/// The address and port to listen on.
const ADDRESS: &str = "WEEK_BUDGET_PLANNER_ADDRESS";
/// The folder of the app's build.
const APP: &str = "WEEK_BUDGET_PLANNER_APP";
/// The path the app was built for (Vite's `base`).
const BASE: &str = "WEEK_BUDGET_PLANNER_BASE";

/// Why the configuration can't be used.
#[derive(Debug, PartialEq, Eq, thiserror::Error)]
pub(crate) enum Error {
    #[error("{0} is set to something that isn't UTF-8")]
    NotUnicode(&'static str),
    #[error("{ADDRESS} isn't an address and port to listen on, like 127.0.0.1:8080: {0:?}")]
    Address(String),
    #[error("{BASE}: {0}")]
    Base(#[from] base::Error),
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Configuration {
    pub(crate) address: SocketAddr,
    pub(crate) app: PathBuf,
    pub(crate) base: Base,
}

/// A variable's value, or its default when it isn't set.
///
/// # Errors
///
/// [`Error::NotUnicode`] when it's set to something that isn't UTF-8: falling back to the default
/// then would quietly serve something other than what was asked for.
fn read_or(
    read_variable: &impl Fn(&'static str) -> Result<String, VarError>,
    name: &'static str,
    default: &str,
) -> Result<String, Error> {
    match read_variable(name) {
        Ok(value) => Ok(value),
        Err(VarError::NotPresent) => Ok(default.to_owned()),
        Err(VarError::NotUnicode(_)) => Err(Error::NotUnicode(name)),
    }
}

/// Reads the configuration.
///
/// * `read_variable` - Gives an environment variable as `std::env::var` does. It only gets the
///   names this module declares, so they are `'static`, which lets `std::env::var` itself be passed.
///
/// # Errors
///
/// When a variable isn't UTF-8, or the address or the base is set to something that isn't one.
pub(crate) fn read(
    read_variable: impl Fn(&'static str) -> Result<String, VarError>,
) -> Result<Configuration, Error> {
    let address = read_or(&read_variable, ADDRESS, "127.0.0.1:8080")?;
    let address = address.parse().map_err(|_| Error::Address(address))?;
    let app = PathBuf::from(read_or(&read_variable, APP, "dist")?);
    let base = Base::parse(&read_or(&read_variable, BASE, "/")?)?;
    Ok(Configuration { address, app, base })
}

#[cfg(test)]
mod test {
    use std::env::VarError;
    use std::ffi::OsString;
    use std::path::PathBuf;

    use super::{Configuration, Error, read};
    use crate::base::{self, Base};

    /// Reads one variable as set to `value`, and every other as not set.
    fn set(
        name: &'static str,
        value: &'static str,
    ) -> impl Fn(&'static str) -> Result<String, VarError> {
        move |asked| {
            if asked == name {
                return Ok(value.to_owned());
            }

            Err(VarError::NotPresent)
        }
    }

    #[test]
    fn serves_a_fresh_build_on_this_machine_by_default() {
        assert_eq!(
            read(|_| Err(VarError::NotPresent)),
            Ok(Configuration {
                address: "127.0.0.1:8080".parse().unwrap(),
                app: PathBuf::from("dist"),
                base: Base::parse("/").unwrap(),
            })
        );
    }

    #[test]
    fn reads_each_variable() {
        let configuration = read(|name| match name {
            "WEEK_BUDGET_PLANNER_ADDRESS" => Ok("0.0.0.0:4313".to_owned()),
            "WEEK_BUDGET_PLANNER_APP" => Ok("/srv/app".to_owned()),
            "WEEK_BUDGET_PLANNER_BASE" => Ok("/week-budget-planner/".to_owned()),
            _ => Err(VarError::NotPresent),
        })
        .unwrap();
        assert_eq!(configuration.address, "0.0.0.0:4313".parse().unwrap());
        assert_eq!(configuration.app, PathBuf::from("/srv/app"));
        assert_eq!(
            configuration.base,
            Base::parse("/week-budget-planner/").unwrap()
        );
    }

    #[test]
    fn refuses_what_isn_t_an_address_or_a_base() {
        let address = read(set("WEEK_BUDGET_PLANNER_ADDRESS", "8080"));
        assert_eq!(address, Err(Error::Address("8080".to_owned())));
        let base = read(set("WEEK_BUDGET_PLANNER_BASE", "app"));
        assert_eq!(
            base,
            Err(Error::Base(base::Error::Slashes("app".to_owned())))
        );
    }

    #[test]
    fn refuses_a_variable_that_isn_t_utf_8_instead_of_taking_the_default() {
        let configuration = read(|name| {
            if name == "WEEK_BUDGET_PLANNER_APP" {
                return Err(VarError::NotUnicode(OsString::from("not checked here")));
            }

            Err(VarError::NotPresent)
        });
        assert_eq!(
            configuration,
            Err(Error::NotUnicode("WEEK_BUDGET_PLANNER_APP"))
        );
    }
}
