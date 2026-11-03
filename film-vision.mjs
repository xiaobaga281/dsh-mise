/**
 * Describing what a frame looks like, without prescribing what it should look like.
 *
 * The plugin could already tell you a frame was blank, or that its text was
 * 1.4:1. It could not tell you the frame was 78% one blue, that its brightest
 * 5% sat in the top-left, or that it was the only shot in the film that went
 * warm. Those are the things a person means by "look", and they are measurable
 * without a taste: palette, tone, colour temperature, where the weight sits,
 * how much edge detail there is, and which row the horizon is on.
 *
 * Nothing here decides good or bad. `describeFrame` measures one picture,
 * `compareFrames` measures the distance between two, and `profileFrames`
 * measures a film against itself — so a shot that leaves the film's own palette
 * is caught whether the film is a night sea or a white product page.
 *
 * @module mise-film-vision
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/** #rrggbb for a triple. */
export function hex(r, g, b) {
  const part = (v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0');
  return `#${part(r)}${part(g)}${part(b)}`;
}

/** Distance between two RGB triples, 0..441. */
export function colorDistance(a, b) {
  const dr = a[0] - b[0];
  const dg = a[1] - b[1];
  const db = a[2] - b[2];
  return Math.sqrt(dr * dr + dg * dg + db * db);
}

/**
 * The colours that actually cover the frame, largest first.
 *
 * Coarse buckets first, then merge neighbours: a gradient has to read as two or
 * three colours, not as forty buckets of nearly the same blue.
 *
 * @param {Uint8Array} rgb 3 bytes per pixel
 * @param {{ max?: number, step?: number, merge?: number }} [options]
 */
export function paletteOf(rgb, { max = 6, step = 2, merge = 14 } = {}) {
  const bins = new Map();
  let total = 0;
  for (let i = 0; i < rgb.length; i += 3 * step) {
    const r = rgb[i];
    const g = rgb[i + 1];
    const b = rgb[i + 2];
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    const bin = bins.get(key);
    if (bin) {
      bin.r += r; bin.g += g; bin.b += b; bin.n += 1;
    } else {
      bins.set(key, { r, g, b, n: 1 });
    }
    total += 1;
  }
  const sorted = [...bins.values()]
    .map((bin) => ({ r: bin.r / bin.n, g: bin.g / bin.n, b: bin.b / bin.n, n: bin.n }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 40);

  const merged = [];
  for (const bin of sorted) {
    const near = merged.find((entry) => colorDistance([entry.r, entry.g, entry.b], [bin.r, bin.g, bin.b]) <= merge);
    if (near) {
      const weight = near.n + bin.n;
      near.r = (near.r * near.n + bin.r * bin.n) / weight;
      near.g = (near.g * near.n + bin.g * bin.n) / weight;
      near.b = (near.b * near.n + bin.b * bin.n) / weight;
      near.n = weight;
      continue;
    }
    merged.push({ ...bin });
  }
  return merged
    .sort((a, b) => b.n - a.n)
    .slice(0, max)
    .map((entry) => ({
      hex: hex(entry.r, entry.g, entry.b),
      rgb: [Math.round(entry.r), Math.round(entry.g), Math.round(entry.b)],
      share: Number((entry.n / Math.max(1, total)).toFixed(3)),
    }));
}

/** Luminance percentiles and clipping from the grey plane. */
export function toneOf(gray) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 1) histogram[gray[i]] += 1;
  const total = gray.length || 1;
  const at = (fraction) => {
    const target = Math.max(1, Math.floor(total * fraction));
    let seen = 0;
    for (let v = 0; v < 256; v += 1) {
      seen += histogram[v];
      if (seen >= target) return v;
    }
    return 255;
  };
  let sum = 0;
  for (let i = 0; i < gray.length; i += 1) sum += gray[i];
  const p5 = at(0.05);
  const p95 = at(0.95);
  return {
    mean: Number((sum / total).toFixed(1)),
    p1: at(0.01),
    p5,
    median: at(0.5),
    p95,
    p99: at(0.99),
    contrast: p95 - p5,
    black: Number((histogram.subarray(0, 5).reduce((a, b) => a + b, 0) / total).toFixed(3)),
    white: Number((histogram.subarray(251).reduce((a, b) => a + b, 0) / total).toFixed(3)),
  };
}

