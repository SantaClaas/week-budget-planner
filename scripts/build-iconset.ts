// Builds src/icons/iconset.svg from the official Material Symbols SVGs listed in icons/icons.json,
// plus the few brand marks it lists, each from its owner's own repository (see Deviations in
// docs/spec/design.md).
//
//   node scripts/build-iconset.ts --fetch   download missing SVGs from those repositories, then build
//   node scripts/build-iconset.ts           build from the SVGs already in icons/
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
  brands: Brand[];
};

/**
 * A brand mark from its owner's repository. `padding` widens its viewBox on every side, in its own
 * units, for marks drawn edge to edge, so they match Material's 20 of 24 drawn area.
 */
type Brand = { name: string; repository: string; commit: string; path: string; padding: number };

function readBrand(brand: unknown): Brand {
  if (
    !isRecord(brand) ||
    typeof brand["name"] !== "string" ||
    typeof brand["repository"] !== "string" ||
    typeof brand["commit"] !== "string" ||
    typeof brand["path"] !== "string"
  ) {
    throw new Error(
      `A brand in icons/icons.json needs a name, repository, commit and path: ${JSON.stringify(brand)}`,
    );
  }
  return {
    name: brand["name"],
    repository: brand["repository"],
    commit: brand["commit"],
    path: brand["path"],
    padding: typeof brand["padding"] === "number" ? brand["padding"] : 0,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

/** Checks the manifest's shape, since JSON.parse can't. */
function readManifest(value: unknown): Manifest {
  const source = isRecord(value) ? value["source"] : undefined;
  const icons = isRecord(value) ? value["icons"] : undefined;
  const brands = isRecord(value) ? (value["brands"] ?? []) : [];
  if (
    !isRecord(source) ||
    typeof source["repository"] !== "string" ||
    typeof source["commit"] !== "string" ||
    typeof source["style"] !== "string" ||
    !Array.isArray(icons) ||
    !Array.isArray(brands)
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
    brands: brands.map((brand: unknown) => readBrand(brand)),
  };
}

const root = new URL("../", import.meta.url);
const manifest = readManifest(
  JSON.parse(await readFile(new URL("icons/icons.json", root), "utf8")),
);
const iconsDir = new URL("icons/", root);
const output = new URL("src/icons/iconset.svg", root);

const { repository, commit, style } = manifest.source;

/** One entry per file: the outline, plus the filled variant when asked for, then the brand marks. */
const variants = [
  ...manifest.icons.flatMap(({ name, fill }) => {
    const variant = (id: string, file: string) => ({
      id,
      file: `material-symbols/${file}`,
      url: `https://raw.githubusercontent.com/${repository}/${commit}/symbols/web/${name}/${style}/${file}`,
      padding: 0,
    });
    const outline = variant(name, `${name}_24px.svg`);
    return fill ? [outline, variant(`${name}-fill`, `${name}_fill1_24px.svg`)] : [outline];
  }),
  ...manifest.brands.map((brand) => ({
    id: brand.name,
    file: `brands/${brand.name}.svg`,
    url: `https://raw.githubusercontent.com/${brand.repository}/${brand.commit}/${brand.path}`,
    padding: brand.padding,
  })),
];

if (process.argv.includes("--fetch")) {
  for (const { file, url } of variants) {
    const target = new URL(file, iconsDir);
    if (await exists(target)) continue;
    await mkdir(new URL(".", target), { recursive: true });
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Couldn't download ${url}: ${response.status}`);
    await writeFile(target, await response.text());
    console.log(`fetched ${file}`);
  }
}

const symbols: string[] = [];
for (const { id, file, padding } of variants) {
  const source = await readFile(new URL(file, iconsDir), "utf8").catch(() => {
    throw new Error(`Missing icons/${file}. Run \`pnpm icons:fetch\`.`);
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

  symbols.push(
    `<symbol id="${id}" viewBox="${widenViewBox(viewBox, padding)}" fill="currentColor">${body}</symbol>`,
  );
}

const iconset = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display: none">\n${symbols.join("\n")}\n</svg>\n`;

await mkdir(new URL("src/icons/", root), { recursive: true });
await writeFile(output, iconset);
console.log(`wrote src/icons/iconset.svg with ${variants.length} icons (${iconset.length} bytes)`);

function widenViewBox(viewBox: string, padding: number): string {
  if (padding === 0) return viewBox;
  const [x = 0, y = 0, width = 0, height = 0] = viewBox.split(/\s+/u).map(Number);
  return [x - padding, y - padding, width + 2 * padding, height + 2 * padding].join(" ");
}

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url);
    return true;
  } catch {
    return false;
  }
}
