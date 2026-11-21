import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { brotliDecompressSync, gunzipSync, zstdDecompressSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import { compressFolder, isCompressible } from "./compress.ts";

describe("compressing the build", () => {
  it("compresses text and WebAssembly, not images, fonts or its own copies", () => {
    expect(isCompressible("index.html")).toBe(true);
    expect(isCompressible("assets/index-D0LmUKDL.js")).toBe(true);
    expect(isCompressible("assets/turso.wasm32-wasi-KrOvB4jh.wasm")).toBe(true);
    expect(isCompressible("assets/font.woff2")).toBe(false);
    expect(isCompressible("icon.png")).toBe(false);
    expect(isCompressible("assets/index-D0LmUKDL.js.br")).toBe(false);
    expect(isCompressible("_headers")).toBe(false);
  });

  it("writes each encoding next to a file that shrinks, and nothing for one that doesn't", async () => {
    const folder = await mkdtemp(join(tmpdir(), "week-budget-planner-compress-"));
    const cache = await mkdtemp(join(tmpdir(), "week-budget-planner-compress-cache-"));
    await mkdir(join(folder, "assets"));
    const script = "let block = 1;\n".repeat(200);
    await writeFile(join(folder, "assets", "index.js"), script);
    await writeFile(join(folder, "tiny.js"), "1");
    await writeFile(join(folder, "image.png"), Buffer.alloc(4096));

    expect(await compressFolder(folder, cache)).toBe(3);
    expect((await readdir(join(folder, "assets"))).toSorted()).toEqual([
      "index.js",
      "index.js.br",
      "index.js.gz",
      "index.js.zst",
    ]);
    const path = join(folder, "assets", "index.js");
    expect(brotliDecompressSync(await readFile(`${path}.br`)).toString()).toBe(script);
    expect(zstdDecompressSync(await readFile(`${path}.zst`)).toString()).toBe(script);
    expect(gunzipSync(await readFile(`${path}.gz`)).toString()).toBe(script);
    expect((await readdir(folder)).toSorted()).toEqual(["assets", "image.png", "tiny.js"]);

    // A second run leaves its own copies alone and writes the same ones again.
    expect(await compressFolder(folder, cache)).toBe(3);
  });

  it("takes a copy from the cache for content it compressed before, and only then", async () => {
    const folder = await mkdtemp(join(tmpdir(), "week-budget-planner-compress-"));
    const cache = await mkdtemp(join(tmpdir(), "week-budget-planner-compress-cache-"));
    const path = join(folder, "index.js");
    const script = "let block = 1;\n".repeat(200);
    await writeFile(path, script);
    await compressFolder(folder, cache);
    const cachedBrotli = String((await readdir(cache)).find((name) => name.endsWith(".br-11")));

    // Changing the cached copy shows the next run reads it instead of compressing again.
    await writeFile(join(cache, cachedBrotli), "from the cache");
    await compressFolder(folder, cache);
    expect((await readFile(`${path}.br`)).toString()).toBe("from the cache");

    // New content gets copies of its own, and the cache lets go of the old content's.
    const changed = "let slot = 2;\n".repeat(200);
    await writeFile(path, changed);
    await compressFolder(folder, cache);
    expect(brotliDecompressSync(await readFile(`${path}.br`)).toString()).toBe(changed);
    const names = await readdir(cache);
    expect(names).toHaveLength(3);
    expect(names).not.toContain(cachedBrotli);
  });
});
