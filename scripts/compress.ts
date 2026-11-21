// Compresses the app's build for the server, once, at build time: next to each file that shrinks, a
// Brotli (`.br`), a zstd (`.zst`) and a gzip (`.gz`) copy, which the server sends to a browser that
// takes it (see crates/server/README.md). The idea is from pumpe in SantaClaas/meal, which asks
// tower-http's compression for the same files; Node's own zlib does it here, so the app's build
// needs no Rust, and each algorithm runs at its smallest setting, since time at build costs no
// visitor anything.
//
//   node scripts/compress.ts dist
//
// Brotli at 11 takes about 33 s on the database engine's 11.6 MB WebAssembly module, and under 2 s
// on everything else together. So each copy is kept in a cache by the hash of its file's content,
// and a file that hasn't changed, like the module between engine updates, is compressed only once.
//
// GitHub Pages compresses on its own and ignores these files, so only builds for the server run it.

import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { brotliCompress, constants, gzip, zstdCompress } from "node:zlib";

/** The extensions of files worth compressing: text and WebAssembly shrink, images and fonts don't. */
const COMPRESSIBLE = new Set([
  "css",
  "html",
  "js",
  "json",
  "mjs",
  "svg",
  "txt",
  "wasm",
  "webmanifest",
  "xml",
]);

/** Whether a file is worth compressing, by its extension. */
export function isCompressible(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") && COMPRESSIBLE.has(extension);
}

const compressBrotli = promisify(brotliCompress);
const compressZstd = promisify(zstdCompress);
const compressGzip = promisify(gzip);

/**
 * The encodings, each at its smallest setting. On the build's 11.6 MB WebAssembly module, Brotli at
 * 11 takes about 33 s and gives 2.7 MB (3.1 MB at 9), zstd at 19 about 5 s and 2.9 MB, and gzip at
 * 9 half a second and 4.0 MB. A copy's name in the cache ends in its `setting`, so changing one
 * makes new copies instead of reusing ones made with the old setting.
 */
const ENCODINGS = [
  {
    extension: "br",
    setting: "br-11",
    compress: (bytes: Buffer) =>
      compressBrotli(bytes, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
          [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
        },
      }),
  },
  {
    extension: "zst",
    setting: "zst-19",
    compress: (bytes: Buffer) =>
      compressZstd(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }),
  },
  {
    extension: "gz",
    setting: "gz-9",
    compress: (bytes: Buffer) => compressGzip(bytes, { level: constants.Z_BEST_COMPRESSION }),
  },
] as const;

/** Where copies are kept between runs, as build tools keep theirs. */
const CACHE = "node_modules/.cache/compress";

/** A copy from the cache, or undefined when it isn't there yet. */
async function readCached(path: string): Promise<Buffer | undefined> {
  let cached: Buffer | undefined;
  try {
    cached = await readFile(path);
  } catch {
    // Not in the cache (or unreadable there): it's made again, which is always right.
    return undefined;
  }

  return cached;
}

/**
 * A file in one encoding: from the cache when a copy of the same content is there, or compressed
 * and kept there.
 *
 * @param hash - The SHA-256 of the file's content, in hex.
 * @returns The copy, its extension next to the file, and its name in the cache.
 */
async function compressCached(
  bytes: Buffer,
  hash: string,
  encoding: (typeof ENCODINGS)[number],
  cache: string,
): Promise<{ compressed: Buffer; extension: string; name: string }> {
  const { extension } = encoding;
  const name = `${hash}.${encoding.setting}`;
  const cached = await readCached(join(cache, name));
  if (cached !== undefined) return { compressed: cached, extension, name };

  const compressed = await encoding.compress(bytes);
  await writeFile(join(cache, name), compressed);
  return { compressed, extension, name };
}

/** Every file in a folder and the folders in it. */
async function listFiles(folder: string): Promise<string[]> {
  const entries = await readdir(folder, { withFileTypes: true, recursive: true });
  return entries
    .values()
    .filter((entry) => entry.isFile())
    .map((entry) => join(entry.parentPath, entry.name))
    .toArray();
}

/**
 * Writes the compressed copies of every compressible file in a folder, each only where it's
 * smaller than the file. Copies come from the cache where the same content was compressed before,
 * and the cache keeps only what this run used, so it holds one build's copies.
 *
 * @param cache - The folder of the cache, made if it isn't there.
 * @returns How many copies it wrote.
 */
export async function compressFolder(folder: string, cache = CACHE): Promise<number> {
  await mkdir(cache, { recursive: true });
  const files = (await listFiles(folder)).filter((path) => isCompressible(path));
  const used = new Set<string>();
  const counts = await Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(path);
      const hash = createHash("sha256").update(bytes).digest("hex");
      const copies = await Promise.all(
        ENCODINGS.map((encoding) => compressCached(bytes, hash, encoding, cache)),
      );
      for (const { name } of copies) used.add(name);

      const smaller = copies.filter(({ compressed }) => compressed.length < bytes.length);
      await Promise.all(
        smaller.map(({ extension, compressed }) => writeFile(`${path}.${extension}`, compressed)),
      );
      return smaller.length;
    }),
  );
  const unused = (await readdir(cache)).filter((name) => !used.has(name));
  await Promise.all(unused.map((name) => rm(join(cache, name))));
  return counts.reduce((sum, count) => sum + count, 0);
}

if (import.meta.main) {
  const [folder] = process.argv.slice(2);
  if (folder === undefined)
    throw new Error("Name the folder to compress: node scripts/compress.ts dist");

  const started = performance.now();
  const count = await compressFolder(folder);
  console.log(
    `Wrote ${count.toString()} compressed copies in ${folder} in ${Math.round((performance.now() - started) / 1000).toString()} s.`,
  );
}
