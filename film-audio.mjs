/**
 * Audio, read as data a page can animate to.
 *
 * A film's picture can follow its sound without shipping an audio engine into
 * the page: read the WAV once, reduce it to an envelope (loudness per video
 * frame), and let the page look that array up. That keeps the render
 * deterministic — the same file always gives the same frames — and it works for
 * any WAV the score tool (or a person) wrote.
 *
 * Reads 16-bit PCM WAV, which is what `mise_score` writes and what ffmpeg
 * converts to on request.
 *
 * @module mise-film-audio
 */

/** Read a little-endian chunk size and keep walking past odd padding. */
function readWav(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 44) throw new Error('not a WAV buffer');
  if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('not a WAV file (RIFF/WAVE header missing)');
  }
  let offset = 12;
  let fmt = null;
  let data = null;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString('ascii', offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const start = offset + 8;
    if (id === 'fmt ') {
      fmt = {
        channels: buffer.readUInt16LE(start + 2),
        sampleRate: buffer.readUInt32LE(start + 4),
        bits: buffer.readUInt16LE(start + 14),
      };
    } else if (id === 'data') {
      data = { start, size: Math.min(size, buffer.length - start) };
    }
    offset = start + size + (size % 2);
  }
  if (!fmt || !data) throw new Error('WAV missing fmt or data chunk');
  if (fmt.bits !== 16) throw new Error(`only 16-bit PCM is supported (got ${fmt.bits}-bit)`);
  return { fmt, data };
}

/**
 * Loudness per video frame: RMS of the samples in that frame, normalised to the
 * loudest frame so the page gets 0..1.
 * @param {Buffer} buffer WAV bytes
 * @param {{ fps?: number }} [options]
 * @returns {{ duration: number, fps: number, values: number[], peaks: number[] }}
 */
export function wavEnvelope(buffer, options = {}) {
  const { fmt, data } = readWav(buffer);
  const fps = Number(options.fps ?? 30);
  const sampleRate = fmt.sampleRate;
  const channels = fmt.channels;
  const totalFrames = Math.floor(data.size / (2 * channels));
  const duration = totalFrames / sampleRate;
  const frames = Math.max(1, Math.ceil(duration * fps));
  const values = new Array(frames).fill(0);
  const peaks = new Array(frames).fill(0);
  const perFrame = sampleRate / fps;

  for (let f = 0; f < frames; f += 1) {
    const from = Math.floor(f * perFrame);
    const to = Math.min(totalFrames, Math.floor((f + 1) * perFrame));
    if (to <= from) continue;
    let sum = 0;
    let peak = 0;
    for (let i = from; i < to; i += 1) {
      // Average the channels, so a stereo file gives one number per frame.
      let mixed = 0;
      for (let c = 0; c < channels; c += 1) {
        mixed += buffer.readInt16LE(data.start + (i * channels + c) * 2) / 32768;
      }
      mixed /= channels;
      sum += mixed * mixed;
      peak = Math.max(peak, Math.abs(mixed));
    }
    values[f] = Math.sqrt(sum / (to - from));
    peaks[f] = peak;
  }

  const max = Math.max(1e-6, ...values);
  return {
    duration,
    fps,
    values: values.map((v) => Number((v / max).toFixed(4))),
    peaks: peaks.map((p) => Number(Math.min(1, p).toFixed(4))),
  };
}

/**
 * Where the speaker actually speaks.
 *
 * A ducking threshold applied to the whole track cannot tell a pause from a
 * quiet word, so the music either drops under a consonant or never recovers
 * between sentences. Reading the envelope into regions gives the mixer real
 * boundaries: it can duck before the line starts and lift between the lines.
 *
 * @param {{ values: number[], fps: number, duration: number }} envelope
 * @param {{ threshold?: number, minGap?: number, minLength?: number, lead?: number, tail?: number }} [options]
 * @returns {Array<{ start: number, end: number }>}
 */
