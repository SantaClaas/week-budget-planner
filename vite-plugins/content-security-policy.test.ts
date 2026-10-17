import { describe, expect, it } from "vitest";

import { findTemplates } from "./content-security-policy.ts";

describe("findTemplates", () => {
  it("reads the HTML of Solid's compiled templates as the runtime receives it", () => {
    const code = [
      'import { template as _$template } from "@solidjs/web";',
      "var _tmpl$ = /* @__PURE__ */ _$template(`<p data-testid=status>Storage: <!> · \\u00e9`);",
      'var _tmpl$2 = _$template("<svg><g>", 2);',
      "template(`<b>not Solid's`);",
    ].join("\n");
    expect(findTemplates(code)).toEqual(["<p data-testid=status>Storage: <!> · é", "<svg><g>"]);
  });

  it("ignores code without Solid templates", () => {
    expect(findTemplates('import { render } from "@solidjs/web"; render(() => 1, root);')).toEqual(
      [],
    );
    expect(findTemplates("element.innerHTML = text;")).toEqual([]);
  });

  it("refuses a template that isn't a static string", () => {
    const code = 'import { template } from "@solidjs/web"; template(`<p>${name}`);';
    expect(() => findTemplates(code)).toThrow(/static string/);
  });
});
