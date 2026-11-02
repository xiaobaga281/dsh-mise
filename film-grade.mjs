/**
 * One grade for the whole film, applied after the render.
 *
 * Pages can carry a CSS look, but a film needs a single finish: the same
 * contrast curve, saturation, grain, corner falloff and bloom on every shot, so
 * no cut changes the world. ffmpeg does it in one pass — portable, deterministic
 * and fast — and the tool says which filters this build actually has.
 *
 * @module openfilm-film-grade
 */

/**
 * The loudness a piece of this length should land at.
 *
 * Streaming practice, not taste: short pieces are watched on phones at whatever
 * volume they happen to be, so they are mastered hotter; a long piece is a
 * deliberate watch and is mastered to the usual -16. Anything in between gets
 * the middle value, so the step never sounds like a jump between two films.
 * @param {number} [seconds]
 */
export function targetLufs(seconds) {
  const value = Number(seconds);
  if (!Number.isFinite(value) || value <= 0) return -16;
  if (value <= 20) return -14;
  if (value <= 45) return -15;
  return -16;
}

/** Why that target, in one line, for the receipt. */
export function loudnessReason(seconds) {
  const value = Number(seconds);
  const target = targetLufs(value);
  if (target === -14) return `${Number(value).toFixed(1)}s 短片按 −14 LUFS 母带（手机外放、无音量预期）`;
  if (target === -15) return `${Number(value).toFixed(1)}s 中片按 −15 LUFS 母带（介于外放与专注观看之间）`;
  return `${Number.isFinite(value) && value > 0 ? `${Number(value).toFixed(1)}s 长片` : '片长未知'}按 −16 LUFS 母带（流媒体常规）`;
}

/** The looks a film can be finished in. */
export const GRADE_PRESETS = {
  none: [],
  'warm-film': ['colorbalance=rs=.03:gs=-.012:bs=-.045:rm=.02:bm=-.02', 'eq=contrast=1.06:saturation=1.06:gamma=0.99'],
  'teal-orange': ['colorbalance=rs=.055:bs=.06:gm=-.01', 'eq=contrast=1.08:saturation=1.12'],
  noir: ['hue=s=0', 'eq=contrast=1.16:brightness=-0.01'],
  clean: ['eq=contrast=1.03:saturation=1.02'],
  'faded-print': ['curves=preset=strong_contrast', 'eq=saturation=0.86:brightness=0.02', 'colorbalance=rs=.05:bs=.03'],
  // The filmic look: a contrast curve with a lifted, slightly warm toe and a
  // softened shoulder, so blacks sit at ~2% instead of 0 and highlights roll
  // off instead of clipping. This is the single biggest "looks shot" lever.
  filmic: [
    // Measured against a dark page: the previous curve (toe 0.02 + contrast
    // 1.04 + a blue-negative balance) turned 52% of a title frame into pure
    // black. This one keeps the film's mean (16.9 -> 18.8) while lifting the
    // floor to zero crushed pixels and holding the edge energy.
    "curves=master='0/0.03 0.25/0.26 0.5/0.52 0.75/0.77 1/0.98'",
    'colorbalance=rs=.025:bs=-.015',
    'eq=saturation=1.02:contrast=1.02',
  ],
};

/**
 * @param {{ input: string, output: string, preset?: string, grain?: number, vignette?: number, bloom?: number, letterbox?: number, crf?: number, seconds?: number, targetLufs?: number, normalizeAudio?: boolean }} spec
 * @param {{ filters?: string[] }} [env]
 */
