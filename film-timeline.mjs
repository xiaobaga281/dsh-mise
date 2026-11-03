/**
 * Placing sound under a picture, by arithmetic instead of by eye.
 *
 * A narration line that starts after its shot appears and ends before the next
 * shot starts is four numbers apart, and the four numbers move whenever any
 * shot length moves — the wolf film's fourth line overran its shot by 0.41s and
 * every later `at=` had to be recomputed by hand. This module does that
 * arithmetic once: given the shot plan and the lines' measured lengths, it
 * emits the audio block for film.html with each line placed inside its own
 * shot, and it refuses to place a line that does not fit.
 *
 * Two lines that belong to the same shot are spoken one after another, never
 * on top of each other: two voices starting at the same second is a defect the
 * person hears, not a plan. A line that names no shot, names one that does not
 * exist, or carries a negative `lead` is refused; nothing is guessed by
 * position, because an intro or an outro makes positional guessing silently
 * wrong.
 *
 * The measured lengths come from `mise_voice` (its `seconds` is the real
 * length of the file it wrote); nothing here probes media.
 *
 * @module mise-timeline
 */

/**
 * Place lines under shots.
 *
 * @param {{
 *   shots: Array<{ at: number, len: number, id?: string }>,
 *   lines: Array<{ text?: string, seconds: number, src: string, shot?: number, shotId?: string, lead?: number, volume?: number }>,
 *   lead?: number,
 * }} plan
 *   `shots` is the picture track's plan (at, len). `lines` is the narration:
 *   each line names the shot it belongs to with `shot` or `shotId`. The line
 *   carries the measured `seconds` of its audio file and the `src` to write.
 *   `lead` is the beat of silence after a shot appears before its line starts
 *   (default 0.35s).
 * @returns {{ ok: boolean, placements: Array<object>, overruns: Array<object>, audioBlock: string, totalLength: number }}
 */
export function placeLines(plan) {
  const shots = Array.isArray(plan?.shots) ? plan.shots : [];
  const lines = Array.isArray(plan?.lines) ? plan.lines : [];
  // Give the shot's visual title time to appear before speech begins. Pages in
  // the bundled templates reveal copy at roughly 0.25–0.35s; 0.35 is therefore
  // the safe default. Callers may choose a different lead explicitly.
  const lead = Number.isFinite(plan?.lead) && plan.lead >= 0 ? plan.lead : 0.35;

  const placements = [];
  const overruns = [];
  /** Why a whole plan cannot be placed (not tied to one line). */
  const errors = [];
  const implicitMapping = lines.length === shots.length;

  // The shots are the frame every line is placed against, so a malformed one
  // is refused before any line is judged against it.
  const seenIds = new Set();
  shots.forEach((shot, index) => {
    if (!Number.isFinite(shot?.at) || shot.at < 0) errors.push(`shot ${index} has no valid start (at=${shot?.at}); give a finite at >= 0`);
    if (!Number.isFinite(shot?.len) || shot.len <= 0) errors.push(`shot ${index} has no valid length (len=${shot?.len}); give a finite len > 0`);
    if (typeof shot?.id === 'string' && shot.id) {
      if (seenIds.has(shot.id)) errors.push(`shot id "${shot.id}" is used twice; ids must be unique`);
      seenIds.add(shot.id);
    }
  });

  const ids = new Map(shots.map((shot, index) => [typeof shot.id === 'string' ? shot.id : '', index]).filter(([id]) => id));
  /** How far the last line placed in a shot has run, so the next one follows it. */
  const cursor = new Map();

  lines.forEach((line, i) => {
    let shotIndex;
    if (typeof line?.shotId === 'string' && line.shotId) {
      if (!ids.has(line.shotId)) {
        overruns.push({ line: i, src: line.src, reason: `line ${i} names shot "${line.shotId}", which is not in the plan (${shots.length} shot(s)); it is not mapped by position` });
        return;
      }
      shotIndex = ids.get(line.shotId);
      if (Number.isInteger(line.shot) && line.shot !== shotIndex) {
        overruns.push({ line: i, src: line.src, reason: `line ${i} names shot ${line.shot} and shotId "${line.shotId}", which are different shots` });
        return;
      }
    } else if (Number.isInteger(line?.shot)) {
      shotIndex = line.shot;
    } else if (implicitMapping) {
      shotIndex = i;
    } else {
      overruns.push({ line: i, src: line.src, reason: `line ${i} has no shot/shotId and cannot be mapped safely: ${lines.length} narration lines for ${shots.length} shots; name every narration line's shot explicitly` });
      return;
    }

    const shot = shots[shotIndex];
    if (!shot) {
      overruns.push({ line: i, src: line.src, reason: `no shot ${shotIndex} in the plan (${shots.length} shots)` });
      return;
    }
    const seconds = Number(line.seconds);
    if (!Number.isFinite(seconds) || seconds <= 0) {
      overruns.push({ line: i, src: line.src, reason: `the line's measured length (${line.seconds}) is not a positive number of seconds` });
      return;
    }
    const ownLead = line.lead === undefined ? lead : Number(line.lead);
    if (!Number.isFinite(ownLead) || ownLead < 0) {
      overruns.push({ line: i, src: line.src, reason: `the line's lead (${line.lead}) is not a number of seconds >= 0; a negative lead starts the line before its shot` });
      return;
    }
    // Lines already spoken in this shot have the floor; the next one starts
    // where the last one ended, so two lines never overlap.
    const shotStart = round3(shot.at + ownLead);
    const start = round3(Math.max(shotStart, cursor.get(shotIndex) ?? shotStart));
    const end = round3(start + seconds);
    const shotEnd = round3(shot.at + shot.len);
    if (end > shotEnd + 1e-3) {
      overruns.push({
        line: i,
        src: line.src,
        shot: shotIndex,
        reason: `the line runs ${round3(end - shotEnd)}s past its shot (ends ${start} + ${seconds} = ${end}, shot ends ${shotEnd})`,
        needsShotLength: round3(seconds + ownLead + 0.2),
        ...(start !== shotStart ? { note: 'it starts after the lines already placed in this shot' } : {}),
      });
      return;
    }
    cursor.set(shotIndex, end);
    const entry = {
      line: i,
      shot: shotIndex,
      src: line.src,
      at: start,
      seconds,
      ends: end,
    };
    if (Number.isFinite(line.volume)) entry.volume = line.volume;
    placements.push(entry);
  });

  const ok = errors.length === 0 && overruns.length === 0 && placements.length > 0;
  return {
    ok,
    placements,
    overruns,
    errors,
    // A plan that did not place cleanly gets no paste-ready block: the block
    // has no way to carry a warning, and a half-placed soundtrack looks done.
    audioBlock: ok ? audioBlock(placements) : '',
    totalLength: shots.length ? round3(Math.max(...shots.map((s) => s.at + s.len))) : 0,
  };
}

/** The `<section>` of `<audio>` clips, ready to paste into film.html. */
function audioBlock(placements) {
  if (!placements.length) return '';
  const rows = placements.map((p) => {
    const attrs = [`src="${p.src}"`, `at="${p.at}"`];
    if (p.volume !== undefined) attrs.push(`volume="${p.volume}"`);
    return `  <audio ${attrs.join(' ')}></audio>`;
  });
  return `<section>\n${rows.join('\n')}\n</section>`;
}

/** A second, kept to the millisecond: the film's own resolution. */
function round3(v) {
  return Number((Math.round(v * 1000) / 1000).toFixed(3));
}