export function speechRegions(envelope, options = {}) {
  const threshold = Number(options.threshold ?? 0.06);
  // Sentences are separated by longer pauses than words inside one: 0.35s is
  // the shortest gap that reads as a boundary rather than a comma.
  const minGap = Number(options.minGap ?? 0.35);
  const minLength = Number(options.minLength ?? 0.12);
  const lead = Number(options.lead ?? 0.1);
  const tail = Number(options.tail ?? 0.22);
  const fps = Number(envelope?.fps ?? 30) || 30;
  const values = Array.isArray(envelope?.values) ? envelope.values : [];
  const duration = Number(envelope?.duration ?? values.length / fps);

  const runs = [];
  let start = null;
  values.forEach((value, index) => {
    const speaking = Number(value) >= threshold;
    if (speaking && start === null) start = index;
    if (!speaking && start !== null) {
      runs.push({ start: start / fps, end: index / fps });
      start = null;
    }
  });
  if (start !== null) runs.push({ start: start / fps, end: duration });

  // Bridge pauses shorter than minGap: a comma is not a sentence.
  const merged = [];
  for (const run of runs) {
    const previous = merged[merged.length - 1];
    if (previous && run.start - previous.end < minGap) previous.end = run.end;
    else merged.push({ ...run });
  }
  return merged
    .filter((run) => run.end - run.start >= minLength)
    .map((run) => ({
      start: Number(Math.max(0, run.start - lead).toFixed(3)),
      end: Number(Math.min(duration, run.end + tail).toFixed(3)),
    }))
    .filter((run) => run.end > run.start);
}

/** The envelope, downsampled to a page-friendly precision of decimals. */
export function envelopeForPage(envelope) {
  return envelope.values.map((value) => Number(value.toFixed(3)));
}

// ── the delivery side: is this music fit to ship? ────────────────────────
//
// The music is judged twice in a real production: once by the ear, once by the
// numbers the industry already agreed on — EBU R 128 and ATSC A/85 for loudness,
// ITU-R BS.1770 behind both, and the mix practice that keeps a bed out of the
// voice's way (intelligibility lives around 1–4 kHz; a bed usually sits 12–18 dB
// under dialogue). Nothing here says whether the tune is good. It says whether
// the file is deliverable and whether it is a drone.

/** Decode the data chunk into per-channel float arrays, plus a mono mix. */
export function samplesOf(buffer) {
  const { fmt, data } = readWav(buffer);
  const frames = Math.floor(data.size / (2 * fmt.channels));
  const list = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  const mono = new Float32Array(frames);
  for (let i = 0; i < frames; i += 1) {
    let sum = 0;
    for (let c = 0; c < fmt.channels; c += 1) {
      const value = buffer.readInt16LE(data.start + (i * fmt.channels + c) * 2) / 32768;
      list[c][i] = value;
      sum += value;
    }
    mono[i] = sum / fmt.channels;
  }
  return { samples: mono, channels: list, sampleRate: fmt.sampleRate, channelCount: fmt.channels, seconds: frames / fmt.sampleRate };
}

/**
 * The K-weighting curve, as two biquads.
 *
 * BS.1770 specifies the curve, not the coefficients — they are derived per
 * sample rate. These are RBJ designs of the same shape (a +4 dB shelf above
 * ~1.5 kHz and a 38 Hz high-pass). That is enough to compare one file against
 * another and against a target; an absolute reading may sit a tenth of a unit
 * away from a reference meter, and the receipt says so.
 */
function kWeight(samples, sampleRate) {
  let signal = Float32Array.from(samples);
  for (const stage of [shelfCoefficients(sampleRate, 1500, 4, 0.7071), highpassCoefficients(sampleRate, 38, 0.5)]) {
    const out = new Float32Array(signal.length);
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < signal.length; i += 1) {
      const x0 = signal[i];
      const y0 = stage.b0 * x0 + stage.b1 * x1 + stage.b2 * x2 - stage.a1 * y1 - stage.a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      out[i] = y0;
    }
    signal = out;
  }
  return signal;
}

function shelfCoefficients(sr, freq, gainDb, q) {
  const A = Math.pow(10, gainDb / 40);
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const root = Math.sqrt(A);
  const a0 = (A + 1) - (A - 1) * cos + 2 * root * alpha;
  return {
    b0: (A * ((A + 1) + (A - 1) * cos + 2 * root * alpha)) / a0,
    b1: (-2 * A * ((A - 1) + (A + 1) * cos)) / a0,
    b2: (A * ((A + 1) + (A - 1) * cos - 2 * root * alpha)) / a0,
    a1: (2 * ((A - 1) - (A + 1) * cos)) / a0,
    a2: ((A + 1) - (A - 1) * cos - 2 * root * alpha) / a0,
  };
}

