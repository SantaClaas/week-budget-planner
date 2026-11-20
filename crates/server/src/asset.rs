//! The app's built files (`dist/`), read into memory when the server starts and compressed once
//! there, so no request waits for compression and none reads the disk.

pub(crate) mod encoding;

use std::collections::HashMap;
use std::hash::{DefaultHasher, Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};

use axum::body::Bytes;

use encoding::Encoding;

/// Why the app's files couldn't be read.
#[derive(Debug, thiserror::Error)]
pub(crate) enum Error {
    #[error("couldn't read {path}: {source}")]
    Read {
        path: PathBuf,
        source: std::io::Error,
    },
    #[error("{0} isn't a path the server can serve, since it isn't UTF-8")]
    Name(PathBuf),
}

/// How long a browser may keep a file before it asks again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum Caching {
    /// A file under `assets/`, whose name holds a hash of its content (Vite's): it never changes,
    /// so a browser keeps it for a year without asking.
    Immutable,
    /// Every other file, such as the page and the service worker: a browser asks each time, and
    /// gets "not modified" while its copy is current.
    Revalidate,
}

impl Caching {
    pub(crate) fn header(self) -> &'static str {
        match self {
            Self::Immutable => "public, max-age=31536000, immutable",
            Self::Revalidate => "no-cache",
        }
    }
}

/// One file's bytes, as they are and in each encoding that makes it smaller.
#[derive(Debug, Clone)]
pub(crate) struct Asset {
    pub(crate) content_type: &'static str,
    pub(crate) caching: Caching,
    /// A hash of the content, which each encoding's entity tag is made from.
    hash: u64,
    identity: Bytes,
    brotli: Option<Bytes>,
    gzip: Option<Bytes>,
}

impl Asset {
    /// The compressed encodings this file has.
    pub(crate) fn encodings(&self) -> Vec<Encoding> {
        [
            self.brotli.as_ref().map(|_| Encoding::Brotli),
            self.gzip.as_ref().map(|_| Encoding::Gzip),
        ]
        .into_iter()
        .flatten()
        .collect()
    }

    /// The bytes in an encoding, or as they are when it doesn't have that one.
    pub(crate) fn body(&self, encoding: Encoding) -> Bytes {
        let compressed = match encoding {
            Encoding::Brotli => self.brotli.as_ref(),
            Encoding::Gzip => self.gzip.as_ref(),
            Encoding::Identity => None,
        };
        compressed.unwrap_or(&self.identity).clone()
    }

    /// The strong entity tag of the bytes in an encoding: each encoding is a representation of its
    /// own, so each gets its own tag.
    pub(crate) fn entity_tag(&self, encoding: Encoding) -> String {
        match encoding {
            Encoding::Identity => format!("\"{:016x}\"", self.hash),
            Encoding::Brotli | Encoding::Gzip => {
                format!("\"{:016x}-{}\"", self.hash, encoding.token())
            }
        }
    }
}

/// The media type of a file, by its extension. A type nothing in the build uses is sent as plain
/// bytes, which `X-Content-Type-Options: nosniff` keeps the browser from guessing at.
fn find_content_type(path: &str) -> &'static str {
    let extension = path.rsplit_once('.').map_or("", |(_, extension)| extension);
    match extension {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" => "application/json",
        "webmanifest" => "application/manifest+json",
        "wasm" => "application/wasm",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "txt" => "text/plain; charset=utf-8",
        _ => "application/octet-stream",
    }
}

/// Whether compressing a type of file is worth it: text and WebAssembly shrink, while images and
/// fonts are compressed already.
fn is_compressible(content_type: &str) -> bool {
    content_type.starts_with("text/")
        || content_type.starts_with("application/json")
        || content_type.starts_with("application/manifest+json")
        || content_type == "application/wasm"
        || content_type == "image/svg+xml"
}

/// How hard Brotli works, from 0 to 11. Measured on the build's 11.6 MB WebAssembly module in a
/// release build: at 9 the server reads and compresses every file in about 4 seconds, and the module
/// shrinks to 3.1 MB. At 11 it hadn't finished after 100 seconds, and at 5 it takes half the time
/// for a module 5% bigger, which every first visit downloads.
const BROTLI_QUALITY: u32 = 9;
/// Brotli's window: 2^22 bytes, its largest outside the "large window" variant browsers don't read.
const BROTLI_WINDOW: u32 = 22;

fn compress_brotli(bytes: &[u8]) -> Vec<u8> {
    let mut compressed = Vec::new();
    {
        let mut writer = brotli::CompressorWriter::new(
            &mut compressed,
            64 * 1024,
            BROTLI_QUALITY,
            BROTLI_WINDOW,
        );
        // Writing to a Vec can't fail, so neither can the compressor that writes into it.
        writer.write_all(bytes).unwrap_or_default();
    }
    compressed
}

fn compress_gzip(bytes: &[u8]) -> Vec<u8> {
    let mut encoder = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::best());
    // Writing to a Vec can't fail, so neither can the encoder that writes into it.
    encoder.write_all(bytes).unwrap_or_default();
    encoder.finish().unwrap_or_default()
}

/// The compressed bytes, when they're smaller than the bytes as they are.
fn keep_smaller(compressed: Vec<u8>, original: &[u8]) -> Option<Bytes> {
    (!compressed.is_empty() && compressed.len() < original.len()).then(|| Bytes::from(compressed))
}

