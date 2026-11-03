/**
 * What moved, and how.
 *
 * A film can be checked shot by shot for being blank or badly kerned, and still
 * feel dead, because nothing said *how* the picture moved: whether the camera
 * travelled or a subject did, whether the motion spread across the frame or sat
 * in one corner, and whether it eased or ran at one speed like a progress bar.
 *
 * These are measurements, not opinions. Two consecutive frames give a change map
 * (where the picture differs), a coarse global shift (how far the whole frame
 * travelled), and from three or more samples a speed curve that says whether the
 * motion accelerates, decelerates or stays flat. Nothing here knows whether the
 * film is a lyric video or a product demo.
 *
 * @module mise-film-motion
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** Mean absolute difference of two grey frames, 0..255. */
export function frameDelta(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let sum = 0;
  let count = 0;
  for (let i = 0; i < a.length; i += 4) {
    sum += Math.abs(a[i] - b[i]);
    count += 1;
  }
  return Number((sum / Math.max(1, count)).toFixed(2));
}

/**
 * Where the picture changed, as a grid of cells.
 *
 * `coverage` is the share of cells that changed: a camera move or a dissolve
 * touches nearly all of them, a single subject moving touches a few. `centroid`
 * and `spread` say where that change sits and how tightly it is gathered.
 *
 * @param {Uint8Array} before grey plane
 * @param {Uint8Array} after grey plane
 * @param {number} width
 * @param {number} height
 * @param {{ cols?: number, rows?: number, threshold?: number, stride?: number }} [options]
 */
export function changeMap(before, after, width, height, { cols = 8, rows = 6, threshold = 6, stride = 3 } = {}) {
  if (!before || !after || before.length !== after.length) return null;
  const cells = [];
  let mass = 0;
  let mx = 0;
  let my = 0;
  let changed = 0;
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    const y0 = Math.floor((height * row) / rows);
    const y1 = Math.floor((height * (row + 1)) / rows);
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.floor((width * col) / cols);
      const x1 = Math.floor((width * (col + 1)) / cols);
      let sum = 0;
      let count = 0;
      for (let y = y0; y < y1; y += stride) {
        const base = y * width;
        for (let x = x0; x < x1; x += stride) {
          sum += Math.abs(after[base + x] - before[base + x]);
          count += 1;
        }
      }
      const value = Number((sum / Math.max(1, count)).toFixed(2));
      line.push(value);
      mass += value;
      mx += value * ((x0 + x1) / 2);
      my += value * ((y0 + y1) / 2);
      if (value >= threshold) changed += 1;
    }
    cells.push(line);
  }
  const total = cols * rows;
  const centroid = mass > 0 ? { x: Number((mx / mass / width).toFixed(3)), y: Number((my / mass / height).toFixed(3)) } : null;
  let spread = 0;
  if (mass > 0 && centroid) {
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        const value = cells[row][col];
        if (value <= 0) continue;
        const cx = (col + 0.5) / cols;
        const cy = (row + 0.5) / rows;
        spread += value * Math.hypot(cx - centroid.x, cy - centroid.y);
      }
    }
    spread = Number((spread / mass).toFixed(3));
  }
  // Does the change grow towards the edges? A push-in does; a dissolve does not.
  const flatCells = cells.flat();
  const meanCell = flatCells.reduce((a, b) => a + b, 0) / Math.max(1, flatCells.length);
  let cov = 0;
  let varCell = 0;
  let varDistance = 0;
  const meanDistance = flatCells.reduce((a, _, index) => a + Math.hypot(((index % cols) + 0.5) / cols - 0.5, ((Math.floor(index / cols)) + 0.5) / rows - 0.5), 0) / Math.max(1, flatCells.length);
  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const distance = Math.hypot((col + 0.5) / cols - 0.5, (row + 0.5) / rows - 0.5);
      cov += (cells[row][col] - meanCell) * (distance - meanDistance);
      varCell += (cells[row][col] - meanCell) ** 2;
      varDistance += (distance - meanDistance) ** 2;
    }
  }
  const denom = Math.sqrt(varCell * varDistance);
  return {
    coverage: Number((changed / total).toFixed(2)),
    strength: Number((mass / total).toFixed(2)),
    centroid,
    spread,
    radialBias: denom > 0 ? Number((cov / denom).toFixed(2)) : 0,
    cells,
  };
}

/**
 * How far the whole frame travelled, in pixels.
 *
 * A coarse search on a downsampled copy: the shift with the lowest residual is
 * the camera (or the world) moving. `confidence` is how much better that shift
 * fits than no shift at all — a subject moving inside a still frame leaves the
 * global shift at zero with low confidence, which is exactly the distinction
 * that matters.
 *
 * @param {Uint8Array} before
 * @param {Uint8Array} after
 * @param {number} width
 * @param {number} height
 * @param {{ range?: number, step?: number }} [options]
 */