function highpassCoefficients(sr, freq, q) {
  const w0 = (2 * Math.PI * freq) / sr;
  const alpha = Math.sin(w0) / (2 * q);
  const cos = Math.cos(w0);
  const a0 = 1 + alpha;
  return {
    b0: ((1 + cos) / 2) / a0,
    b1: (-(1 + cos)) / a0,
    b2: ((1 + cos) / 2) / a0,
    a1: (-2 * cos) / a0,
    a2: (1 - alpha) / a0,
  };
}

const toLufs = (meanSquare) => -0.691 + 10 * Math.log10(Math.max(1e-12, meanSquare));

/**
 * Integrated loudness: 400 ms blocks every 100 ms, absolute then relative gate.
 *
 * Channels are summed by power, as BS.1770 specifies — averaging them into mono
 * first makes a stereo bed read about 3 LU quieter than the same signal played
 * out of two speakers, which is the difference between passing and failing a
 * delivery target.
 */
export function integratedLoudness(samples, sampleRate) {
  const list = Array.isArray(samples) ? samples : [samples];
  const weighted = list.map((channel) => kWeight(channel, sampleRate));
  const block = Math.round(sampleRate * 0.4);
  const hop = Math.round(sampleRate * 0.1);
  if (block < 1 || !weighted[0] || weighted[0].length < block) return null;
  const blocks = [];
  for (let start = 0; start + block <= weighted[0].length; start += hop) {
    let sum = 0;
    for (const channel of weighted) {
      for (let i = start; i < start + block; i += 1) sum += channel[i] * channel[i];
    }
    blocks.push(sum / block);
  }
  const absoluteGate = Math.pow(10, (-70 + 0.691) / 10);
  const above = blocks.filter((value) => value >= absoluteGate);
  if (!above.length) return { lufs: -70, gated: 0, blocks: blocks.length };
  const firstPass = toLufs(above.reduce((a, b) => a + b, 0) / above.length);
  const relativeGate = Math.pow(10, (firstPass - 10 + 0.691) / 10);
  const kept = above.filter((value) => value >= relativeGate);
  const gated = kept.length ? kept : above;
  return {
    lufs: Number(toLufs(gated.reduce((a, b) => a + b, 0) / gated.length).toFixed(1)),
    gated: gated.length,
    blocks: blocks.length,
  };
}

/** Short-term loudness every second (3 s windows). */
export function shortTermLoudness(samples, sampleRate) {
  const weighted = kWeight(samples, sampleRate);
  const window = Math.round(sampleRate * 3);
  const hop = Math.round(sampleRate * 1);
  if (weighted.length < window) return [];
  const out = [];
  for (let start = 0; start + window <= weighted.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + window; i += 1) sum += weighted[i] * weighted[i];
    out.push(toLufs(sum / window));
  }
  return out;
}

/** EBU R 128 loudness range: the 10th to 95th percentile of the short-term series. */
export function loudnessRange(series) {
  if (!series || series.length < 2) return null;
  const sorted = [...series].sort((a, b) => a - b);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round(fraction * (sorted.length - 1))))];
  return Number((at(0.95) - at(0.1)).toFixed(1));
}

/** Sample peak, plus the conventional 0.3 dB allowance for inter-sample peaks. */
export function peaks(samples) {
  let peak = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const value = Math.abs(samples[i]);
    if (value > peak) peak = value;
  }
  const sampleDb = peak > 0 ? 20 * Math.log10(peak) : -120;
  return { sampleDb: Number(sampleDb.toFixed(2)), truePeakDb: Number((sampleDb + 0.3).toFixed(2)) };
}

/** In-place radix-2 FFT. */
function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const tr = re[i]; re[i] = re[j]; re[j] = tr;
      const ti = im[i]; im[i] = im[j]; im[j] = ti;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const angle = (-2 * Math.PI) / len;
    for (let i = 0; i < n; i += len) {
      for (let k = 0; k < len / 2; k += 1) {
        const wr = Math.cos(angle * k);
        const wi = Math.sin(angle * k);
        const ur = re[i + k];
        const ui = im[i + k];
        const vr = re[i + k + len / 2] * wr - im[i + k + len / 2] * wi;
        const vi = re[i + k + len / 2] * wi + im[i + k + len / 2] * wr;
        re[i + k] = ur + vr;
        im[i + k] = ui + vi;
        re[i + k + len / 2] = ur - vr;
        im[i + k + len / 2] = ui - vi;
      }
    }
  }
}

