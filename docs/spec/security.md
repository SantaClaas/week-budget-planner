---
paths:
  - "index.html"
  - "public/_headers"
  - "vite.config.ts"
  - "vite-plugins/**"
---

# Security

There is no backend and no account, but the plan is the user's own data, and an imported file is untrusted input. The page carries a Content Security Policy that blocks any script it didn't ship, and Trusted Types, so nothing can write a string as HTML unless the build put it on an allowlist. That second part also stops us from adding a way to write untrusted HTML by mistake later.

**Content Security Policy.** GitHub Pages can't send headers, so the policy is a `<meta http-equiv="Content-Security-Policy">` that the build adds as the first element of `<head>` (`vite-plugins/content-security-policy.ts`), in front of the inline scripts:

```
default-src 'self';
script-src 'self' 'sha256-…' 'sha256-…' 'wasm-unsafe-eval';
style-src 'self' 'unsafe-inline';
img-src 'self' data: blob:;
object-src 'none';
base-uri 'none';
form-action 'self';
require-trusted-types-for 'script';
trusted-types default service-worker
```

- The hashes are of the two inline scripts in `index.html` (the theme and the service worker registration), computed by the build, so editing them never needs a manual hash update.
- `'wasm-unsafe-eval'` lets the database engine compile its WebAssembly. Nothing may use `eval`.
- Styles allow `'unsafe-inline'`, because inline `style` attributes are part of Solid templates and the icon sprite, and the Trusted Types guard already covers injected markup.
- `frame-ancestors` doesn't work in a `<meta>` policy. The service worker adds it as a header to the page, together with the companion headers below, and `public/_headers` sends the same for hosts that read it.
- **Companion headers:** `Content-Security-Policy: frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` and `Permissions-Policy: camera=(), microphone=(), geolocation=()`.
- In development, Vite sends the Trusted Types part as `Content-Security-Policy-Report-Only`, so a mistake shows up as a violation in the console without breaking Vite's own error overlay. The full policy is enforced in `pnpm preview` and in production.

**Trusted Types.** With `require-trusted-types-for 'script'`, the browser refuses plain strings at every place where a string turns into HTML or code (`innerHTML`, `insertAdjacentHTML`, `outerHTML`, `DOMParser`, `eval`, `new Worker(url)`, `serviceWorker.register(url)` and the like). Only values made by an allowed policy pass. There are two policies:

- **`default`** (`src/trusted-html.ts`, imported first by `src/index.tsx`). The browser calls it for every plain string at those places.
  - **HTML:** only exact strings on the allowlist pass. The build puts every template the Solid compiler produced on it: Solid builds the DOM from static template strings (`template()` in `@solidjs/web`, its only HTML sink), and the plugin reads them from the compiled code and registers them with the module that uses them. The icon sprite is on the list too. Anything else, for example a JSX `innerHTML={…}` with a string, or `insertAdjacentHTML` with an activity name, is refused with a Trusted Types violation.
  - **Script URLs:** only same-origin URLs, which covers the database worker.
  - **Scripts:** none.
- **`service-worker`** (the inline registration script): returns the one service worker URL, whatever it's given.
- `allowHtml()` is only for the build. The plugin fails the build when any other file imports `src/trusted-html.ts`, except `src/index.tsx`, which only imports it.
- **One violation per page load is expected:** emnapi, which the database engine is built on, checks once whether `new Function` works and falls back to plain functions when it doesn't. That check shows up as a `TrustedScript` error in the console (in development, as several report-only messages). Any other violation is a bug.
- To show user text, use text: JSX children and attributes, `textContent`. If a feature ever needs real untrusted HTML, it needs the Sanitizer API (`setHTML()`) and a decision recorded here first.

## Browser permissions

Never trigger a browser permission prompt the user has no context for. This covers persistent storage today, and location, camera, microphone, notifications and the like if a feature ever needs them.

- **The app asks first, in its own UI,** saying in plain words what the permission is for, right where it matters, with a button for the user to agree. Only that button calls the browser API (`navigator.storage.persist()`, `getCurrentPosition()`, `getUserMedia()` and so on). Never call it on page load or as a side effect of something else.
- "Not now" is respected: store when it was dismissed and don't ask again on your own. Keep a way to agree later in Settings.
- Check the state first with `navigator.permissions.query()` where the permission is listed there. Don't ask for what's already granted. When it's denied, explain how to change it in the browser instead of asking again.
- Where Chrome's `<permission>` element supports the permission (location, camera, microphone), prefer it inside our explanation, with a plain button calling the API as the fallback. It only prompts on the user's click.
- A feature that needs camera, microphone or location also has to loosen the `Permissions-Policy` header, which turns them off today.
