// Builds src/icons/iconset.svg from the official Material Symbols SVGs listed in icons/icons.json.
//
//   node scripts/build-iconset.ts --fetch   download missing SVGs from Google's repository, then build
//   node scripts/build-iconset.ts           build from the SVGs already in icons/material-symbols/
//
// Each icon is optimized with SVGO and becomes a <symbol> filled with currentColor. The app bundles
// the sprite (`import iconset from "./icons/iconset.svg?raw"`) and inserts it into the page once,
// so <svg class="icon" aria-hidden="true"><use href="#undo"/></svg> shows an icon in the text color
// of the element around it. The sprite's root is hidden with display: none (the hidden attribute
// doesn't hide an <svg>) and kept out of the accessibility tree.

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { optimize } from "svgo";

type Manifest = {
  source: { repository: string; commit: string; style: string };
  icons: { name: string; fill: boolean }[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Checks the manifest's shape, since JSON.parse can't. */
function readManifest(value: unknown): Manifest {
  const source = isRecord(value) ? value["source"] : undefined;
  const icons = isRecord(value) ? value["icons"] : undefined;
  if (
    !isRecord(source) ||
    typeof source["repository"] !== "string" ||
    typeof source["commit"] !== "string" ||
    typeof source["style"] !== "string" ||
    !Array.isArray(icons)
  ) {
    throw new Error(
      "icons/icons.json needs a source (repository, commit, style) and a list of icons.",
    );
  }
  return {
    source: { repository: source["repository"], commit: source["commit"], style: source["style"] },
    icons: icons.map((icon: unknown) => {
      if (!isRecord(icon) || typeof icon["name"] !== "string") {
        throw new Error(`An icon in icons/icons.json has no name: ${JSON.stringify(icon)}`);
      }
      return { name: icon["name"], fill: icon["fill"] === true };
    }),
  };
}

const root = new URL("../", import.meta.url);
const manifest = readManifest(
  JSON.parse(await readFile(new URL("icons/icons.json", root), "utf8")),
);
const sourceDir = new URL("icons/material-symbols/", root);
const output = new URL("src/icons/iconset.svg", root);

const { repository, commit, style } = manifest.source;

/** One entry per file: the outline, plus the filled variant when asked for. */
const variants = manifest.icons.flatMap(({ name, fill }) => {
  const outline = { id: name, file: `${name}_24px.svg`, name };
  return fill ? [outline, { id: `${name}-fill`, file: `${name}_fill1_24px.svg`, name }] : [outline];
});

if (process.argv.includes("--fetch")) {
  await mkdir(sourceDir, { recursive: true });
  for (const { file, name } of variants) {
    const target = new URL(file, sourceDir);
    if (await exists(target)) continue;
    const url = `https://raw.githubusercontent.com/${repository}/${commit}/symbols/web/${name}/${style}/${file}`;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't download ${url}: ${response.status}`);
    await writeFile(target, await response.text());
    console.log(`fetched ${file}`);
  }
}

const symbols: string[] = [];
for (const { id, file } of variants) {
  const source = await readFile(new URL(file, sourceDir), "utf8").catch(() => {
    throw new Error(`Missing icons/material-symbols/${file}. Run \`pnpm icons:fetch\`.`);
  });
  const { data } = optimize(source, {
    multipass: true,
    plugins: ["preset-default", "removeDimensions"],
  });
  const match = /^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/u.exec(data);
  const viewBox = match?.[1];
  const body = match?.[2];
  if (viewBox === undefined || body === undefined)
    throw new Error(`Unexpected SVG shape in ${file}: ${data}`);
  // The icons are single-color glyphs. Anything else would ignore currentColor.
  if (/fill=|style=|<(?!path)/u.test(body))
    throw new Error(`${file} has more than plain paths: ${body}`);

  symbols.push(`<symbol id="${id}" viewBox="${viewBox}" fill="currentColor">${body}</symbol>`);
}

const iconset = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display: none">\n${symbols.join("\n")}\n</svg>\n`;

await mkdir(new URL("src/icons/", root), { recursive: true });
await writeFile(output, iconset);
console.log(`wrote src/icons/iconset.svg with ${variants.length} icons (${iconset.length} bytes)`);

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}
