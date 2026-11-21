//! The server's secrets, kept apart from its configuration: today only its node's key. They're read
//! from where the platform keeps secrets for a service, systemd's credentials directory
//! (`$CREDENTIALS_DIRECTORY`, filled from `LoadCredential=`), which a container can provide the
//! same way by mounting a secret file and setting the variable. The configuration names no secret,
//! not even its path.
//!
//! The server never makes a secret itself: a missing key stops it, so a wrong path or a lost file
//! can't quietly give the server a new identity. `generate-node-key` makes one when the server is
//! set up (see Running it in crates/server/README.md).

use std::env::VarError;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};

use iroh::SecretKey;

/// The variable systemd sets to the folder of a service's credentials.
const DIRECTORY: &str = "CREDENTIALS_DIRECTORY";
/// The node key's file name in that folder.
const NODE_KEY: &str = "node-key";

/// Why a secret couldn't be read or made.
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error(
        "{DIRECTORY} isn't set: the server reads its node key from $CREDENTIALS_DIRECTORY/{NODE_KEY} (see crates/server/README.md)"
    )]
    NoDirectory,
    #[error("{DIRECTORY} is set to something that isn't UTF-8")]
    NotUnicode,
    #[error(
        "there's no node key at {0}; make one with `week-budget-planner-server generate-node-key <file>`"
    )]
    Missing(PathBuf),
    #[error("couldn't read the node key at {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{0} doesn't hold a node key: 64 hexadecimal digits")]
    Format(PathBuf),
    #[error("{0} exists already, and a node key is never written over")]
    Exists(PathBuf),
    #[error("couldn't write the new node key to {path}: {source}")]
    Write {
        path: PathBuf,
        source: std::io::Error,
    },
}

/// The folder of the server's credentials.
///
/// * `read_variable` - Gives an environment variable as `std::env::var` does. It only gets the
///   names this module declares, so they are `'static`, which lets `std::env::var` itself be passed.
///
/// # Errors
///
/// When `CREDENTIALS_DIRECTORY` isn't set, or isn't UTF-8.
pub(crate) fn find_directory(
    read_variable: impl Fn(&'static str) -> Result<String, VarError>,
) -> Result<PathBuf, Error> {
    match read_variable(DIRECTORY) {
        Ok(directory) => Ok(PathBuf::from(directory)),
        Err(VarError::NotPresent) => Err(Error::NoDirectory),
        Err(VarError::NotUnicode(_)) => Err(Error::NotUnicode),
    }
}

/// A key as its file holds it: its 32 bytes as 64 lowercase hexadecimal digits, and a line break.
fn format_key(key: &SecretKey) -> String {
    const DIGITS: &[u8; 16] = b"0123456789abcdef";
    let mut text = String::with_capacity(65);
    for byte in key.to_bytes() {
        text.push(char::from(DIGITS[usize::from(byte >> 4)]));
        text.push(char::from(DIGITS[usize::from(byte & 0x0f)]));
    }

    text.push('\n');
    text
}

/// A key from its file's text, or none when it isn't 64 hexadecimal digits.
fn parse_key(text: &str) -> Option<SecretKey> {
    let digits = text.trim().as_bytes();
    if digits.len() != 64 {
        return None;
    }

    let mut bytes = [0; 32];
    let (pairs, _) = digits.as_chunks::<2>();
    for (byte, pair) in bytes.iter_mut().zip(pairs) {
        *byte = u8::from_str_radix(std::str::from_utf8(pair).ok()?, 16).ok()?;
    }

    Some(SecretKey::from_bytes(&bytes))
}

/// The node's key from the credentials folder.
///
/// # Errors
///
/// When there's no key, it can't be read, or the file doesn't hold one.
pub(crate) fn read_node_key(directory: &Path) -> Result<SecretKey, Error> {
    let path = directory.join(NODE_KEY);
    let text = match std::fs::read_to_string(&path) {
        Ok(text) => text,
        Err(error) if error.kind() == ErrorKind::NotFound => return Err(Error::Missing(path)),
        Err(source) => return Err(Error::Read { path, source }),
    };
    parse_key(&text).ok_or(Error::Format(path))
}

/// Writes a key to a file that doesn't exist yet, readable by its owner only.
fn write_new_key(path: &Path, key: &SecretKey) -> std::io::Result<()> {
    let mut options = std::fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    std::os::unix::fs::OpenOptionsExt::mode(&mut options, 0o600);
    let mut file = options.open(path)?;
    file.write_all(format_key(key).as_bytes())?;
    file.sync_all()
}

/// Makes a new node key and writes it to a file that doesn't exist yet.
///
/// # Returns
///
/// The key, so its node id can be shown.
///
/// # Errors
///
/// When the file exists already, or can't be written.
pub(crate) fn generate_node_key(path: &Path) -> Result<SecretKey, Error> {
    let key = SecretKey::generate();
    match write_new_key(path, &key) {
        Ok(()) => Ok(key),
        Err(error) if error.kind() == ErrorKind::AlreadyExists => {
            Err(Error::Exists(path.to_path_buf()))
        }
        Err(source) => Err(Error::Write {
            path: path.to_path_buf(),
            source,
        }),
    }
}

#[cfg(test)]
mod test {
    use std::env::VarError;
    use std::path::PathBuf;

    use iroh::SecretKey;

    use super::{Error, find_directory, format_key, generate_node_key, parse_key, read_node_key};

    /// A folder of its own for a test, in the system's temporary folder.
    fn create_directory(name: &str) -> PathBuf {
        let directory = std::env::temp_dir().join(format!(
            "week-budget-planner-credentials-{name}-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&directory);
        std::fs::create_dir_all(&directory).unwrap();
        directory
    }

    #[test]
    fn finds_the_folder_systemd_names() {
        let directory = find_directory(|_| Ok("/run/credentials/server.service".to_owned()));
        assert_eq!(
            directory.unwrap(),
            PathBuf::from("/run/credentials/server.service")
        );
        assert!(matches!(
            find_directory(|_| Err(VarError::NotPresent)),
            Err(Error::NoDirectory)
        ));
    }

    #[test]
    fn writes_a_key_as_it_reads_it() {
        let key = SecretKey::generate();
        let text = format_key(&key);
        assert_eq!(text.len(), 65);
        assert_eq!(parse_key(&text).unwrap().public(), key.public());
        assert!(parse_key("").is_none());
        assert!(parse_key(&"0".repeat(63)).is_none());
        assert!(parse_key(&"g".repeat(64)).is_none());
    }

    #[test]
    fn reads_the_key_it_made_once_and_never_writes_over_it() {
        let directory = create_directory("generate");
        let path = directory.join("node-key");
        let generated = generate_node_key(&path).unwrap();
        assert_eq!(
            read_node_key(&directory).unwrap().public(),
            generated.public()
        );
        assert!(matches!(generate_node_key(&path), Err(Error::Exists(_))));
        assert_eq!(
            read_node_key(&directory).unwrap().public(),
            generated.public()
        );
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let permissions = std::fs::metadata(&path).unwrap().permissions().mode();
            assert_eq!(permissions & 0o777, 0o600);
        }

        std::fs::remove_dir_all(&directory).unwrap();
    }

    #[test]
    fn stops_without_a_key_instead_of_making_one() {
        let directory = create_directory("missing");
        assert!(matches!(read_node_key(&directory), Err(Error::Missing(_))));
        assert!(!directory.join("node-key").exists());
        std::fs::write(directory.join("node-key"), "not a key").unwrap();
        assert!(matches!(read_node_key(&directory), Err(Error::Format(_))));
        std::fs::remove_dir_all(&directory).unwrap();
    }
}
