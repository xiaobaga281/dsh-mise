/**
 * The page-side floor: mise-kit, and the measurements mise_probe makes with it.
 *
 * These are the functions a hand-written shot leans on, so they are tested as
 * arithmetic rather than as pixels: a contrast ratio that is off by a tenth is
 * still a wrong answer, and an ink chooser that returns the unreadable of two
 * options is worse than no helper at all.
 *
 *   node tests/kit.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const kit = new URL('../vendor/motion/mise-kit.mjs', import.meta.url).href;
const probe = new URL('../film-probe.mjs', import.meta.url).href;

test('colours parse in every notation a person writes', async () => {
  const { parseColor } = await import(kit);
  assert.deepEqual(parseColor('#fff'), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parseColor('#0b0906'), { r: 11, g: 9, b: 6, a: 1 });
  assert.deepEqual(parseColor('#f0a64b80').a.toFixed(2), '0.50');
  assert.deepEqual(parseColor('rgb(10, 20, 30)'), { r: 10, g: 20, b: 30, a: 1 });
  assert.deepEqual(parseColor('rgba(10, 20, 30, 0.4)'), { r: 10, g: 20, b: 30, a: 0.4 });
  assert.throws(() => parseColor('amber'), /cannot read colour/);
});

test('contrast is the WCAG ratio, not a guess', async () => {
  const { contrast, luminance } = await import(kit);
  assert.equal(contrast('#000', '#fff').toFixed(2), '21.00');
  assert.equal(contrast('#fff', '#fff').toFixed(2), '1.00');
  assert.ok(Math.abs(luminance('#808080') - 0.2158) < 0.01);
  // Symmetric: the ratio does not care which one is the text.
  assert.equal(contrast('#123456', '#fedcba').toFixed(4), contrast('#fedcba', '#123456').toFixed(4));
});

test('inkOn returns the readable option, and says so when neither is', async () => {
  const { inkOn, contrast } = await import(kit);
  const onDark = inkOn('#0b0906');
  const onLight = inkOn('#f7f2e8');
  assert.ok(contrast(onDark, '#0b0906') > 4.5, 'a dark card gets light ink');
  assert.ok(contrast(onLight, '#f7f2e8') > 4.5, 'a light card gets dark ink');
  // Mid grey is the honest failure: both options are mediocre, pick the better one.
  const onMid = inkOn('#777777');
  const better = contrast('#f6f1e7', '#777777') >= contrast('#111014', '#777777') ? '#f6f1e7' : '#111014';
  assert.equal(onMid, better);
});

test('mix lands on both ends and in the middle', async () => {
  const { mix, parseColor } = await import(kit);
  assert.deepEqual(parseColor(mix('#000000', '#ffffff', 0)), { r: 0, g: 0, b: 0, a: 1 });
  assert.deepEqual(parseColor(mix('#000000', '#ffffff', 1)), { r: 255, g: 255, b: 255, a: 1 });
  const half = parseColor(mix('#000000', '#ffffff', 0.5));
  assert.ok(Math.abs(half.r - 128) <= 1);
});

test('the type scale and the grid are the ones the builders use', async () => {
  const { typeScale, grid } = await import(kit);
  const scale = typeScale({ base: 26, ratio: 1.333 });
  assert.ok(scale.display > scale.h1 && scale.h1 > scale.h2 && scale.h2 > scale.body);
  assert.ok(scale.small < scale.body);
  assert.equal(Math.round(scale.body), 26);
  const g = grid({ width: 1920, cols: 12, margin: 0.05, gutter: 0.012 });
  assert.equal(Math.round(g.margin), 96);
  const first = g.span(0, 12);
  assert.ok(Math.abs(first.width - (1920 - 192)) < 1e-6, 'twelve columns fill the live area');
  const sixth = g.span(0, 6);
  const next = g.span(6, 6);
  // `right` is the gap to the frame's right edge, the CSS way, so a block is
  // placed with left and right and never overflows on either side.
  assert.ok(Math.abs(next.left + next.width + next.right - 1920) < 1e-6, 'the columns add up to the frame');
  assert.ok(Math.abs(first.right - g.margin) < 1e-6, 'a full-width span ends at the margin, not at the frame edge');
  assert.ok(sixth.width > 0);
});

test('time helpers are pure functions of t', async () => {
  const { local, beats, seeded } = await import(kit);
  assert.equal(local(0, 1, 2), 0);
  assert.equal(local(2, 1, 2), 0.5);
  assert.equal(local(9, 1, 2), 1);
  assert.equal(local(-3, 0, 2), 0);
  const grid = beats(120);
  assert.equal(grid.beat, 0.5);
  assert.equal(grid.half, 0.25);
  assert.equal(grid.snap(0.2), 0.25, 'a cut near the half beat lands on it');
  assert.equal(grid.snap(0.1), 0, 'a cut at the top of the beat lands on the beat');
  assert.equal(grid.snap(0.9), 1, 'past the last half beat it lands on the next whole beat');
  const a = seeded(7);
  const b = seeded(7);
  const first = [a(), a(), a()];
  const second = [b(), b(), b()];
  assert.deepEqual(first, second, 'the same seed gives the same stream');
  assert.ok(first.every((v) => v >= 0 && v < 1));
});

test('token reading is safe outside a browser and maps to camelCase', async () => {
  const { token, tokens, fontReady } = await import(kit);
  // Imported by the plugin (node) as well as by pages: it must not throw there.
  assert.equal(token('--ink', '#fff'), '#fff');
  assert.deepEqual(tokens('bg', 'accent'), { bg: '', accent: '' });
  assert.equal(await fontReady(['Inter']), false);
});

test('the audit holds type to the published numbers', async () => {
  const { auditType, CRAFT } = await import(probe);
  assert.ok(CRAFT.titleSafe === 0.05 && CRAFT.contrastBody === 4.5 && CRAFT.largeTextPx === 24, 'the standards are the published ones');

  const clean = auditType([{
    text: '潮水退去的时候', x: 196, y: 322, width: 620, height: 110,
    fontSize: 92, lineHeight: 123, lines: 1, contrast: 15.2,
  }], { width: 1920, height: 1080 });
  assert.equal(clean.length, 0, JSON.stringify(clean));

  const edge = auditType([{
    text: '贴边的字', x: 8, y: 500, width: 300, height: 40,
    fontSize: 30, lineHeight: 36, lines: 1, contrast: 9,
  }], { width: 1920, height: 1080 });
  assert.equal(edge.find((rule) => rule.id === 'title-safe')?.severity, 'warn');

  const faint = auditType([{
    text: '看不见', x: 300, y: 300, width: 400, height: 60,
    fontSize: 40, lineHeight: 48, lines: 1, contrast: 1.4,
  }], { width: 1920, height: 1080 });
  assert.equal(faint.find((rule) => rule.id === 'contrast')?.severity, 'problem', 'a big headline at 1.4:1 is still unreadable');

  const long = auditType([{
    text: '这'.repeat(58), x: 200, y: 300, width: 1600, height: 60,
    fontSize: 30, lineHeight: 36, lines: 1, contrast: 9,
  }], { width: 1920, height: 1080 });
  assert.ok(long.some((rule) => rule.id === 'line-length'));

  const tight = auditType([{
    text: '两行贴在一起', x: 200, y: 300, width: 600, height: 60,
    fontSize: 40, lineHeight: 42, lines: 2, contrast: 9,
  }], { width: 1920, height: 1080 });
  assert.ok(tight.some((rule) => rule.id === 'leading'));
});

test('clip shares separate dead black from clipped white', async () => {
  const { clipShares } = await import(probe);
  const gray = new Uint8Array(100).fill(20);
  gray.fill(0, 0, 40);
  gray.fill(255, 40, 46);
  const shares = clipShares(gray);
  assert.equal(shares.black, 0.4);
  assert.equal(shares.white, 0.06);
});

test('clusterRuns keeps the line count a block really occupies', async () => {
  const { clusterRuns } = await import(probe);
  // One element, three wrapped lines: the range gave it three rects.
  const wrapped = clusterRuns([
    { text: '潮水退去的时候我们才看见岸的形状', x: 196, y: 322, width: 620, height: 330, fontSize: 92, lineHeight: 123, lines: 3, color: '#ece7db' },
  ]);
  assert.equal(wrapped.length, 1);
  assert.equal(wrapped[0].lines, 3, 'a wrapped block keeps its three baselines');

  // Three glyphs split into three spans: one line, one block.
  const split = clusterRuns([
    { text: '潮', x: 100, y: 200, width: 92, height: 110, fontSize: 92, lineHeight: 123, lines: 1, color: '#ece7db' },
    { text: '汐', x: 218, y: 200, width: 92, height: 110, fontSize: 92, lineHeight: 123, lines: 1, color: '#ece7db' },
  ]);
  assert.equal(split.length, 1, 'spans on one baseline are one run');
  assert.equal(split[0].width, 210, 'and their boxes are unioned');
});

test('a text run is merged from character spans before it is measured', async () => {
  const { clusterRuns, overhang, localContrast, frameDelta } = await import(probe);
  const runs = clusterRuns([
    { text: 'T', x: 100, y: 200, width: 60, height: 110, fontSize: 110, color: 'rgb(255, 255, 255)' },
    { text: 'h', x: 160, y: 200, width: 60, height: 110, fontSize: 110, color: 'rgb(255, 255, 255)' },
    { text: 'e', x: 220, y: 200, width: 60, height: 110, fontSize: 110, color: 'rgb(255, 255, 255)' },
    { text: 'sub', x: 100, y: 340, width: 200, height: 40, fontSize: 40, color: 'rgb(255, 255, 255)' },
  ]);
  assert.equal(runs.length, 2, 'three glyphs on one baseline are one line');
  const headline = runs.find((run) => run.fontSize === 110);
  assert.equal(headline.x, 100);
  assert.equal(headline.width, 180);
  assert.equal(overhang(headline, { width: 1920, height: 1080 }), 0);
  assert.equal(overhang({ x: 1900, y: 0, width: 100, height: 100 }, { width: 1920, height: 1080 }), 80);
  assert.equal(localContrast({ low: 0, high: 255 }), 21);
  assert.equal(localContrast({ low: 200, high: 210 }) < 1.2, true);
  const grayA = new Uint8Array([0, 0, 0, 0, 10, 10, 10, 10]);
  const grayB = new Uint8Array([0, 0, 0, 0, 12, 12, 12, 12]);
  assert.ok(frameDelta(grayA, grayB) > 0);
  assert.equal(frameDelta(grayA, grayA), 0);
});