/** Saturation, warmth and how many hues are in play. */
export function colorOf(rgb) {
  let saturation = 0;
  let chromaSum = 0;
  let warmth = 0;
  let count = 0;
  const hueBins = new Uint32Array(12);
  for (let i = 0; i < rgb.length; i += 3 * 3) {
    const r = rgb[i] / 255;
    const g = rgb[i + 1] / 255;
    const b = rgb[i + 2] / 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    saturation += max > 0 ? chroma / max : 0;
    // Absolute chroma, not the HSV ratio: a near-black navy is 70% "saturated"
    // by the ratio and almost colourless to the eye. The ratio says how pure the
    // hue is; this says how much colour there actually is.
    chromaSum += chroma;
    warmth += r - b;
    if (chroma > 0.08) {
      let h;
      if (max === r) h = ((g - b) / chroma) % 6;
      else if (max === g) h = (b - r) / chroma + 2;
      else h = (r - g) / chroma + 4;
      hueBins[Math.round(((h * 60 + 360) % 360) / 30) % 12] += 1;
    }
    count += 1;
  }
  const chromaTotal = hueBins.reduce((a, b) => a + b, 0);
  // How spread the hues are: one hue is 0, an even wheel approaches 1.
  let entropy = 0;
  if (chromaTotal > 0) {
    for (const value of hueBins) {
      const p = value / chromaTotal;
      if (p > 0) entropy -= p * Math.log2(p);
    }
    entropy /= Math.log2(12);
  }
  return {
    saturation: Number((saturation / Math.max(1, count)).toFixed(3)),
    chroma: Number((chromaSum / Math.max(1, count)).toFixed(3)),
    warmth: Number((warmth / Math.max(1, count)).toFixed(3)),
    hueSpread: Number(entropy.toFixed(2)),
  };
}

/**
 * Where the weight sits, how much edge detail there is, and where the horizon is.
 *
 * "Weight" is ink against the frame's own background — the same measure
 * `inkGrid` uses to find an empty band, applied to the whole picture. A frame
 * that is 80% one tone has a centroid that means little; the numbers say so
 * rather than pretending otherwise.
 */
export function compositionOf(gray, width, height) {
  const histogram = new Uint32Array(256);
  for (let i = 0; i < gray.length; i += 3) histogram[gray[i]] += 1;
  let background = 0;
  let best = -1;
  for (let v = 0; v < 256; v += 1) if (histogram[v] > best) { best = histogram[v]; background = v; }

  let mass = 0;
  let mx = 0;
  let my = 0;
  let left = 0;
  let right = 0;
  let top = 0;
  let bottom = 0;
  const thirds = [0, 0, 0];
  for (let y = 0; y < height; y += 2) {
    for (let x = 0; x < width; x += 2) {
      const ink = Math.abs(gray[y * width + x] - background);
      if (ink <= 18) continue;
      mass += ink;
      mx += x * ink;
      my += y * ink;
      if (x < width / 2) left += ink; else right += ink;
      if (y < height / 2) top += ink; else bottom += ink;
      thirds[Math.min(2, Math.floor((y / height) * 3))] += ink;
    }
  }

  // Edge energy, and the row where horizontal edges pile up (a horizon, a rule).
  let edges = 0;
  let edgeCount = 0;
  const rowEnergy = new Float64Array(height);
  for (let y = 1; y < height - 1; y += 2) {
    let row = 0;
    for (let x = 1; x < width - 1; x += 2) {
      const at = y * width + x;
      const gx = gray[at + 1] - gray[at - 1];
      const gy = gray[at + width] - gray[at - width];
      const magnitude = Math.abs(gx) + Math.abs(gy);
      edges += magnitude;
      edgeCount += 1;
      // A horizon is a horizontal edge, so it shows up as change *along y*.
      // Summing the horizontal gradient found vertical edges and never a
      // horizon, which is why the row came back as zero on a test pattern
      // with a bright band across it.
      row += Math.abs(gy);
    }
    rowEnergy[y] = row;
  }
  let horizon = 0;
  let horizonRow = 0;
  for (let y = 0; y < height; y += 1) {
    if (rowEnergy[y] > horizon) { horizon = rowEnergy[y]; horizonRow = y; }
  }

  const total = left + right || 1;
  const vertical = top + bottom || 1;
  return {
    background,
    mass: Number((mass / Math.max(1, edgeCount)).toFixed(1)),
    centroid: mass > 0 ? { x: Number((mx / mass / width).toFixed(3)), y: Number((my / mass / height).toFixed(3)) } : null,
    balance: {
      horizontal: Number((left / total).toFixed(2)),
      vertical: Number((top / vertical).toFixed(2)),
      thirds: thirds.map((value) => Number((value / (thirds.reduce((a, b) => a + b, 0) || 1)).toFixed(2))),
    },
    edgeDensity: edgeCount ? Number((edges / edgeCount / 255).toFixed(3)) : 0,
    horizon: {
      row: Number((horizonRow / height).toFixed(3)),
      strength: Number((horizon / (width / 2) / 255).toFixed(3)),
    },
  };
}

