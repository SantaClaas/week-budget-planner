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
//
// It also writes src/icons/name.ts, the type of every id in the sprite, so an icon that isn't in it
// doesn't compile. Both come from the same run, so they always match each other, and a test fails
// when either is older than the manifest (build-iconset.test.ts).

import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import { optimize } from "svgo";

/**
 * A brand mark from its owner's repository. `padding` widens its viewBox on every side, in its own
 * units, for marks drawn edge to edge, so they match Material's 20 of 24 drawn area.
 */
type Brand = { name: string; repository: string; commit: string; path: string; padding: number };

type Manifest = {
  source: { repository: string; commit: string; style: string };
  icons: { name: string; fill: boolean }[];
  brands: Brand[];
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

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
const iconsDir = new URL("icons/", root);
/** Where the sprite and its type are written. The test compares them with what `build` makes. */
export const OUTPUTS = {
  iconset: new URL("src/icons/iconset.svg", root),
  names: new URL("src/icons/name.ts", root),
} as const;

type Variant = { id: string; file: string; url: string; padding: number };

/** One entry per file: the outline, plus the filled variant when asked for, then the brand marks. */
function listVariants(manifest: Manifest): Variant[] {
  const { repository, commit, style } = manifest.source;
  return [
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
}

async function readVariants(): Promise<Variant[]> {
  const manifest = readManifest(
    JSON.parse(await readFile(new URL("icons/icons.json", root), "utf8")),
  );
  return listVariants(manifest);
}

async function exists(url: URL): Promise<boolean> {
  try {
    await access(url);
  } catch {
    return false;
  }
  return true;
}

/** Downloads the SVGs that aren't in icons/ yet. */
async function fetchMissing(variants: Variant[]): Promise<void> {
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

function widenViewBox(viewBox: string, padding: number): string {
  if (padding === 0) return viewBox;
  const [x = 0, y = 0, width = 0, height = 0] = viewBox.split(/\s+/u).map(Number);
  return [x - padding, y - padding, width + 2 * padding, height + 2 * padding].join(" ");
}

/** The icon's SVG file, optimized into a <symbol> filled with currentColor. */
async function buildSymbol({ id, file, padding }: Variant): Promise<string> {
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
  return `<symbol id="${id}" viewBox="${widenViewBox(viewBox, padding)}" fill="currentColor">${body}</symbol>`;
}

/**
 * The sprite and the type of its icon names, from the manifest and the SVGs in icons/, without
 * writing anything.
 */
export async function build(): Promise<{ iconset: string; names: string }> {
  const variants = await readVariants();
  const symbols: string[] = [];
  for (const variant of variants) symbols.push(await buildSymbol(variant));
  const iconset = `<svg xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="display: none">\n${symbols.join("\n")}\n</svg>\n`;
  // One name per line, as the formatter writes a long union, so the generated file passes its check.
  const names = `// Generated by scripts/build-iconset.ts (pnpm icons) from icons/icons.json. Don't edit by hand.

/**
 * The id of an icon in src/icons/iconset.svg: each icon in the manifest, and its filled variant as
 * name-fill where the manifest asks for one.
 */
export type IconName =
${variants.map(({ id }) => `  | "${id}"`).join("\n")};
`;
  return { iconset, names };
}

if (import.meta.main) {
  if (process.argv.includes("--fetch")) await fetchMissing(await readVariants());
  const { iconset, names } = await build();
  await mkdir(new URL("src/icons/", root), { recursive: true });
  await writeFile(OUTPUTS.iconset, iconset);
  await writeFile(OUTPUTS.names, names);
  console.log(`wrote src/icons/iconset.svg (${iconset.length} bytes) and src/icons/name.ts`);
}
