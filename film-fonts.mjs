/**
 * Fonts: one stack the pages share, and an honest warning when it cannot draw
 * the text.
 *
 * The plugin is distributed. On a machine without a CJK font a Chinese title
 * does not fall back to "slightly different Chinese" — it renders as boxes, and
 * the film is ruined in a way no colour grade can hide. This module keeps the
 * stack in one place and makes the risk a checkable fact rather than a surprise
 * at render time.
 *
 * @module openfilm-film-fonts
 */

/**
 * One stack, CJK first, with real families from every desktop.
 * A page that hard-codes its own list drifts from this within a month.
 */
export const FONT_STACK = [
  'Noto Sans SC',
  'Source Han Sans SC',
  'Microsoft YaHei',
  'PingFang SC',
  'Hiragino Sans GB',
  'Heiti SC',
  'WenQuanYi Zen Hei',
  'system-ui',
  'sans-serif',
];

/** The same stack as a CSS value. */
export function fontStack() {
  return FONT_STACK.map((family) => (family.includes(' ') ? `"${family}"` : family)).join(', ');
}

/** Does this text need CJK glyphs at all? */
export function hasCjk(text) {
  return /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff00-\uffef]/.test(String(text ?? ''));
}

/**
 * How risky is this text on this machine?
 * @param {{ text?: string, cjkAvailable?: boolean, latinOnly?: boolean }} spec
 * @returns {{ ok: boolean, needsCjk: boolean, problems: string[], advice: string }}
 */
export function fontRisk(spec = {}) {
  const needsCjk = hasCjk(spec.text);
  const cjkAvailable = spec.cjkAvailable !== false;
  if (!needsCjk) return { ok: true, needsCjk: false, problems: [], advice: '' };
  if (cjkAvailable) return { ok: true, needsCjk: true, problems: [], advice: '' };
  return {
    ok: false,
    needsCjk: true,
    problems: ['this machine has no CJK font: Chinese characters will render as empty boxes (tofu)'],
    advice: spec.latinOnly === true
      ? 'The film was asked to stay Latin: keep titles in a Latin face, or install a CJK font.'
      : 'Install a CJK font (Source Han Sans / Noto Sans CJK), or rewrite the titles in the face you have.',
  };
}

/**
 * Scan page sources for CJK and report once per project.
 * @param {Array<{ file: string, html: string }>} pages
 * @param {{ cjkAvailable?: boolean }} [env]
 */
export function projectFontRisk(pages, env = {}) {
  const risky = (pages ?? []).filter((page) => hasCjk(page?.html)).map((page) => page.file);
  const risk = fontRisk({ text: risky.length ? '字' : '', cjkAvailable: env.cjkAvailable });
  return {
    ok: risk.ok,
    needsCjk: risky.length > 0,
    files: risky,
    problems: risk.ok ? [] : risky.map((file) => `${file}: ${risk.problems[0]}`),
    advice: risk.ok ? '' : risk.advice,
  };
}
