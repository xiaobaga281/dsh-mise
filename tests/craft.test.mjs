/**
 * Craft underneath the shots: the spring that moves them, the grid that holds
 * them, the type scale that ranks them.
 *
 *   node tests/craft.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const motion = new URL('../film-motionlib.mjs', import.meta.url).href;
const grid = new URL('../film-grid.mjs', import.meta.url).href;
const typeMod = new URL('../film-type.mjs', import.meta.url).href;

test('a spring overshoots a little, settles to one, and never runs away', async () => {
  const { spring } = await import(motion);
  const samples = Array.from({ length: 240 }, (_, i) => spring(i / 120, { zeta: 0.58, omega: 13 }));
  assert.ok(samples[0] < 0.01, 'starts at zero');
  const peak = Math.max(...samples);
  assert.ok(peak > 1.0, 'overshoots');
  assert.ok(peak < 1.16, 'but not enough to look broken');
  assert.ok(Math.abs(samples[samples.length - 1] - 1) < 0.01, 'settles on the target');
  assert.equal(spring(-0.5), 0, 'time before the cue is zero, not negative');
});

test('a critically damped spring does not overshoot', async () => {
  const { spring } = await import(motion);
  const samples = Array.from({ length: 240 }, (_, i) => spring(i / 120, { zeta: 0.99, omega: 11 }));
  assert.ok(Math.max(...samples) <= 1.0001);
});

test('the physics spring speaks stiffness/damping/mass and can be time-boxed', async () => {
  const { springPhysics } = await import(motion);
  // "stiff" overshoots more than "soft" at the same moment.
  const stiff = springPhysics({ frame: 6, fps: 30, config: { stiffness: 300, damping: 8, mass: 1 } });
  const soft = springPhysics({ frame: 6, fps: 30, config: { stiffness: 40, damping: 20, mass: 1 } });
  assert.ok(stiff > soft, 'stiffer springs travel further by the same frame');
  assert.ok(stiff > 1, 'and can overshoot');

  const clamped = springPhysics({ frame: 6, fps: 30, config: { stiffness: 300, damping: 8 }, overshootClamping: true });
  assert.ok(clamped <= 1.0001, 'overshootClamping never passes the target');

  // A fixed duration finishes the travel exactly on the last frame.
  const atEnd = springPhysics({ frame: 18, fps: 30, config: { stiffness: 100, damping: 10 }, durationInFrames: 18 });
  const beforeEnd = springPhysics({ frame: 9, fps: 30, config: { stiffness: 100, damping: 10 }, durationInFrames: 18 });
  assert.equal(atEnd, 1, 'settled exactly at the end');
  assert.ok(beforeEnd >= 0.5 && beforeEnd <= 1, 'a spring has done most of its travel by halfway');
});

test('interpolate clamps past its range and maps scale perceptually', async () => {
  const { interpolate } = await import(motion);
  assert.equal(interpolate(10, [0, 20], [0, 1]), 0.5);
  assert.equal(interpolate(40, [0, 20], [0, 1]), 2, 'an unclamped map keeps growing');
  assert.equal(interpolate(40, [0, 20], [0, 1], { extrapolate: 'clamp' }), 1);
  assert.equal(interpolate(-5, [0, 20], [0, 1], { extrapolate: 'clamp' }), 0);
  // Halfway through a zoom, the visible *area* should be half — that is sqrt(0.5).
  const perceptual = interpolate(30, [0, 60], [0, 1], { output: 'perceptual-scale' });
  assert.ok(Math.abs(perceptual - Math.sqrt(0.5)) < 1e-6);
  assert.throws(() => interpolate(1, [0, 1], [0]), /same length/);
});

test('stagger is seeded, increasing, and never all at once', async () => {
  const { stagger } = await import(motion);
  const values = Array.from({ length: 8 }, (_, i) => stagger(i, { base: 0.05, spread: 0.02, seed: 11 }));
  assert.ok(Math.abs(values[0] - 0) < 0.02, 'first unit starts almost immediately');
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] > values[i - 1], 'later units wait longer');
  assert.deepEqual(values, Array.from({ length: 8 }, (_, i) => stagger(i, { base: 0.05, spread: 0.02, seed: 11 })), 'same seed, same schedule');
});

test('the grid adds up and the safe area is inside the frame', async () => {
  const { gridFor, columnSpan, safeArea } = await import(grid);
  for (const aspect of ['16:9', '9:16', '1:1', '4:5']) {
    const layout = gridFor(aspect);
    const span = columnSpan(layout, { start: 1, span: layout.columns });
    assert.ok(Math.abs(span.left - layout.margin) < 0.01, `${aspect}: first column starts at the margin`);
    assert.ok(Math.abs(span.width - (layout.width - layout.margin * 2)) < 0.2, `${aspect}: full span fills the usable width`);
    const safe = safeArea(layout);
    assert.ok(safe.left > 0 && safe.right < layout.width && safe.top > 0 && safe.bottom < layout.height);
  }
});

test('the type scale is modular and ranks the roles', async () => {
  const { typeScale } = await import(grid);
  const scale = typeScale({ base: 28, ratio: 1.333 });
  assert.ok(scale.display > scale.h1 && scale.h1 > scale.h2 && scale.h2 > scale.body);
  assert.ok(scale.body > scale.small && scale.small > scale.caption);
  // h2 sits three steps above body (step(3) vs step(0)).
  const expected = Math.pow(1.333, 3);
  const actual = scale.h2 / scale.body;
  assert.ok(Math.abs(actual - expected) < 0.12, 'steps follow the ratio within rounding');
});

test('the title page carries the grid, the spring, and a legal size token', async () => {
  const { buildTypePage } = await import(typeMod);
  const html = buildTypePage({ lines: [{ text: '光落在信上', kicker: 'opening' }], duration: 3 });
  assert.ok(html.includes('--margin:'));
  assert.ok(html.includes('const spring ='));
  assert.ok(html.includes('--size:var(--display)'));
  assert.ok(!html.includes('var(--display)px'));
  assert.ok(!html.includes('Math.random'));
});