fn create_asset(path: &str, bytes: Vec<u8>) -> Asset {
    let content_type = find_content_type(path);
    let mut hasher = DefaultHasher::new();
    bytes.hash(&mut hasher);
    let is_worth_compressing = is_compressible(content_type);
    let brotli = is_worth_compressing
        .then(|| keep_smaller(compress_brotli(&bytes), &bytes))
        .flatten();
    let gzip = is_worth_compressing
        .then(|| keep_smaller(compress_gzip(&bytes), &bytes))
        .flatten();
    Asset {
        content_type,
        caching: if path.starts_with("assets/") {
            Caching::Immutable
        } else {
            Caching::Revalidate
        },
        hash: hasher.finish(),
        identity: Bytes::from(bytes),
        brotli,
        gzip,
    }
}

/// Every file of the app, by its path from the build folder, with `/` between the parts.
#[derive(Debug, Default)]
pub(crate) struct Assets(HashMap<String, Asset>);

impl Assets {
    /// Prepares the files to serve: each one's type, caching, tag and compressed bytes.
    ///
    /// * `files` - Each file's path from the build folder, with `/` between the parts, and bytes.
    pub(crate) fn new(files: impl IntoIterator<Item = (String, Vec<u8>)>) -> Self {
        Self(
            files
                .into_iter()
                .map(|(path, bytes)| {
                    let asset = create_asset(&path, bytes);
                    (path, asset)
                })
                .collect(),
        )
    }

    pub(crate) fn get(&self, path: &str) -> Option<&Asset> {
        self.0.get(path)
    }
}

/// Reads a folder and the folders in it, for [`Assets::new`].
///
/// # Errors
///
/// [`Error::Read`] when a folder or file can't be read, and [`Error::Name`] for a name that isn't
/// UTF-8, which no request could name.
pub(crate) fn read_directory(root: &Path) -> Result<Vec<(String, Vec<u8>)>, Error> {
    let mut files = Vec::new();
    let mut folders = vec![root.to_path_buf()];
    while let Some(folder) = folders.pop() {
        let entries = std::fs::read_dir(&folder).map_err(|source| Error::Read {
            path: folder.clone(),
            source,
        })?;
        for entry in entries {
            let entry = entry.map_err(|source| Error::Read {
                path: folder.clone(),
                source,
            })?;
            let path = entry.path();
            if path.is_dir() {
                folders.push(path);
                continue;
            }

            let relative = path
                .strip_prefix(root)
                .ok()
                .and_then(Path::to_str)
                .ok_or_else(|| Error::Name(path.clone()))?
                .replace(std::path::MAIN_SEPARATOR, "/");
            let bytes = std::fs::read(&path).map_err(|source| Error::Read {
                path: path.clone(),
                source,
            })?;
            files.push((relative, bytes));
        }
    }

    Ok(files)
}

#[cfg(test)]
mod test {
    use super::{Assets, Caching, Encoding, find_content_type};

    fn create(path: &str, bytes: &[u8]) -> Assets {
        Assets::new([(path.to_owned(), bytes.to_vec())])
    }

    #[test]
    fn knows_the_types_the_build_makes() {
        assert_eq!(find_content_type("index.html"), "text/html; charset=utf-8");
        assert_eq!(
            find_content_type("assets/index-D0LmUKDL.js"),
            "text/javascript; charset=utf-8"
        );
        assert_eq!(find_content_type("assets/turso.wasm"), "application/wasm");
        assert_eq!(find_content_type("assets/font.woff2"), "font/woff2");
        assert_eq!(find_content_type("_headers"), "application/octet-stream");
    }

    #[test]
    fn keeps_hashed_files_for_a_year_and_asks_again_for_the_rest() {
        let assets = Assets::new([
            ("assets/index-D0LmUKDL.js".to_owned(), b"let a;".to_vec()),
            ("index.html".to_owned(), b"<!doctype html>".to_vec()),
            ("service-worker.js".to_owned(), b"self;".to_vec()),
        ]);
        let caching = |path| assets.get(path).unwrap().caching;
        assert_eq!(caching("assets/index-D0LmUKDL.js"), Caching::Immutable);
        assert_eq!(caching("index.html"), Caching::Revalidate);
        assert_eq!(caching("service-worker.js"), Caching::Revalidate);
    }

    #[test]
    fn compresses_text_that_shrinks() {
        let text = "let block = 1;\n".repeat(200);
        let assets = create("assets/a.js", text.as_bytes());
        let asset = assets.get("assets/a.js").unwrap();
        assert_eq!(asset.encodings(), [Encoding::Brotli, Encoding::Gzip]);
        let mut decompressed = Vec::new();
        brotli::BrotliDecompress(&mut &asset.body(Encoding::Brotli)[..], &mut decompressed)
            .unwrap();
        assert_eq!(decompressed, text.as_bytes());
        assert_eq!(asset.body(Encoding::Identity), text.as_bytes());
    }

    #[test]
    fn leaves_files_as_they_are_where_compressing_doesnt_help() {
        let tiny = create("a.js", b"1");
        assert!(tiny.get("a.js").unwrap().encodings().is_empty());
        let image = create("a.png", &[0; 4096]);
        assert!(image.get("a.png").unwrap().encodings().is_empty());
    }

    #[test]
    fn tags_each_encoding_and_each_content_apart() {
        let text = "let block = 1;\n".repeat(200);
        let first = create("a.js", text.as_bytes());
        let first = first.get("a.js").unwrap();
        let changed = create("a.js", format!("{text}2").as_bytes());
        let changed = changed.get("a.js").unwrap();
        assert_ne!(
            first.entity_tag(Encoding::Identity),
            first.entity_tag(Encoding::Brotli)
        );
        assert_ne!(
            first.entity_tag(Encoding::Brotli),
            first.entity_tag(Encoding::Gzip)
        );
        assert_ne!(
            first.entity_tag(Encoding::Identity),
            changed.entity_tag(Encoding::Identity)
        );
        assert!(first.entity_tag(Encoding::Identity).starts_with('"'));
    }
}
