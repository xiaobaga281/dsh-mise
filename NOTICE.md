# Third-party notices

Mise is MIT licensed (see LICENSE). It bundles or builds on the following:

## Vendored packages — `vendor/node_modules/`

These are shipped so the plugin works from a single folder, without a package
manager at run time. Each package keeps its own license file in its folder:

- `playwright-core` — Apache-2.0 — headless Chromium control used by the renderer.
- `pngjs`, `jpeg-js` — MIT — image codecs used by the composition and cutout paths.
- `node-edge-tts` — MIT — speech synthesis for `mise_voice`.
- `ws` — MIT — WebSocket client.
- `debug`, `ms`, `agent-base`, `https-proxy-agent`, `yargs`, `yargs-parser`,
  `cliui`, `wrap-ansi`, `string-width`, `strip-ansi`, `ansi-regex`, `ansi-styles`,
  `color-convert`, `color-name`, `emoji-regex`, `escalade`, `get-caller-file`,
  `is-fullwidth-code-point`, `require-directory`, `y18n` — MIT — transitive
  dependencies of the above.

## Film format and style documents

`skills/` started from the OpenFilm skills set
(<https://github.com/openfilm/skills>, MIT) and was localised for Mise: the
commands name this plugin's tools, and the prose describes Mise's own renderer.
The film format itself — `film.html`, tracks, clips, `at`, `#t=in,out`,
`window.film.frame(t)` — follows the same upstream specification.

## Fonts

Films are drawn with the system font stack (`Noto Sans SC`, `Microsoft YaHei`,
`system-ui`). No font files are redistributed here.
