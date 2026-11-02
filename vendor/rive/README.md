# Rive runtime (vendored)

`@rive-app/canvas` 2.45.0 (MIT), vendored so a film page can play a `.riv`
without a package manager or a network at render time.

- `rive.js` — the UMD build; exposes `window.rive` (with `Rive`, `Fit`, `Alignment`).
- `rive.wasm` — the runtime.
- `rive_fallback.wasm` — used when the browser has no SIMD support.

`open` copies this folder into a project as `vendor-rive/`, and the shot page
`vendor/motion/templates/rive-shot.html` imports it from there.

Upstream: https://github.com/rive-app/rive-wasm
