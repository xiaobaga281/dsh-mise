/**
 * Editing the film from the panel: shot order and shot length.
 *
 * The web Studio could retime and reorder shots. Rather than starting a second
 * server for that, the panel edits the same thing the Studio edited — the clip
 * attributes in film.html — through one pure function here, so the edit is
 * testable and the panel has no dependency on a running web app.
 *
 * Only the top track's iframes are touched: that is where shots live. Audio and
 * overlays on other tracks keep their own timing.
 *
 * @module mise-film-storyboard
 */

/** One shot as written in the film: everything needed to put it back. */
const CLIP = /<iframe\b[^>]*\bsrc="([^"#]+)(?:#t=([0-9.]+),([0-9.]+))?"([^>]*)>/i;
const ATTR_AT = /\bat="([0-9.]+)"/i;

/**
 * Read the shots out of a film document, in order.
 * @param {string} html
 * @returns {Array<{ index: number, page: string, in: number|null, out: number|null, at: number, tag: string }>}
 */
export function readShots(html) {
  const shots = [];
  const sectionMatch = /<section\b[^>]*>([\s\S]*?)<\/section>/gi;
  let section;
  let sectionIndex = 0;
  while ((section = sectionMatch.exec(String(html ?? ''))) !== null) {
    sectionIndex += 1;
    const body = section[1];
    // Shots live on the first track; later sections are audio or overlays.
    if (!/<iframe\b/i.test(body)) continue;
    const tagMatches = [...body.matchAll(/<iframe\b[^>]*>/gi)];
    for (const [tag] of tagMatches) {
      const parsed = CLIP.exec(tag);
      if (!parsed) continue;
      const at = ATTR_AT.exec(parsed[4] ?? '');
      const inTime = parsed[2] !== undefined ? Number(parsed[2]) : null;
      const outTime = parsed[3] !== undefined ? Number(parsed[3]) : null;
      shots.push({
        index: shots.length + 1,
        page: parsed[1],
        in: inTime,
        out: outTime,
        at: at ? Number(at[1]) : 0,
        tag,
        section: sectionIndex,
      });
    }
    break;
  }
  return shots;
}

/**
 * Rewrite the shot track with new lengths, keeping order and recomputing `at`.
 * The first section is often the audio track; the shots are on the first track
 * that actually holds iframes, so that is the one rewritten.
 * @param {string} html
 * @param {Array<{ page: string, in: number|null, length: number, at: number }>} shots
 */
function writeShots(html, shots) {
  const sections = /<section\b[^>]*>[\s\S]*?<\/section>/gi;
  let match;
  while ((match = sections.exec(String(html))) !== null) {
    if (!/<iframe\b/i.test(match[0])) continue;
    const openEnd = match[0].indexOf('>') + 1;
    const body = shots
      .map((shot) => `  <iframe src="${shot.page}#t=${shot.in ?? 0},${Number(((shot.in ?? 0) + shot.length).toFixed(2))}"${shot.at > 0 ? ` at="${Number(shot.at.toFixed(2))}"` : ''}></iframe>`)
      .join('\n');
    const rebuilt = `${match[0].slice(0, openEnd)}\n${body}\n</section>`;
    return html.slice(0, match.index) + rebuilt + html.slice(match.index + match[0].length);
  }
  return html;
}

/** Shots plus the length each one actually plays for. */
function shotsWithLength(html) {
  return readShots(html).map((shot) => ({
    ...shot,
    length: Number(Math.max(0, (shot.out ?? 0) - (shot.in ?? 0)).toFixed(2)),
  }));
}

/**
 * Set one shot's length and push the following shots along.
 * @param {string} html
 * @param {number} index 1-based shot number
 * @param {number} length seconds
 */
export function setShotLength(html, index, length) {
  const shots = shotsWithLength(html);
  const target = shots.find((shot) => shot.index === index);
  if (!target) return { ok: false, problems: [`no shot ${index}`], html };
  const next = Math.max(0.4, Math.min(30, Number(length)));
  if (!Number.isFinite(next)) return { ok: false, problems: ['length must be a number'], html };
  target.length = next;
  // Recompute positions from the first shot so the track stays contiguous.
  let cursor = 0;
  for (const shot of shots) {
    shot.at = cursor;
    cursor += shot.length;
  }
  return { ok: true, problems: [], html: writeShots(html, shots), shots };
}

/** Move one shot earlier or later in the track. */
export function moveShot(html, index, delta) {
  const shots = shotsWithLength(html);
  const from = shots.findIndex((shot) => shot.index === index);
  const to = from + Number(delta);
  if (from < 0) return { ok: false, problems: [`no shot ${index}`], html };
  if (to < 0 || to >= shots.length) return { ok: false, problems: ['that shot cannot move further'], html };
  const [moved] = shots.splice(from, 1);
  shots.splice(to, 0, moved);
  let cursor = 0;
  shots.forEach((shot, position) => {
    shot.index = position + 1;
    shot.at = cursor;
    cursor += shot.length;
  });
  return { ok: true, problems: [], html: writeShots(html, shots), shots };
}

/**
 * The shots with their lengths, for a panel to render.
 * @param {string} html
 */
export function describeShots(html) {
  return readShots(html).map((shot) => ({
    index: shot.index,
    page: shot.page,
    at: shot.at,
    length: Number(((shot.out ?? 0) - (shot.in ?? 0) > 0 ? (shot.out ?? 0) - (shot.in ?? 0) : 0).toFixed(2)),
  }));
}
