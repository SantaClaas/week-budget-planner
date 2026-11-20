// Compresses the app's build for the server, once, at build time: next to each file that shrinks, a
// Brotli (`.br`), a zstd (`.zst`) and a gzip (`.gz`) copy, which the server sends to a browser that
// takes it (see crates/server/README.md). The idea is from pumpe in SantaClaas/meal, which asks
// tower-http's compression for the same files; Node's own zlib does it here, so the app's build
// needs no Rust, and each algorithm runs at its smallest setting, since time at build costs no
// visitor anything.
//
//   node scripts/compress.ts dist
//
// GitHub Pages compresses on its own and ignores these files, so only builds for the server run it.

import { readdir, readFile, writeFile } from "node:fs/promises";
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

/** The extensions this script writes, so a second run doesn't compress its own output. */
const COMPRESSED = ["br", "zst", "gz"] as const;

/** Whether a file is worth compressing, by its extension. */
export function isCompressible(path: string): boolean {
  const extension = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  return path.includes(".") && COMPRESSIBLE.has(extension);
}

const compressBrotli = promisify(brotliCompress);
const compressZstd = promisify(zstdCompress);
const compressGzip = promisify(gzip);

/**
 * The file in each encoding, at each one's smallest setting. On the build's 11.6 MB WebAssembly
 * module, Brotli at 11 takes about 33 s and gives 2.7 MB (3.1 MB at 9), zstd at 19 about 5 s and
 * 2.9 MB, and gzip at 9 half a second and 4.0 MB.
 */
async function compress(bytes: Buffer): Promise<Record<(typeof COMPRESSED)[number], Buffer>> {
  const [br, zst, gz] = await Promise.all([
    compressBrotli(bytes, {
      params: {
        [constants.BROTLI_PARAM_QUALITY]: constants.BROTLI_MAX_QUALITY,
        [constants.BROTLI_PARAM_SIZE_HINT]: bytes.length,
      },
    }),
    compressZstd(bytes, { params: { [constants.ZSTD_c_compressionLevel]: 19 } }),
    compressGzip(bytes, { level: constants.Z_BEST_COMPRESSION }),
  ]);
  return { br, zst, gz };
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
 * smaller than the file.
 *
 * @returns How many copies it wrote.
 */
export async function compressFolder(folder: string): Promise<number> {
  const files = (await listFiles(folder)).filter((path) => isCompressible(path));
  const counts = await Promise.all(
    files.map(async (path) => {
      const bytes = await readFile(path);
      const copies = Object.entries(await compress(bytes)).filter(
        ([, compressed]) => compressed.length < bytes.length,
      );
      await Promise.all(
        copies.map(([extension, compressed]) => writeFile(`${path}.${extension}`, compressed)),
      );
      return copies.length;
    }),
  );
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