/**
 * Where the detail is, and whether the frame has a focal plane.
 *
 * A photograph has a plane of focus: sharp somewhere, softer away from it. A
 * flat graphic has detail spread evenly, or almost none. Both are legitimate;
 * the difference is measurable, and it is the first thing that tells a viewer
 * "this was shot" rather than "this was drawn" — or the reverse.
 *
 * `radialSlope` is the correlation between local detail and distance from the
 * centre: negative means the middle is sharper than the edges (a subject in
 * focus), near zero means even detail (a graphic), positive means the edges
 * carry the detail (rare, and usually a frame with a sharp frame-line).
 *
 * @param {Uint8Array} gray
 * @param {number} width
 * @param {number} height
 * @param {{ cols?: number, rows?: number, stride?: number }} [options]
 */
export function detailOf(gray, width, height, { cols = 4, rows = 3, stride = 2 } = {}) {
  const tiles = [];
  const distances = [];
  let mass = 0;
  let mx = 0;
  let my = 0;
  let peak = 0;
  for (let row = 0; row < rows; row += 1) {
    const line = [];
    const y0 = Math.max(1, Math.floor((height * row) / rows));
    const y1 = Math.min(height - 2, Math.floor((height * (row + 1)) / rows));
    for (let col = 0; col < cols; col += 1) {
      const x0 = Math.max(1, Math.floor((width * col) / cols));
      const x1 = Math.min(width - 2, Math.floor((width * (col + 1)) / cols));
      let sum = 0;
      let count = 0;
      for (let y = y0; y <= y1; y += stride) {
        const base = y * width;
        for (let x = x0; x <= x1; x += stride) {
          const lap = Math.abs(4 * gray[base + x] - gray[base + x - 1] - gray[base + x + 1] - gray[base + width + x] - gray[base - width + x]);
          sum += lap;
          count += 1;
        }
      }
      const value = Number((sum / Math.max(1, count)).toFixed(2));
      line.push(value);
      peak = Math.max(peak, value);
      const cx = (col + 0.5) / cols;
      const cy = (row + 0.5) / rows;
      mass += value;
      mx += value * cx;
      my += value * cy;
      distances.push({ value, distance: Math.hypot(cx - 0.5, cy - 0.5) });
    }
    tiles.push(line);
  }

  const flat = tiles.flat().filter((value) => value < 2).length;
  const mean = mass / Math.max(1, tiles.flat().length);
  // Covariance of detail against distance from the centre, normalised by the
  // spread of both, so the number means the same thing at any resolution.
  let cov = 0;
  let varDetail = 0;
  let varDistance = 0;
  const meanDistance = distances.reduce((a, b) => a + b.distance, 0) / Math.max(1, distances.length);
  for (const entry of distances) {
    cov += (entry.value - mean) * (entry.distance - meanDistance);
    varDetail += (entry.value - mean) ** 2;
    varDistance += (entry.distance - meanDistance) ** 2;
  }
  const denom = Math.sqrt(varDetail * varDistance);
  return {
    tiles,
    peak: Number(peak.toFixed(1)),
    mean: Number(mean.toFixed(2)),
    flatness: Number((flat / Math.max(1, tiles.flat().length)).toFixed(2)),
    focus: mass > 0 ? { x: Number((mx / mass).toFixed(2)), y: Number((my / mass).toFixed(2)) } : null,
    radialSlope: denom > 0 ? Number((cov / denom).toFixed(2)) : 0,
  };
}

/**
 * Everything measurable about one frame.
 *
 * @param {{ rgb: Uint8Array, gray: Uint8Array, width: number, height: number }} image
 */
export function describeFrame(image) {
  const { rgb, gray, width, height } = image;
  return {
    palette: paletteOf(rgb),
    tone: toneOf(gray),
    color: colorOf(rgb),
    composition: compositionOf(gray, width, height),
    detail: detailOf(gray, width, height),
  };
}

