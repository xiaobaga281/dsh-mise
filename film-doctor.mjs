/**
 * What this machine can actually do, said plainly.
 *
 * The plugin is distributed: another person's machine may have no ffmpeg, an
 * older one without the filters a preset needs, no GPU, or a browser that has
 * never been downloaded. Rather than failing halfway through a render, the
 * doctor checks each capability up front and names the tier that will work.
 *
 * Pure by design: the caller supplies the probe results, so this is testable
 * without running anything.
 *
 * @module openfilm-film-doctor
 */

/** Filters a cinematic pass can use, and what they buy. */
export const OPTIONAL_FILTERS = {
  lut3d: '3D LUT grading',
  zscale: 'high-quality colour conversion',
  vignette: 'corner falloff',
  noise: 'film grain',
  gblur: 'soft bloom',
  curves: 'contrast shaping',
  minterpolate: 'frame interpolation (keyframe animation)',
  tmix: 'temporal smoothing',
};

/** Encoders the deliverable needs, and what they produce. */
export const REQUIRED_ENCODERS = {
  libx264: 'the H.264 picture in every delivered MP4',
  aac: 'the audio track in every delivered MP4',
};

/**
 * The copyable fix for a missing capability, per platform.
 * A recommendation nobody can paste is a shrug.
 * @param {string} id
 * @param {string} [platform]
 */
export function fixFor(id, platform = process.platform) {
  const unix = platform !== 'win32';
  switch (id) {
    case 'ffmpeg':
    case 'encoders':
      return unix
        ? 'sudo apt install ffmpeg   # or: brew install ffmpeg'
        : 'winget install Gyan.FFmpeg   # then reopen the terminal so PATH updates';
    case 'ffprobe':
      return unix ? 'sudo apt install ffmpeg   # ffprobe ships with it' : 'winget install Gyan.FFmpeg';
    case 'chromium':
      return 'Run mise_doctor once with network access; Playwright downloads its headless browser. Or: npx playwright install chromium-headless-shell';
    case 'cjk-fonts':
      return unix
        ? 'sudo apt install fonts-noto-cjk'
        : 'Install Source Han Sans / Noto Sans CJK, or keep titles in a Latin face';
    case 'minterpolate':
      return 'Use an ffmpeg build with minterpolate, or deliver at the keyframe rate (mise_interpolate refuses instead of guessing)';
    default:
      return '';
  }
}

/**
 * Turn probe results into a verdict.
 * @param {{
 *   platform?: string,
 *   node?: string,
 *   ffmpeg?: { ok: boolean, version?: string, filters?: string[], encoders?: string[] },
 *   ffprobe?: { ok: boolean },
 *   chromium?: { ok: boolean, path?: string },
 *   fonts?: { cjk?: boolean, list?: string[] },
 *   packs?: { installed?: string[], available?: string[] },
 *   keys?: Array<{ env: string, configured: boolean }>,
 * }} probe
 * @returns {{ ok: boolean, tier: string, checks: Array<object>, filters: object, recommendations: string[] }}
 */
