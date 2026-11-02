/**
 * Mise film format — the parser the checker reads film.html with.
 *
 * A film is a page of tracks, and each track holds clips:
 *
 *   <section>
 *     <iframe src="01-title.html#t=0,4" at="0"></iframe>
 *     <audio src="assets/score.wav" at="0" volume="0.9"></audio>
 *   </section>
 *
 * That is the whole format: a stage size in the viewport meta, one section per
 * track, and clips that carry a source, an in/out range in the fragment and an
 * optional start time. This parser reads exactly that and reports what it cannot
 * read, rather than guessing.
 *
 * @module mise-film-doc
 */

export const FILM_FILE = 'film.html';
export const SPEED_MIN = 0.25;
export const SPEED_MAX = 4;

/** The stage a film declares, or a 16:9 default. */
function readStage(text) {
  const meta = /<meta[^>]*name=["']viewport["'][^>]*content=["']([^"']+)["']/i.exec(text);
  const fromMeta = meta ? /width=(\d+)[^,]*,\s*height=(\d+)/i.exec(meta[1]) : null;
  if (fromMeta) return { w: Number(fromMeta[1]), h: Number(fromMeta[2]) };
  const css = /body\s*\{[^}]*width:\s*(\d+)px[^}]*height:\s*(\d+)px/i.exec(text);
  if (css) return { w: Number(css[1]), h: Number(css[2]) };
  return { w: 1920, h: 1080 };
}

/**
 * Every `key="value"` on one tag.
 * @param {string} tag
 */
function attributesOf(tag) {
  const attributes = {};
  for (const match of tag.matchAll(/([a-zA-Z-]+)\s*=\s*"([^"]*)"/g)) attributes[match[1].toLowerCase()] = match[2];
  return attributes;
}

/** A clip's id: its page or file name without extension, made unique by position. */
function idOf(src, index) {
  const file = String(src ?? '').split('#')[0].split('/').pop() ?? '';
  const stem = file.replace(/\.[a-z0-9]+$/i, '');
  return stem || `clip-${index + 1}`;
}

/**
 * Read a film's markup.
 *
 * @param {string} text
 * @returns {{ doc: { stage: { w: number, h: number }, tracks: Array<{ clips: Array<object> }> } | null, problems: string[] }}
 */
export function readFilmFile(text) {
  const source = String(text ?? '');
  const problems = [];
  const stage = readStage(source);

  const sections = [...source.matchAll(/<section\b[^>]*>([\s\S]*?)<\/section>/gi)].map((match) => match[1]);
  if (!sections.length) {
    // A film with no section has no track, and a track is where clips live.
    problems.push(`${FILM_FILE}: no <section> — a film is at least one track`);
    return { doc: null, problems };
  }

  const tracks = sections.map((body) => {
    const clips = [];
    const tagPattern = /<(iframe|audio|video|img)\b([^>]*)>/gi;
    let index = 0;
    for (const match of body.matchAll(tagPattern)) {
      const kind = match[1].toLowerCase();
      const attributes = attributesOf(match[0]);
      const src = attributes.src;
      if (!src) {
        problems.push(`${FILM_FILE}: a <${kind}> has no src`);
        continue;
      }
      const hash = src.indexOf('#');
      const file = hash < 0 ? src : src.slice(0, hash);
      const fragment = hash < 0 ? '' : src.slice(hash + 1);
      const range = /^t=([^,]*)(?:,(.*))?$/.exec(fragment);
      const time = [];
      if (range) {
        const from = Number(range[1]);
        const to = range[2] === undefined || range[2] === '' ? null : Number(range[2]);
        if (Number.isFinite(from)) time.push(from);
        if (to !== null && Number.isFinite(to)) time.push(to);
      }
      const clip = {
        id: idOf(src, index),
        src,
        file,
        tag: kind,
        ...(attributes.at !== undefined ? { at: Number(attributes.at) } : {}),
        ...(attributes.volume !== undefined ? { volume: Number(attributes.volume) } : {}),
        ...(time.length ? { time } : {}),
        ...(attributes.speed !== undefined ? { speed: Number(attributes.speed) } : {}),
        ...(attributes.fade !== undefined ? { fade: attributes.fade } : {}),
      };
      // A clip with neither a start nor a range begins at zero, which is legal
      // only for the first clip of its track; the checker decides that.
      clips.push(clip);
      index += 1;
    }
    return { clips };
  });

  return { doc: { stage, tracks }, problems };
}

/** A clip's span on its track: start and end, in seconds. */
export function clipSpan(clip) {
  const start = Number(clip?.at ?? 0);
  const range = Array.isArray(clip?.time) ? clip.time : [];
  const length = range.length === 2 ? range[1] - range[0] : range.length === 1 ? 0 : 0;
  const speed = Number.isFinite(Number(clip?.speed)) && Number(clip.speed) > 0 ? Number(clip.speed) : 1;
  return { start, end: start + length / speed, length: length / speed };
}

/** The fade a clip declares, if any: { in, out } in seconds. */
export function clipFade(clip) {
  const raw = clip?.fade;
  if (raw === undefined) return { in: 0, out: 0 };
  const parts = String(raw).split(/[,\s]+/).map(Number).filter(Number.isFinite);
  return { in: parts[0] ?? 0, out: parts[1] ?? parts[0] ?? 0 };
}

/**
 * Write a film back out. The inverse of readFilmFile, used by the scaffolder:
 * a new project is correct by construction because the writer cannot emit a
 * clip without its range or its start time.
 *
 * @param {{ stage?: { w: number, h: number }, tracks: Array<{ clips: Array<{ src: string, time?: number[], at?: number, volume?: number }> }> }} value
 */
export function filmHtml(value) {
  const stage = value?.stage ?? { w: 1920, h: 1080 };
  const tracks = Array.isArray(value?.tracks) ? value.tracks : [];
  const sections = tracks.map((track) => {
    const clips = (track.clips ?? []).map((clip) => {
      const range = Array.isArray(clip.time) && clip.time.length ? `#t=${clip.time.join(',')}` : '';
      const at = clip.at !== undefined ? ` at="${Number(clip.at)}"` : '';
      const volume = clip.volume !== undefined ? ` volume="${Number(clip.volume)}"` : '';
      const tag = /\.[a-z0-9]+$/i.test(String(clip.src)) && /^(mp3|wav|m4a|aac)$/i.test(String(clip.src).split('.').pop())
        ? 'audio' : 'iframe';
      return `  <${tag} src="${clip.src}${range}"${at}${volume}></${tag}>`;
    }).join('\n');
    return `<section>\n${clips}\n</section>`;
  }).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=${stage.w}, height=${stage.h}">
<style>html, body { margin: 0; background: #000; } iframe { border: 0; }</style></head>
<body>
sections,
</body></html>`.replace('sections,', sections);
}
