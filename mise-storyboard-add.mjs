/**
 * Add a shot to a film's shot track.
 *
 * The clip needs a page to point at, so this writes one too: an empty stage page
 * in the film's own format, named after the next free number. The shot enters at
 * the end of the timeline, with the same length as the last shot, so the film
 * stays valid the moment it is written.
 *
 * @module mise-storyboard-add
 */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Append one shot.
 *
 * @param {{ projectPath: string, filmText: string, kind?: string, length?: number, title?: string }} spec
 */
export function addShot(spec) {
  const projectPath = spec.projectPath;
  const filmText = String(spec.filmText ?? '');
  const length = Number(spec.length ?? 3);
  if (!Number.isFinite(length) || length < 0.2 || length > 30) {
    return { ok: false, problems: [`length must be 0.2..30s (${length} given)`] };
  }

  // The pages that are already in the film, so the new one gets a free number.
  const used = [...filmText.matchAll(/src="(\d+)-[^"#]+\.html/g)].map((match) => Number(match[1]));
  let number = 1;
  while (used.includes(number)) number += 1;
  const stem = `${String(number).padStart(2, '0')}-${spec.kind && /^[a-z-]+$/i.test(spec.kind) ? spec.kind : 'shot'}`;
  const page = `${stem}.html`;

  if (existsSync(join(projectPath, page))) {
    return { ok: false, problems: [`a page named ${page} already exists`] };
  }

  // The stage size the film declares, so the new page draws in the same frame.
  const stage = /width=(\d+)[^,]*,\s*height=(\d+)/i.exec(filmText);
  const w = stage ? stage[1] : 1920;
  const h = stage ? stage[2] : 1080;
  const title = String(spec.title ?? '新镜头');

  const pageHtml = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=${w}, height=${h}">
<style>
  html, body { margin: 0; width: 100%; height: 100%; background: #05070b; overflow: hidden;
    font-family: "Noto Sans SC", "Microsoft YaHei", system-ui, sans-serif; }
  .center { position: absolute; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 14px; color: #F2F6FB; }
  .kicker { font-size: 20px; letter-spacing: 0.36em; color: #468CFF; text-transform: uppercase; }
  .title { font-size: 76px; font-weight: 800; letter-spacing: -0.02em; }
  .hint { position: absolute; left: 54px; bottom: 40px; font-size: 13px;
    color: rgba(180,200,225,0.45); letter-spacing: 0.02em; }
</style></head>
<body>
  <div class="center">
    <div class="kicker">MISE</div>
    <div class="title">${title.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</div>
  </div>
  <div class="hint">空白镜头页 · 用 mise_* 工具或直接编辑本页替换内容</div>
</body></html>`;
  writeFileSync(join(projectPath, page), pageHtml, 'utf8');

  // Where the last shot ends, the new one begins: same length as the previous
  // clip, so nothing else has to move.
  const clips = [...filmText.matchAll(/<iframe\b[^>]*>/gi)].map((match) => match[0]);
  if (!clips.length) {
    return { ok: false, problems: ['the film has no shot track to append to'] };
  }
  const lastTag = clips[clips.length - 1];
  const lastSrc = /src="([^"#]+)(?:#t=([\d.]+),([\d.]+))?"/.exec(lastTag) ?? [];
  const lastLength = lastSrc[2] && lastSrc[3] ? Number(lastSrc[3]) - Number(lastSrc[2]) : length;
  const lastAt = Number(/at="([\d.]+)"/.exec(lastTag)?.[1] ?? 0);
  const newAt = Number((lastAt + lastLength).toFixed(2));

  const clip = `  <iframe src="${page}#t=0,${length.toFixed(2)}" at="${newAt.toFixed(2)}"></iframe>`;
  // Append at the end of the shot track, not after the last opening tag: the
  // track's iframes may be unclosed in the source, and inserting between an
  // opening tag and its neighbour nests them.
  const sectionEnd = filmText.lastIndexOf('</section>');
  if (sectionEnd < 0) return { ok: false, problems: ['the film has no </section> to append inside'] };
  const nextText = `${filmText.slice(0, sectionEnd)}${clip}\n${filmText.slice(sectionEnd)}`;

  // The shared route tail writes `result.html` and recomputes the plan's length
  // from `result.shots`, so both are provided.
  return {
    ok: true,
    problems: [],
    page,
    clip,
    filmText: nextText,
    html: nextText,
    shots: [{ length }],
    index: clips.length + 1,
    at: newAt,
    length,
  };
}
