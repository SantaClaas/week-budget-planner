//! Where the server listens and what it serves, from environment variables, each with a default
//! for running it next to a fresh build (see crates/server/README.md).

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
    #[error("{ADDRESS} isn't an address and port to listen on, like 127.0.0.1:8080: {0:?}")]
    Address(String),
    #[error("{BASE}: {0}")]
    Base(#[from] base::Error),
}

#[derive(Debug, PartialEq, Eq)]
pub(crate) struct Config {
    pub(crate) address: SocketAddr,
    pub(crate) app: PathBuf,
    pub(crate) base: Base,
}

/// Reads the configuration.
///
/// * `read_variable` - Gives an environment variable's value, or `None` when it isn't set.
///
/// # Errors
///
/// When the address or the base is set to something that isn't one.
pub(crate) fn read(read_variable: impl Fn(&str) -> Option<String>) -> Result<Config, Error> {
    let address = read_variable(ADDRESS).unwrap_or_else(|| "127.0.0.1:8080".to_owned());
    let address = address.parse().map_err(|_| Error::Address(address))?;
    let app = read_variable(APP).map_or_else(|| PathBuf::from("dist"), PathBuf::from);
    let base = Base::parse(&read_variable(BASE).unwrap_or_else(|| "/".to_owned()))?;
    Ok(Config { address, app, base })
}

#[cfg(test)]
mod test {
    use std::path::PathBuf;

    use super::{Config, Error, read};
    use crate::base::{self, Base};

    #[test]
    fn serves_a_fresh_build_on_this_machine_by_default() {
        assert_eq!(
            read(|_| None),
            Ok(Config {
                address: "127.0.0.1:8080".parse().unwrap(),
                app: PathBuf::from("dist"),
                base: Base::parse("/").unwrap(),
            })
        );
    }

    #[test]
    fn reads_each_variable() {
        let config = read(|name| match name {
            "WEEK_BUDGET_PLANNER_ADDRESS" => Some("0.0.0.0:4313".to_owned()),
            "WEEK_BUDGET_PLANNER_APP" => Some("/srv/app".to_owned()),
            "WEEK_BUDGET_PLANNER_BASE" => Some("/week-budget-planner/".to_owned()),
            _ => None,
        })
        .unwrap();
        assert_eq!(config.address, "0.0.0.0:4313".parse().unwrap());
        assert_eq!(config.app, PathBuf::from("/srv/app"));
        assert_eq!(config.base, Base::parse("/week-budget-planner/").unwrap());
    }

    #[test]
    fn refuses_what_isn_t_an_address_or_a_base() {
        let address =
            read(|name| (name == "WEEK_BUDGET_PLANNER_ADDRESS").then(|| "8080".to_owned()));
        assert_eq!(address, Err(Error::Address("8080".to_owned())));
        let base = read(|name| (name == "WEEK_BUDGET_PLANNER_BASE").then(|| "app".to_owned()));
        assert_eq!(
            base,
            Err(Error::Base(base::Error::Slashes("app".to_owned())))
        );
    }
}