/** The bands a mix is judged by, and what each one does to a voice. */
export const BANDS = [
  { id: 'sub', from: 20, to: 80, note: 'rumble; mostly wasted on a phone speaker' },
  { id: 'low', from: 80, to: 300, note: 'weight' },
  { id: 'mid', from: 300, to: 1000, note: 'body' },
  { id: 'presence', from: 1000, to: 4000, note: 'where consonants live; a bed here masks a voice' },
  { id: 'air', from: 4000, to: 16000, note: 'detail' },
];

/** Share of the audible energy in each band, from a Hann-windowed FFT. */
export function spectrum(samples, sampleRate) {
  const size = 2048;
  const hop = 1024;
  const window = new Float64Array(size);
  for (let i = 0; i < size; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (size - 1));
  const energy = new Float64Array(BANDS.length);
  let frames = 0;
  for (let start = 0; start + size <= samples.length; start += hop) {
    const re = new Float64Array(size);
    const im = new Float64Array(size);
    for (let i = 0; i < size; i += 1) re[i] = samples[start + i] * window[i];
    fft(re, im);
    for (let bin = 1; bin < size / 2; bin += 1) {
      const hz = (bin * sampleRate) / size;
      if (hz < 20 || hz > 16000) continue;
      const power = re[bin] * re[bin] + im[bin] * im[bin];
      for (let b = 0; b < BANDS.length; b += 1) {
        if (hz >= BANDS[b].from && hz < BANDS[b].to) { energy[b] += power; break; }
      }
    }
    frames += 1;
  }
  const total = energy.reduce((a, b) => a + b, 0) || 1;
  return {
    frames,
    shares: Object.fromEntries(BANDS.map((band, index) => [band.id, Number((energy[index] / total).toFixed(3))])),
  };
}

/**
 * Everything a delivery spec would ask of one music file.
 *
 * `targetLufs` follows the destination, not taste: −23 for EBU R 128, −24 for
 * ATSC A/85, −14 for streaming, −16 for podcast. The caller passes the one it
 * means; the receipt says which.
 *
 * @param {Buffer} buffer WAV bytes
 * @param {{ targetLufs?: number, truePeakCeiling?: number }} [options]
 */
export function auditAudio(buffer, { targetLufs = -14, truePeakCeiling = -1 } = {}) {
  let decoded;
  try { decoded = samplesOf(buffer); } catch (error) { return { ok: false, problems: [String(error?.message ?? error)] }; }
  const loudness = integratedLoudness(decoded.channels ?? decoded.samples, decoded.sampleRate);
  const series = shortTermLoudness(decoded.samples, decoded.sampleRate);
  const range = loudnessRange(series);
  const peak = peaks(decoded.samples);
  const bands = spectrum(decoded.samples, decoded.sampleRate);
  const problems = [];
  const notes = [];
  const gap = loudness ? targetLufs - loudness.lufs : 0;
  if (gap > 1) {
    notes.push(`${gap.toFixed(1)} LU under the ${targetLufs} LUFS target — a platform would turn it up, or a viewer would turn it down`);
  }
  if (peak.truePeakDb > truePeakCeiling) {
    problems.push(`true peak ${peak.truePeakDb} dBTP is over the ${truePeakCeiling} dBTP ceiling`);
  }
  if (range !== null && range < 2) notes.push('loudness range under 2 LU: one level from the first frame to the last');
  // Silence is part of an arrangement: a bed that never rests gives the picture
  // nowhere to return from. Measured, not advised.
  if (series.length >= 3) {
    const sorted = [...series].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    if (sorted[0] > median - 4) notes.push('the bed never drops — one silent beat before the last shot makes the return land');
  }
  if (bands.shares.presence > 0.45) notes.push(`${Math.round(bands.shares.presence * 100)}% of the energy is in 1–4 kHz, where a voice lives`);
  return {
    ok: problems.length === 0,
    seconds: Number(decoded.seconds.toFixed(2)),
    sampleRate: decoded.sampleRate,
    loudness: loudness?.lufs ?? null,
    range,
    peak: peak.truePeakDb,
    spectrum: bands.shares,
    problems,
    notes,
  };
}
