/**
 * Frame acceptance: does the page actually show what it was supposed to show?
 *
 * A page can be "valid" and still be broken: a font falls back to 16px, a
 * transform pushes the title off the frame, a selector stops matching. None of
 * that shows up in a source check — only in the pixels. This module turns a
 * grayscale frame into the few measurements that catch those failures:
 * coverage, content bounding box, margins against the safe area, contrast.
 *
 * Pure over a gray buffer, so it is testable without a browser or a PNG decoder.
 *
 * @module openfilm-film-verify
 */

/**
 * @typedef {{ width: number, height: number, coverage: number, bbox: object|null, margins: object|null, contrast: number, mean: number, problems: string[] }} FrameReport
 */

/**
 * Measure one grayscale frame.
 * @param {Uint8Array|Buffer} gray one byte per pixel, row-major
 * @param {{ width: number, height: number }} size
 * @param {{ threshold?: number, safe?: number, minCoverage?: number, maxCoverage?: number, minContrast?: number }} [rules]
 * @returns {FrameReport}
 */
/**
 * Measure one grayscale frame.
 *
 * Content is measured *against the frame's own background* (the most common
 * value), not against brightness: a title on a light card and a title on a dark
 * plate must both report the title, and a full-bleed photograph must be allowed
 * to cover the frame without being called a mistake.
 *
 * @param {Uint8Array|Buffer} gray one byte per pixel, row-major
 * @param {{ width: number, height: number }} size
 * @param {{ delta?: number, safe?: number, bleed?: boolean, minCoverage?: number, maxCoverage?: number, minContrast?: number }} [rules]
 * @returns {FrameReport}
 */
