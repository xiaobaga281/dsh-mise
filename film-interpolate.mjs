/**
 * Interpolation and depth, as the two things an enhancement pack adds.
 *
 * Both are expressed as plans first, so they can be validated and tested
 * without running ffmpeg or a model: a plan says exactly which command will
 * run, and a missing pack or a missing filter is refused before anything is
 * written.
 *
 * @module mise-film-interpolate
 */

/** Frame rates a delivery can ask for. */
const FPS_RANGE = [12, 120];

/**
 * Build the ffmpeg plan for a frame-rate lift.
 * @param {{ input: string, output: string, fps?: number, mode?: 'mci' | 'blend' }} request
 * @returns {{ ok: boolean, problems: string[], args?: string[], fps?: number, mode?: string }}
 */
export function planInterpolation(request = {}) {
  const problems = [];
  if (typeof request.input !== 'string' || !request.input) problems.push('input file is required');
  if (typeof request.output !== 'string' || !request.output) problems.push('output file is required');
  const fps = Number(request.fps ?? 60);
  if (!Number.isFinite(fps) || fps < FPS_RANGE[0] || fps > FPS_RANGE[1]) problems.push(`fps must be ${FPS_RANGE[0]}..${FPS_RANGE[1]}`);
  const mode = request.mode === 'blend' ? 'blend' : 'mci';
  if (problems.length) return { ok: false, problems };
  // mci = motion-compensated interpolation (slower, far fewer artefacts);
  // blend is the cheap fallback for footage the estimator cannot handle.
  const filter = mode === 'blend'
    ? `minterpolate=fps=${fps}:mi_mode=blend`
    : `minterpolate=fps=${fps}:mi_mode=mci:mc_mode=aobmc:me_mode=bidir:vsbmc=1`;
  return {
    ok: true,
    problems: [],
    fps,
    mode,
    // Audio is copied, not dropped: interpolating frames must not turn a film
    // silent (a delivered clip with no sound still looks like a successful run).
    args: ['-y', '-hide_banner', '-loglevel', 'error', '-i', request.input, '-vf', filter, '-c:v', 'libx264', '-preset', 'medium', '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', request.output],
  };
}

/**
 * Build a depth-map run plan from an installed pack.
 *
 * A pack declares how to produce a depth PNG: a JS module (`entry` ending in
 * .mjs/.js) called with `{ image, out }`, or an executable called with
 * `args` in which `{{image}}` and `{{out}}` are replaced.
 * @param {{ pack?: object, image: string, output: string }} request
 * @returns {{ ok: boolean, problems: string[], kind?: 'module' | 'exec', entry?: string, args?: string[] }}
 */
export function planDepth(request = {}) {
  const problems = [];
  const pack = request.pack;
  if (!pack || pack.ok === false) problems.push('no verified depth pack is installed (mise_pack install, or `mise_pack list`)');
  if (typeof request.image !== 'string' || !request.image) problems.push('image is required');
  if (typeof request.output !== 'string' || !request.output) problems.push('output is required');
  if (problems.length) return { ok: false, problems };
  if (pack.kind !== 'depth') return { ok: false, problems: [`pack ${pack.name} is kind ${pack.kind}, not depth`] };
  const entry = pack.entry;
  if (typeof entry !== 'string' || !entry) return { ok: false, problems: [`pack ${pack.name} declares no entry`] };
  if (/\.(mjs|js)$/i.test(entry)) {
    return { ok: true, problems: [], kind: 'module', entry };
  }
  const template = Array.isArray(pack.args) && pack.args.length ? pack.args : ['--image', '{{image}}', '--out', '{{out}}'];
  return {
    ok: true,
    problems: [],
    kind: 'exec',
    entry,
    args: template.map((part) => String(part).replace(/\{\{image\}\}/g, request.image).replace(/\{\{out\}\}/g, request.output)),
  };
}