export function assessEnvironment(probe = {}) {
  const platform = probe.platform ?? process.platform;
  const ffmpeg = probe.ffmpeg ?? { ok: false };
  const filters = ffmpeg.ok && Array.isArray(ffmpeg.filters) ? ffmpeg.filters : [];
  const encoders = ffmpeg.ok && Array.isArray(ffmpeg.encoders) ? ffmpeg.encoders : [];
  const has = (name) => filters.includes(name);
  const missingEncoders = Object.keys(REQUIRED_ENCODERS).filter((name) => !encoders.includes(name));
  // An ffmpeg that reports no encoders at all is not "missing x264", it is a
  // build we could not interrogate: do not fail the check over that.
  const encodersOk = !ffmpeg.ok || encoders.length === 0 || missingEncoders.length === 0;

  const checks = [
    {
      id: 'node',
      required: true,
      ok: true,
      detail: `Node ${probe.node ?? 'unknown'}`,
      fix: '',
    },
    {
      id: 'ffmpeg',
      required: true,
      ok: Boolean(ffmpeg.ok),
      detail: ffmpeg.ok ? `ffmpeg ${ffmpeg.version ?? ''} (${filters.length} filters seen)`.trim() : 'ffmpeg not found: rendering an MP4 is impossible without it',
      fix: fixFor('ffmpeg', platform),
    },
    {
      id: 'encoders',
      required: true,
      ok: encodersOk,
      detail: !ffmpeg.ok
        ? 'cannot be checked without ffmpeg'
        : encoders.length === 0
          ? 'this ffmpeg did not list encoders; assuming its default build works'
          : (missingEncoders.length ? `missing encoder(s): ${missingEncoders.join(', ')} — the MP4 will not be produced` : 'libx264 and aac present'),
      fix: missingEncoders.length ? fixFor('encoders', platform) : '',
    },
    {
      id: 'ffprobe',
      required: false,
      ok: Boolean(probe.ffprobe?.ok),
      detail: probe.ffprobe?.ok ? 'ffprobe found: media is measured, not guessed' : 'ffprobe missing: durations fall back to what was requested',
      fix: fixFor('ffprobe', platform),
    },
    {
      id: 'chromium',
      required: true,
      ok: Boolean(probe.chromium?.ok),
      detail: probe.chromium?.ok
        ? `browser at ${probe.chromium.path ?? 'a downloaded build'}`
        : 'no headless browser: look and render cannot draw a frame (open the plugin once online to fetch it)',
      fix: fixFor('chromium', platform),
    },
    {
      id: 'cjk-fonts',
      required: false,
      ok: probe.fonts?.cjk !== false,
      detail: probe.fonts?.cjk === false
        ? 'no CJK font found: Chinese titles and subtitles may fall back to boxes'
        : 'CJK fonts available',
      fix: fixFor('cjk-fonts', platform),
    },
  ];

  // The style floors. "cinematic" needs only the core toolchain; "layered" and
  // "animated" are what the optional packs add.
  const canRender = checks.every((c) => !c.required || c.ok);
  const interpolation = has('minterpolate');
  const gradeFilters = ['lut3d', 'curves', 'vignette', 'noise', 'gblur'].filter(has);

  let tier = 'unsupported';
  if (canRender) tier = 'cinematic';
  if (canRender && interpolation) tier = 'animated';
  if (canRender && interpolation && (probe.packs?.installed ?? []).length > 0) tier = 'layered';

  const recommendations = [];
  if (!ffmpeg.ok) recommendations.push('Install ffmpeg and put it on PATH (or set DSH_FFMPEG); nothing can be exported without it.');
  if (!probe.ffprobe?.ok) recommendations.push('Install ffprobe next to ffmpeg so every generated clip reports its real length and size.');
  if (!probe.chromium?.ok) recommendations.push('Run the plugin once with network access so Playwright fetches its headless browser.');
  if (ffmpeg.ok && !interpolation) recommendations.push('This ffmpeg has no minterpolate: keyframe animation will run at the keyframe rate instead of being interpolated.');
  if (ffmpeg.ok && gradeFilters.length < 3) recommendations.push(`Only some grading filters are present (${gradeFilters.join(', ') || 'none'}): use the page-level CSS grade instead of the post pass.`);
  if (probe.fonts?.cjk === false) recommendations.push('Add a CJK font (Source Han Sans/Noto Sans CJK) or keep titles in a latin face.');
  if ((probe.packs?.available ?? []).length > 0 && (probe.packs?.installed ?? []).length === 0) {
    recommendations.push(`Optional packs are available but not installed: ${(probe.packs?.available ?? []).join(', ')}. Install one to get true depth parallax or smoother animation.`);
  }

  // What each tier needs, so "why am I only cinematic" has an answer.
  const matrix = {
    cinematic: checks.filter((check) => check.required).map((check) => check.id),
    animated: [...checks.filter((check) => check.required).map((check) => check.id), 'filter minterpolate'],
    layered: [...checks.filter((check) => check.required).map((check) => check.id), 'filter minterpolate', 'an installed pack'],
  };

  // The fixes, in the order they block: a paste-ready command per missing piece.
  const nextSteps = checks
    .filter((check) => !check.ok && check.fix)
    .map((check) => ({ id: check.id, detail: check.detail, fix: check.fix }));

  return {
    ok: canRender,
    tier,
    checks,
    filters: Object.fromEntries(Object.entries(OPTIONAL_FILTERS).map(([id, why]) => [id, { ok: has(id), why }])),
    recommendations,
    matrix,
    nextSteps,
  };
}

/** The one-line answer for a panel or a tool. */
export function describeTier(report) {
  const map = {
    unsupported: 'cannot render here',
    cinematic: 'cinematic stills (zero downloads)',
    animated: 'cinematic + interpolated motion',
    layered: 'layered parallax (enhanced pack)',
  };
  return map[report?.tier] ?? 'unknown tier';
}

/**
 * The first thing a new machine should read.
 *
 * Not a manual: one line saying what this install can already do, the single
 * command that proves it, and — if something is missing — the one fix that
 * unblocks the most. A person who has never seen the plugin should be able to
 * get a film out without opening any documentation.
 *
 * @param {ReturnType<typeof assessEnvironment>} report
 */
export function startGuide(report) {
  const tier = report?.tier ?? 'unsupported';
  const headline = describeTier(report);
  const canDo = [];
  if (tier !== 'unsupported') {
    canDo.push('draw deterministic shots in a headless browser and cut them into a real MP4');
    canDo.push('compose its own score, duck it under narration and normalise it to -16 LUFS');
    canDo.push('accept its own frames (composition, motion, continuity) before you look at them');
  }
  if (tier === 'animated' || tier === 'layered') canDo.push('interpolate motion to a higher frame rate');
  if (tier === 'layered') canDo.push('use an installed pack (true depth parallax)');

  const blocking = (report?.nextSteps ?? [])[0] ?? null;
  if (blocking) {
    return {
      ok: false,
      tier,
      headline,
      canDo: [],
      firstStep: blocking.fix,
      reason: `${blocking.id}: ${blocking.detail}`,
      steps: report.nextSteps.map((step) => `${step.id}: ${step.fix}`),
    };
  }
  return {
    ok: true,
    tier,
    headline,
    canDo,
    firstStep: 'mise_demo genre="title-sequence" seconds=10   # a 10-second sample film, built and rendered here',
    reason: '',
    steps: [
      '先看样片：mise_demo（约一分钟，含渲染）',
      '再做真片：mise_plan 选类型 → 建页面 → mise_score / mise_mix',
      '交付前：mise_verify（抽帧）→ mise_review（逐镜批准）→ mise_deliver（回执）',
    ],
  };
}
