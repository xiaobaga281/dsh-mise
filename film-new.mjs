/**
 * Creating a film project that renders before anything is written into it.
 *
 * Starting from a blank film.html is where a film goes wrong: the stage is
 * guessed, the first shot has no `#t=` and no length, and the first `look`
 * fails on a file that was never valid. `mise_new` writes the smallest
 * film that is correct by construction — a stage, one shot page that uses the
 * motion kit, the kit itself — so the first `look` shows a picture instead of
 * an error, and every later edit starts from something that works.
 *
 * @module openfilm-new
 */

import { mkdirSync, copyFileSync, existsSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));

/** Upstream's film writer, loaded from the vendored package by path. */
const require = createRequire(import.meta.url);
const FILM_DOC = await import('./mise-film-doc.mjs');


/** The stages a person is likely to want, by name. */
export const STAGES = {
  '16:9': { w: 1920, h: 1080 },
  '9:16': { w: 1080, h: 1920 },
  '1:1': { w: 1080, h: 1080 },
};

/**
 * Write a new film project into `projectPath` (created if needed).
 * Never overwrites: an existing film.html or shot page is returned as a
 * refusal, because a scaffold that eats someone's film is worse than no scaffold.
 *
 * @param {{ projectPath: string, stage?: string, title?: string }} spec
 * @returns {{ ok: boolean, created: string[], existed: string[], filmPath?: string, error?: string }}
 */
export async function newFilm(spec) {
  const projectPath = resolve(spec.projectPath);
  const stage = STAGES[spec.stage ?? '16:9'] ?? STAGES['16:9'];
  const title = typeof spec.title === 'string' && spec.title.trim() ? spec.title.trim() : '新影片';

  const created = [];
  const existed = [];

  const filmPath = join(projectPath, 'film.html');
  const motionPath = join(projectPath, 'of-motion.mjs');
  const shotPath = join(projectPath, 's1.html');

  if (existsSync(filmPath)) existed.push('film.html');
  if (existsSync(shotPath)) existed.push('s1.html');
  if (existed.length) return { ok: false, created, existed, error: `already exists: ${existed.join(', ')} — open it instead of overwriting it.` };

  mkdirSync(projectPath, { recursive: true });

  // The film: one track, one clip, exact timings. The timing is given as
  // `time`, not as a fragment on the src: upstream's writer appends the
  // fragment itself, and its kind detection reads the src's extension — a
  // pre-attached fragment would leave the element tag as <undefined>.
  const value = {
    stage,
    tracks: [{ clips: [{ src: 's1.html', time: [0, 4], at: 0 }] }],
  };
  const html = FILM_DOC.filmHtml(value);
  writeIfNew(filmPath, html, created);

  // The shot page: a working title page over the motion kit, correct for any
  // stage because it centers itself.
  writeIfNew(shotPath, shotPage(title), created);

  // The motion kit and the page-side floor, from the plugin's own vendor
  // directory. A page imports both with a relative path.
  const kitSource = join(PLUGIN_ROOT, 'vendor', 'motion', 'of-motion.mjs');
  if (existsSync(kitSource)) {
    copyFileSync(kitSource, motionPath);
    created.push('of-motion.mjs');
  }
  const floorSource = join(PLUGIN_ROOT, 'vendor', 'motion', 'mise-kit.mjs');
  if (existsSync(floorSource)) {
    copyFileSync(floorSource, join(projectPath, 'mise-kit.mjs'));
    created.push('mise-kit.mjs');
  }

  return { ok: true, created, existed, filmPath };
}

function writeIfNew(path, text, created) {
  if (!existsSync(path)) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
    created.push(path.split(/[\\/]/).pop());
  }
}

/**
 * The first shot: a centered title that rises in, in CSS. The stage size comes
 * from the film's own viewport, so the same page serves every stage; the title
 * is then fitted to the box it is really drawn in, so it never overflows a
 * portrait frame because a size was written for 1920px.
 */
function shotPage(title) {
  const safe = title.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<!-- Deliberately the smallest page that draws, and nothing more: no layout
     system, no palette, no motion library. Before the second shot, read
     ./mise-kit.mjs — grid(), typeScale(), inkOn()/contrast(), reveal(),
     camera(), grain(), drawOn(), beats(), defineShot() — and write the shot
     with it instead of re-inventing those six things badly. -->
<style>
/* The film host freezes CSS animations at t before a frame is drawn, so these
   keyframes are a deterministic function of t: no frame() loop needed. */
html, body { margin: 0; height: 100%; background: #0e0c0a; overflow: hidden; }
.stage { position: absolute; inset: 0; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 26px; padding: 0 8%; box-sizing: border-box; }
.title { font: 700 96px/1.15 "Source Han Sans SC", "Microsoft YaHei", sans-serif;
  color: #f3ead8; letter-spacing: 0.05em; opacity: 0; max-width: 100%; text-align: center;
  animation: rise 0.9s cubic-bezier(0.16, 1, 0.3, 1) 0.2s forwards; }
.rule { width: 0; height: 3px; background: #c76b3f;
  animation: draw 0.8s ease-out 0.9s forwards; }
@keyframes rise { from { opacity: 0; transform: translateY(26px); } to { opacity: 1; transform: none; } }
@keyframes draw { to { width: 220px; } }
</style>
</head>
<body>
<div class="stage">
  <div class="title">${safe}</div>
  <div class="rule"></div>
</div>
<script type="module">
import { fitTextWhenReady } from './of-motion.mjs';

window.film = { duration: 4, frame(t) { return t; } };

// Fit the title to the box the page is really drawn in, once the real font is
// ready. Until this runs, the CSS size is a safe fallback; the fitted size is
// what the frames then show, and it is a pure function of the page, not of t.
const title = document.querySelector('.title');
if (title) {
  void fitTextWhenReady(title, { maxWidth: Math.round(window.innerWidth * 0.84), min: 28, max: 128 });
}
<` + `/script>
</body>
</html>
`;
}