/** How far apart two described frames are, in numbers a person can argue with. */
export function compareFrames(a, b) {
  const paletteDistance = (() => {
    if (!a?.palette?.length || !b?.palette?.length) return null;
    let weighted = 0;
    let weight = 0;
    for (const entry of a.palette) {
      const nearest = Math.min(...b.palette.map((other) => colorDistance(entry.rgb, other.rgb)));
      weighted += nearest * entry.share;
      weight += entry.share;
    }
    return weight > 0 ? Number(((weighted / weight) / 441 * 100).toFixed(1)) : null;
  })();
  return {
    palette: paletteDistance,
    medianLuma: a && b ? Math.abs(a.tone.median - b.tone.median) : null,
    contrast: a && b ? Math.abs(a.tone.contrast - b.tone.contrast) : null,
    saturation: a && b ? Number(Math.abs(a.color.saturation - b.color.saturation).toFixed(3)) : null,
    warmth: a && b ? Number(Math.abs(a.color.warmth - b.color.warmth).toFixed(3)) : null,
    centroid: a?.composition?.centroid && b?.composition?.centroid
      ? Number(Math.hypot(a.composition.centroid.x - b.composition.centroid.x, a.composition.centroid.y - b.composition.centroid.y).toFixed(3))
      : null,
    edgeDensity: a && b ? Number(Math.abs(a.composition.edgeDensity - b.composition.edgeDensity).toFixed(3)) : null,
  };
}

const median = (list) => {
  const sorted = [...list].sort((x, y) => x - y);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
};

/**
 * A film measured against itself.
 *
 * This is the part that adapts: no threshold is imposed from outside. The film's
 * own median tone and palette become the reference, each shot is measured
 * against it, and `spread` says whether the film is varied or monotonous. A
 * night sea and a white product page both get an honest answer, because the
 * answer is relative to the film.
 *
 * @param {Array<{ t: number, vision: object }>} shots
 */
export function profileFrames(shots) {
  const list = (shots ?? []).filter((shot) => shot?.vision);
  if (list.length === 0) return null;
  const reference = {
    median: median(list.map((shot) => shot.vision.tone.median)),
    contrast: median(list.map((shot) => shot.vision.tone.contrast)),
    saturation: median(list.map((shot) => shot.vision.color.chroma ?? shot.vision.color.saturation)),
    warmth: median(list.map((shot) => shot.vision.color.warmth)),
  };
  // The film's palette is the union of its shots' palettes, weighted by how much
  // of each frame they covered.
  const merged = [];
  for (const shot of list) {
    for (const entry of shot.vision.palette) {
      const near = merged.find((other) => colorDistance(other.rgb, entry.rgb) <= 18);
      if (near) {
        near.weight += entry.share;
      } else {
        merged.push({ rgb: entry.rgb, hex: entry.hex, weight: entry.share });
      }
    }
  }
  const palette = merged.sort((a, b) => b.weight - a.weight).slice(0, 8).map((entry) => ({
    hex: entry.hex,
    weight: Number((entry.weight / list.length).toFixed(2)),
  }));

  // Distance to the rest of the film, not to a union palette: a union contains
  // every shot's colours, so nothing could ever be an outlier in it. Pairwise
  // distance asks the only question that has an answer — does this shot differ
  // from the company it keeps?
  const distances = list.map((shot, index) => {
    const others = list.filter((_, other) => other !== index);
    const values = others.map((other) => compareFrames(shot.vision, other.vision).palette ?? 0);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
  });
  const shotsOut = list.map((shot, index) => ({
    t: shot.t,
    distance: {
      palette: Number(distances[index].toFixed(1)),
      median: Math.abs(shot.vision.tone.median - reference.median),
      warmth: Number(Math.abs(shot.vision.color.warmth - reference.warmth).toFixed(3)),
    },
  }));

  const medianDistance = median(distances);
  const threshold = Math.max(12, medianDistance * 1.8);
  return {
    reference,
    palette,
    shots: shotsOut,
    spread: {
      palette: Number((Math.max(...distances) - Math.min(...distances)).toFixed(1)),
      median: Math.max(...shotsOut.map((shot) => shot.distance.median)),
    },
    // Outliers are named, not judged: a shot far from the film's own palette is
    // either the point of the cut or an accident, and only the author knows.
    outliers: list.filter((_, index) => distances[index] > threshold && distances[index] > 6).map((shot) => shot.t),
  };
}
