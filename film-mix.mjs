/**
 * The mix: a score under the narration, with the music ducked by the voice.
 *
 * A bed that fights the voice is the fastest way to make a film sound amateur.
 * The plan here is the standard one from film sound: place each voice line at
 * its real time, use the voice as a sidechain to push the music down, sum them,
 * then normalise the result once — loudness for streaming, true peak under
 * clipping.
 *
 * Pure plan, so it can be tested without ffmpeg.
 *
 * @module openfilm-film-mix
 */

export const LOUDNESS_TARGET = { I: -16, TP: -1.5, LRA: 11 };

/**
 * @param {{ music: string, voices?: Array<{ path: string, at?: number }>, output: string, musicGain?: number, voiceGain?: number }} spec
 */
export function planMix(spec = {}) {
  const problems = [];
  if (typeof spec.music !== 'string' || !spec.music) problems.push('music file is required');
  if (typeof spec.output !== 'string' || !spec.output) problems.push('output file is required');
  const voices = Array.isArray(spec.voices) ? spec.voices.filter((v) => typeof v?.path === 'string' && v.path) : [];
  voices.forEach((voice, index) => {
    if (voice.at !== undefined && (!Number.isFinite(voice.at) || voice.at < 0)) problems.push(`voice ${index + 1}: at must be >= 0`);
  });
  const musicGain = Number(spec.musicGain ?? 1);
  const voiceGain = Number(spec.voiceGain ?? 1);
  if (!Number.isFinite(musicGain) || musicGain <= 0 || musicGain > 4) problems.push('musicGain must be 0..4');
  if (!Number.isFinite(voiceGain) || voiceGain <= 0 || voiceGain > 4) problems.push('voiceGain must be 0..4');
  if (problems.length) return { ok: false, problems };

  const normalise = `loudnorm=I=${LOUDNESS_TARGET.I}:TP=${LOUDNESS_TARGET.TP}:LRA=${LOUDNESS_TARGET.LRA}`;
  if (voices.length === 0) {
    return {
      ok: true,
      problems: [],
      loudness: LOUDNESS_TARGET,
      args: ['-y', '-hide_banner', '-loglevel', 'error', '-i', spec.music,
        '-af', `${normalise}`, '-c:a', 'aac', '-b:a', '192k', spec.output],
    };
  }

  const inputs = ['-i', spec.music];
  for (const voice of voices) inputs.push('-i', voice.path);
  const parts = [];
  parts.push(`[0:a]volume=${musicGain.toFixed(2)}[music]`);
  voices.forEach((voice, index) => {
    const delay = Math.round((Number(voice.at ?? 0)) * 1000);
    parts.push(`[${index + 1}:a]adelay=${delay}|${delay},volume=${voiceGain.toFixed(2)}[v${index}]`);
  });
  const voicesMix = voices.length === 1
    ? '[v0]asplit=2[voice][side]'
    : `${voices.map((_, index) => `[v${index}]`).join('')}amix=inputs=${voices.length}:normalize=0,asplit=2[voice][side]`;
  // sidechaincompress ends when the sidechain does, so a score would stop the
  // moment the last line ends. Pad the sidechain to the music's own length
  // (passed in from a probe) and the bed keeps playing to the end.
  const padTo = Number(spec.seconds ?? 0);
  // Sentence-level ducking: when the caller has read the voice into speech
  // regions, build the gain curve from those. It starts falling before the line
  // and comes back between lines — something a threshold compressor cannot do,
  // because it reacts after the first word instead of before it.
  const speech = Array.isArray(spec.speech)
    ? spec.speech.filter((run) => Number(run?.end) > Number(run?.start)).slice(0, 12)
    : [];
  if (speech.length) {
    const depth = Math.max(0, Math.min(0.9, Number(spec.duckDepth ?? 0.42)));
    const lead = Math.max(0.02, Number(spec.duckLead ?? 0.12));
    const release = Math.max(0.05, Number(spec.duckRelease ?? 0.3));
    const factors = speech.map((run) => {
      const inPoint = (Number(run.start) - lead).toFixed(3);
      const outPoint = (Number(run.end) + release).toFixed(3);
      return `(1-${depth}*min(clip((t-${inPoint})/${lead.toFixed(3)},0,1),clip((${outPoint}-t)/${release.toFixed(3)},0,1)))`;
    });
    // No sidechain branch at all here: an unused [side] output is a filtergraph
    // error, not a harmless leftover.
    parts.push('[v0]anull[voice]');
    if (voices.length > 1) {
      parts.pop();
      parts.push(`${voices.map((_, index) => `[v${index}]`).join('')}amix=inputs=${voices.length}:normalize=0[voice]`);
    }
    parts.push(`[music]volume=volume='${factors.join('*')}':eval=frame[ducked]`);
  } else {
    parts.push(voicesMix);
    if (Number.isFinite(padTo) && padTo > 0) parts.push(`[side]apad=whole_dur=${padTo.toFixed(3)}[sidepad]`);
    else parts.push('[side]anull[sidepad]');
    // No regions: fall back to the reactive compressor.
    parts.push('[music][sidepad]sidechaincompress=threshold=0.04:ratio=7:attack=12:release=420[ducked]');
  }
  // One normalisation, at delivery. Normalising here as well made the bed pump
  // with the voice: with the duck set to 58% the music measured 8.9% of its open
  // level during a line, because loudnorm was riding the voice too.
  parts.push('[ducked][voice]amix=inputs=2:weights=1 1:normalize=0,alimiter=limit=0.95[mix]');

  return {
    ok: true,
    problems: [],
    loudness: LOUDNESS_TARGET,
    filter: parts.join(';'),
    args: ['-y', '-hide_banner', '-loglevel', 'error', ...inputs, '-filter_complex', parts.join(';'),
      '-map', '[mix]', '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', spec.output],
  };
}
