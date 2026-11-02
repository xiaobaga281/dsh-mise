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
 * @module openfilm-film-audio
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