export function globalShift(before, after, width, height, { range = 12, step = 2 } = {}) {
  if (!before || !after || before.length !== after.length) return null;
  // Work at a quarter of the size: 1080p becomes 480x270, and a 12px search
  // becomes 3px, which is still enough to tell a push from a still.
  const scale = 4;
  const w = Math.floor(width / scale);
  const h = Math.floor(height / scale);
  const small = (plane) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y += 1) {
      const base = y * scale * width;
      for (let x = 0; x < w; x += 1) out[y * w + x] = plane[base + x * scale];
    }
    return out;
  };
  const a = small(before);
  const b = small(after);
  const radius = Math.max(1, Math.round(range / scale));

  const residual = (dx, dy) => {
    let sum = 0;
    let count = 0;
    for (let y = radius; y < h - radius; y += 2) {
      for (let x = radius; x < w - radius; x += 2) {
        sum += Math.abs(b[(y + dy) * w + (x + dx)] - a[y * w + x]);
        count += 1;
      }
    }
    return count ? sum / count : Number.POSITIVE_INFINITY;
  };

  const still = residual(0, 0);
  let best = { dx: 0, dy: 0, residual: still };
  for (let dy = -radius; dy <= radius; dy += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      if (dx === 0 && dy === 0) continue;
      const value = residual(dx, dy);
      if (value < best.residual) best = { dx, dy, residual: value };
    }
  }
  const gain = still > 0 ? 1 - best.residual / still : 0;
  return {
    x: best.dx * scale,
    y: best.dy * scale,
    confidence: Number(clamp(gain, 0, 1).toFixed(2)),
    residual: Number(best.residual.toFixed(2)),
  };
}

/**
 * The speed curve, and what shape it has.
 *
 * A shot that moves at one constant speed reads as a progress bar; a shot that
 * arrives reads as mass. With three or more samples the curve can say which one
 * it is, and `smoothness` says how much the speed wobbles.
 *
 * @param {Array<{ t: number, change: number }>} samples
 */
export function speedCurve(intervals) {
  const list = (intervals ?? []).filter((entry) => Number.isFinite(entry?.t) && Number.isFinite(entry?.change));
  if (list.length === 0) return null;
  const speeds = list.map((entry) => Number((entry.change / Math.max(0.001, entry.dt ?? 1)).toFixed(2)));
  const max = Math.max(...speeds);
  const min = Math.min(...speeds);
  const mean = speeds.reduce((a, b) => a + b, 0) / speeds.length;
  // Three samples of a 6.5s push are not a curve, they are three points. Compare
  // the end to the start and let `smoothness` carry how much it wobbles between.
  const first = speeds[0];
  const last = speeds[speeds.length - 1];
  let trend = 'even';
  if (speeds.length >= 2) {
    if (last < first * 0.72) trend = 'decelerating';
    else if (last > first * 1.28) trend = 'accelerating';
  }
  return {
    speeds,
    mean: Number(mean.toFixed(2)),
    peak: Number(max.toFixed(2)),
    trend,
    smoothness: Number((mean > 0 ? (max - min) / mean : 0).toFixed(2)),
  };
}

/**
 * Put the two together for one shot.
 *
 * @param {{ width: number, height: number, frames: Array<{ t: number, gray: Uint8Array }> }} shot
 */
export function motionOf(shot) {
  const frames = (shot?.frames ?? []).filter((frame) => frame?.gray);
  if (frames.length < 2) return null;
  const pairs = [];
  for (let i = 1; i < frames.length; i += 1) {
    const before = frames[i - 1];
    const after = frames[i];
    const change = changeMap(before.gray, after.gray, shot.width, shot.height);
    const shift = globalShift(before.gray, after.gray, shot.width, shot.height);
    pairs.push({
      from: before.t,
      to: after.t,
      delta: frameDelta(before.gray, after.gray),
      coverage: change?.coverage ?? 0,
      centroid: change?.centroid ?? null,
      spread: change?.spread ?? 0,
      radialBias: change?.radialBias ?? 0,
      shift,
    });
  }
  const curve = speedCurve(pairs.map((pair) => ({ t: pair.to, dt: pair.to - pair.from, change: pair.delta ?? 0 })));
  // Camera or subject: a global shift that explains most of the change is the
  // camera; a change concentrated in a few cells with no shift is the subject.
  // What the change looks like, not what caused it. A pan translates the whole
  // frame and the shift is confident. A push-in, a dissolve and a lighting
  // change all move almost every cell without translating, and telling those
  // apart from pixels alone is guesswork — so they are reported as "global",
  // which is the fact, and the author knows which of the three they wrote.
  // A pan moves the whole picture, so it must show up in most cells as well as
  // in the shift: a single moving object can be "explained" by translating the
  // frame onto it, and that is not a camera move.
  const pan = pairs.filter((pair) => (pair.shift?.confidence ?? 0) > 0.25 && pair.coverage >= 0.6).length;
  const global = pairs.filter((pair) => (pair.shift?.confidence ?? 0) <= 0.25 && pair.coverage > 0.7).length;
  // Local change is local whatever a translation search thinks it can explain:
  // one moving object can be "matched" by shifting the frame onto it, but the
  // frame did not move — only 20% of it did.
  const subject = pairs.filter((pair) => pair.coverage < 0.5).length;
  const half = pairs.length / 2;
  const kind = pan > half ? 'pan' : global > half ? 'global' : subject > half ? 'subject' : 'mixed';
  return { pairs, curve, kind };
}