export function planGrade(spec = {}, env = {}) {
  const problems = [];
  if (typeof spec.input !== 'string' || !spec.input) problems.push('input is required');
  if (typeof spec.output !== 'string' || !spec.output) problems.push('output is required');
  const preset = spec.preset ?? 'warm-film';
  if (!(preset in GRADE_PRESETS)) problems.push(`unknown preset ${JSON.stringify(preset)}; there is ${Object.keys(GRADE_PRESETS).join(', ')}`);
  const grain = Number(spec.grain ?? 0.10);
  // A dark film plus a strong vignette is a film with no corner detail. Measured
  // on this film: vignette 0.4 crushed 23% of a title frame to pure black, 0.2
  // left 1%. The ceiling is the value where a corner falloff stays a falloff.
  const VIGNETTE_CEILING = 0.16;
  const vignette = Math.min(VIGNETTE_CEILING, Math.max(0, Number(spec.vignette ?? 0.35)));
  const bloom = Number(spec.bloom ?? 0);
  // Bars are a delivery choice, measured as a fraction of height per side.
  const letterbox = Math.max(0, Number(spec.letterbox ?? 0));
  if (!Number.isFinite(grain) || grain < 0 || grain > 1) problems.push('grain must be 0..1');
  if (!Number.isFinite(vignette) || vignette < 0 || vignette > 1) problems.push('vignette must be 0..1');
  if (!Number.isFinite(bloom) || bloom < 0 || bloom > 1) problems.push('bloom must be 0..1');
  if (!Number.isFinite(letterbox) || letterbox < 0 || letterbox > 0.45) problems.push('letterbox must be 0..0.45 (fraction of height per bar)');
  if (problems.length) return { ok: false, problems };

  const available = new Set(Array.isArray(env.filters) ? env.filters : []);
  const chain = [...(GRADE_PRESETS[preset] ?? [])];

  if (grain > 0.001 && available.has('noise')) {
    // Fine temporal grain reads as film; heavy grain reads as a filter.
    chain.push(`noise=alls=${Math.round(2 + grain * 26)}:allf=t+u`);
  }
  if (vignette > 0.001 && available.has('vignette')) {
    chain.push(`vignette=angle=${(0.18 + 0.5 * vignette).toFixed(4)}`);
  }
  if (letterbox > 0.001) {
    chain.push(
      `drawbox=x=0:y=0:w=iw:h=ih*${letterbox.toFixed(4)}:color=black:t=fill`,
      `drawbox=x=0:y=ih*(1-${letterbox.toFixed(4)}):w=iw:h=ih*${letterbox.toFixed(4)}:color=black:t=fill`,
    );
  }

  const bloomOpacity = (0.35 * bloom).toFixed(3);
  let filter = chain.join(',');
  if (bloom > 0.001 && available.has('gblur') && available.has('blend')) {
    filter = `${filter},split=2[base][glow];[glow]gblur=sigma=22[soft];[base][soft]blend=all_mode=screen:all_opacity=${bloomOpacity}`;
  }

  const crf = Number(spec.crf ?? 17);
  const target = Number.isFinite(Number(spec.targetLufs)) ? Number(spec.targetLufs) : targetLufs(spec.seconds);
  const audio = spec.normalizeAudio === true
    // Delivery wants the mix at the loudness its length will be heard at: a
    // 15-second piece is played on a phone with no volume intent, a minute-long
    // piece is watched deliberately. One fixed -16 made short films quiet.
    // loudnorm resamples to 192k internally, so the output rate is pinned:
    // a delivered file should be 48k like everything else, not 96k by accident.
    // loudnorm's own true-peak guard is not enough once AAC re-encodes: measured
    // -0.55 dBTP on a deliverable that asked for -1.5. A limiter after it holds
    // the ceiling the receipt claims.
    ? ['-af', `loudnorm=I=${target}:TP=-2.5:LRA=11,alimiter=limit=0.72:level=false`, '-ar', '48000', '-c:a', 'aac', '-b:a', '192k', '-threads', '4']
    : ['-c:a', 'copy'];
  return {
    ok: true,
    problems: [],
    filter,
    args: ['-y', '-hide_banner', '-loglevel', 'error', '-i', spec.input, '-vf', filter,
      '-c:v', 'libx264', '-preset', 'slow', '-crf', String(Number.isFinite(crf) ? crf : 17), '-pix_fmt', 'yuv420p',
      ...audio, spec.output],
  };
}