export function analyzeGray(gray, size, rules = {}) {
  const width = Number(size?.width ?? 0);
  const height = Number(size?.height ?? 0);
  const problems = [];
  if (!width || !height || gray.length < width * height) {
    return { width, height, coverage: 0, bbox: null, margins: null, contrast: 0, mean: 0, problems: ['frame buffer does not match its size'] };
  }

  // The delta is what counts as "content" rather than decoration: a light sweep
  // or a soft vignette must not be measured as if it were the title.
  const delta = Number(rules.delta ?? 90);
  const safe = Number(rules.safe ?? 0);
  const bleed = rules.bleed === true;
  const minCoverage = Number(rules.minCoverage ?? 0.05);
  const maxCoverage = Number(rules.maxCoverage ?? 96);
  const minContrast = Number(rules.minContrast ?? 8);

  const histogram = new Uint32Array(256);
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < width * height; i += 1) {
    const value = gray[i];
    histogram[value] += 1;
    sum += value;
    sumSq += value * value;
  }
  const pixels = width * height;
  // The background is the most common level; a photo has no single mode, which
  // is why a photo reports a large content share and is meant to.
  let background = 0;
  for (let v = 1; v < 256; v += 1) if (histogram[v] > histogram[background]) background = v;

  let lit = 0;
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  let momentX = 0;
  let momentY = 0;
  for (let y = 0; y < height; y += 1) {
    const row = y * width;
    for (let x = 0; x < width; x += 1) {
      const value = gray[row + x];
      if (Math.abs(value - background) > delta) {
        lit += 1;
        momentX += x;
        momentY += y;
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }

  const mean = sum / pixels;
  const variance = Math.max(0, sumSq / pixels - mean * mean);
  const contrast = Math.sqrt(variance);
  const coverage = Number(((lit / pixels) * 100).toFixed(2));
  const backgroundShare = Number(((histogram[background] / pixels) * 100).toFixed(2));

  const bbox = maxX >= 0 ? { left: minX, top: minY, right: maxX, bottom: maxY } : null;
  const margins = bbox
    ? { left: minX, top: minY, right: width - 1 - maxX, bottom: height - 1 - maxY }
    : null;
  // Where the weight of the frame actually sits, as fractions of the frame.
  // Composition is measurable this way: a subject parked at 0.5/0.5 on every
  // shot is a slideshow, and a subject at 0.05 is falling out of frame.
  const centroid = lit > 0 ? { x: Number((momentX / lit / width).toFixed(3)), y: Number((momentY / lit / height).toFixed(3)) } : null;
  const whitespace = Number((100 - coverage).toFixed(2));

  if (contrast < minContrast) problems.push(`flat frame (contrast ${contrast.toFixed(1)}) — a blank or single-colour render`);
  if (coverage < minCoverage) problems.push(`almost nothing is drawn (${coverage}% differs from the background; is the content missing, tiny, or transparent?)`);
  if (!bleed && coverage > maxCoverage) problems.push(`the frame is nearly filled (${coverage}% differs from the background) — a full-bleed element is probably covering the content`);
  if (!bleed && margins && safe > 0) {
    for (const side of ['left', 'top', 'right', 'bottom']) {
      if (margins[side] < safe) problems.push(`content crosses the safe area on the ${side} (${margins[side]}px < ${safe}px)`);
    }
  }

  // An opt-in composition rule: the frame names where its subject should sit,
  // and this checks it actually does. Off by default — a photograph composed
  // deliberately against the rule should not be called a failure.
  const expectX = Number(rules.expectCentroidX ?? NaN);
  const expectY = Number(rules.expectCentroidY ?? NaN);
  const tolerance = Number(rules.centroidTolerance ?? NaN);
  if (centroid && Number.isFinite(tolerance) && tolerance > 0) {
    const dx = Number.isFinite(expectX) ? centroid.x - expectX : 0;
    const dy = Number.isFinite(expectY) ? centroid.y - expectY : 0;
    const distance = Math.sqrt(dx * dx + dy * dy);
    if (distance > tolerance) {
      problems.push(`the subject sits at ${centroid.x}/${centroid.y}, ${distance.toFixed(3)} away from the intended ${Number.isFinite(expectX) ? expectX : 'any'}/${Number.isFinite(expectY) ? expectY : 'any'}`);
    }
  }

  return {
    width,
    height,
    coverage,
    bbox,
    margins,
    centroid,
    whitespace,
    contrast: Number(contrast.toFixed(1)),
    mean: Number(mean.toFixed(1)),
    background,
    backgroundShare,
    bleed,
    problems,
  };
}

/**
 * A panel-sized summary of several frames at once.
 * @param {Array<{ t: number, report: FrameReport }>} frames
 */
export function summarizeFrames(frames) {
  const problems = [];
  for (const frame of frames) {
    for (const problem of frame.report.problems) problems.push(`${frame.t}s: ${problem}`);
  }
  return {
    ok: problems.length === 0,
    checked: frames.length,
    problems,
    coverage: frames.map((frame) => ({ t: frame.t, coverage: frame.report.coverage })),
  };
}

/**
 * Does the film look like one film across its shots?
 *
 * A photo story or a pose sequence is meant to read as the same subject in the
 * same world. If one shot's average brightness or its background level jumps far
 * from the shot before it, the cut reads as a different film spliced in — a
 * mistake no single-frame check can see.
 *
 * @param {Array<{ t: number, kind?: string, mean: number, background: number }>} frames sorted by time
 * @param {{ meanTolerance?: number, backgroundTolerance?: number }} [options]
 */
export function continuityReport(frames, options = {}) {
  const meanTolerance = Number(options.meanTolerance ?? 26);
  const backgroundTolerance = Number(options.backgroundTolerance ?? 20);
  const list = (Array.isArray(frames) ? frames : [])
    .filter((frame) => Number.isFinite(frame?.t) && Number.isFinite(frame?.mean))
    .sort((a, b) => a.t - b.t);
  const pairs = [];
  for (let index = 1; index < list.length; index += 1) {
    const previous = list[index - 1];
    const current = list[index];
    const jumpMean = Math.abs(Number(current.mean) - Number(previous.mean));
    const jumpBackground = Math.abs(Number(current.background ?? 0) - Number(previous.background ?? 0));
    const problems = [];
    if (jumpMean > meanTolerance) problems.push(`brightness jumps ${jumpMean.toFixed(1)} between ${previous.t}s and ${current.t}s`);
    if (jumpBackground > backgroundTolerance) problems.push(`background level jumps ${jumpBackground.toFixed(1)} between ${previous.t}s and ${current.t}s`);
    pairs.push({
      from: previous.t,
      to: current.t,
      jumpMean: Number(jumpMean.toFixed(1)),
      jumpBackground: Number(jumpBackground.toFixed(1)),
      ok: problems.length === 0,
      problems,
    });
  }
  return {
    ok: pairs.every((pair) => pair.ok),
    pairs,
    problems: pairs.flatMap((pair) => pair.problems.map((problem) => `${pair.to}s: ${problem}`)),
  };
}

/**
 * Does the film repeat itself?
 *
 * Five shots that all put the same weight in the same place at the same
 * brightness read as one template, however good each frame is on its own. This
 * compares neighbours: if both the composition and the exposure barely move
 * across a cut, the sequence has gone flat.
 *
 * @param {Array<{ t: number, mean: number, centroid?: { x: number, y: number } }>} frames
 * @param {{ centroidTolerance?: number, meanTolerance?: number }} [options]
 */
export function varietyReport(frames, options = {}) {
  const centroidTolerance = Number(options.centroidTolerance ?? 0.07);
  const meanTolerance = Number(options.meanTolerance ?? 4);
  const list = (Array.isArray(frames) ? frames : [])
    .filter((frame) => Number.isFinite(frame?.t) && Number.isFinite(frame?.mean) && frame?.centroid)
    .sort((a, b) => a.t - b.t);
  const pairs = [];
  for (let index = 1; index < list.length; index += 1) {
    const previous = list[index - 1];
    const current = list[index];
    const dx = Number(current.centroid.x) - Number(previous.centroid.x);
    const dy = Number(current.centroid.y) - Number(previous.centroid.y);
    const shift = Math.sqrt(dx * dx + dy * dy);
    const jump = Math.abs(Number(current.mean) - Number(previous.mean));
    const flat = shift < centroidTolerance && jump < meanTolerance;
    pairs.push({
      from: previous.t,
      to: current.t,
      centroidShift: Number(shift.toFixed(3)),
      meanJump: Number(jump.toFixed(1)),
      ok: !flat,
      problems: flat ? [`${current.t}s looks like the shot before it (composition moved ${shift.toFixed(3)}, brightness ${jump.toFixed(1)})`] : [],
    });
  }
  return {
    ok: pairs.every((pair) => pair.ok),
    pairs,
    problems: pairs.flatMap((pair) => pair.problems),
  };
}

/**
 * A verifiable record of one acceptance run, written beside the film.
 *
 * The timestamp is the film's mtime at the moment of checking: if the film is
 * edited afterwards, the record is stale and a render must not treat it as
 * proof that the current cut was looked at.
 * @param {{ ok: boolean, checked: number, frames: Array<object>, problems: string[] }} result
 * @param {{ filmMtimeMs: number, now?: Date }} stamp
 */
export function verifyRecord(result, stamp = {}) {
  return {
    version: 1,
    at: (stamp.now ?? new Date()).toISOString(),
    filmMtimeMs: Number(stamp.filmMtimeMs ?? 0),
    ok: result.ok === true,
    checked: Number(result.checked ?? 0),
    problems: Array.isArray(result.problems) ? result.problems.slice(0, 40) : [],
    frames: (result.frames ?? []).map((frame) => ({
      t: frame.t,
      coverage: frame.coverage,
      contrast: frame.contrast,
      kind: frame.kind ?? '',
      problems: frame.problems ?? [],
    })),
  };
}

/**
 * Is a stored acceptance run still about the current film?
 * @param {object|null} record
 * @param {number} filmMtimeMs current film.html mtime
 */
export function isFresh(record, filmMtimeMs) {
  if (!record || record.ok !== true) return false;
  const recorded = Number(record.filmMtimeMs ?? 0);
  const current = Number(filmMtimeMs ?? 0);
  return recorded > 0 && current > 0 && Math.abs(current - recorded) < 1;
}

/**
 * The gate, as one sentence or nothing.
 *
 * Returns a warning when a planned film was never accepted, was edited after
 * its last acceptance, or failed it. Returns null when there is nothing to say
 * (no plan, or a fresh passing record).
 * @param {{ hasPlan: boolean, record: object|null, filmMtimeMs: number }} state
 */
export function acceptanceWarning(state = {}) {
  if (!state.hasPlan) return null;
  if (!state.record) return 'this film was planned but its frames were never accepted: run mise_verify before rendering';
  // A failed run is reported as a failure even after an edit: the film was
  // looked at and did not pass, which is more useful than "it changed".
  if (state.record.ok !== true) {
    return `frame acceptance failed at ${state.record.at ?? 'an earlier run'}: ${(state.record.problems?.[0] ?? 'see .film/verify.json').slice(0, 120)}`;
  }
  if (!isFresh(state.record, state.filmMtimeMs)) {
    return 'the film changed since its last frame acceptance: run mise_verify again before rendering';
  }
  return null;
}
