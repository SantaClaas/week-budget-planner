// Builds public/iconset.svg from the official Material Symbols SVGs listed in icons/icons.json.
//
//   node scripts/build-iconset.mjs --fetch   download missing SVGs from Google's repository, then build
//   node scripts/build-iconset.mjs           build from the SVGs already in icons/material-symbols/
//
// Each icon is optimized with SVGO, then placed in one SVG with a <view> per icon, so
// <img src="/iconset.svg#undo" alt=""> shows just that icon.

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { optimize } from "svgo";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(await readFile(new URL("icons/icons.json", root), "utf8"));
const sourceDir = new URL("icons/material-symbols/", root);
const output = new URL("public/iconset.svg", root);

// Each icon is a 24×24 cell in its own row, with a gap so neighbors never bleed into a view.
const SIZE = 24;
const ROW = 32;

// Icon color: on-surface-variant from docs/design/m3-tokens.css, light and dark.
const LIGHT = "#45464f";
const DARK = "#c6c5d0";

const { repository, commit, style } = manifest.source;

/** One entry per file: the outline, plus the filled variant when asked for. */
const variants = manifest.icons.flatMap(({ name, fill }) => [
  { id: name, file: `${name}_24px.svg`, name },
  ...(fill ? [{ id: `${name}-fill`, file: `${name}_fill1_24px.svg`, name }] : []),
]);

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

const rows = [];
for (const [index, { id, file }] of variants.entries()) {
  const source = await readFile(new URL(file, sourceDir), "utf8").catch(() => {
    throw new Error(`Missing icons/material-symbols/${file}. Run \`pnpm icons:fetch\`.`);
  });
  const { data } = optimize(source, {
    multipass: true,
    plugins: ["preset-default", "removeDimensions"],
  });
  const match = data.match(/^<svg[^>]*viewBox="([^"]+)"[^>]*>([\s\S]*)<\/svg>$/);
  if (!match) throw new Error(`Unexpected SVG shape in ${file}: ${data}`);
  const [, viewBox, body] = match;
  // The icons are single-color glyphs. Anything else would ignore the iconset's fill.
  if (/fill=|style=|<(?!path)/.test(body)) throw new Error(`${file} has more than plain paths: ${body}`);

  const y = index * ROW;
  rows.push(
    `<view id="${id}" viewBox="0 ${y} ${SIZE} ${SIZE}"/>` +
      `<svg y="${y}" width="${SIZE}" height="${SIZE}" viewBox="${viewBox}">${body}</svg>`,
  );
}

const height = (variants.length - 1) * ROW + SIZE;
const iconset =
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${SIZE} ${height}">` +
  `<style>:root{fill:${LIGHT}}@media (prefers-color-scheme:dark){:root{fill:${DARK}}}</style>\n` +
  rows.join("\n") +
  `\n</svg>\n`;

await mkdir(new URL("public/", root), { recursive: true });
await writeFile(output, iconset);
console.log(`wrote public/iconset.svg with ${variants.length} icons (${iconset.length} bytes)`);

async function exists(url) {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}
