/**
 * Motion, measured rather than described.
 *
 * The tests use synthetic frames whose answer is known: a world that slides, a
 * subject that moves inside a static frame, a dissolve, and a speed ramp. If the
 * measurements are right here they are right on a shot, because nothing in the
 * module knows what the shot is about.
 *
 *   node tests/flow.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const flow = new URL('../film-motion.mjs', import.meta.url).href;

/** A grey plane with a bright square somewhere in it. */
function plane(width, height, { box = null, background = 20, value = 220 } = {}) {
  const out = new Uint8Array(width * height).fill(background);
  if (box) {
    for (let y = box.y; y < box.y + box.h; y += 1) {
      for (let x = box.x; x < box.x + box.w; x += 1) out[y * width + x] = value;
    }
  }
  return out;
}

test('a pan is found as a shift; a subject moving inside a still frame is not', async () => {
  const { globalShift } = await import(flow);
  const width = 480;
  const height = 270;

  // The world slides 8px right: every row moves together.
  const still = plane(width, height, { box: { x: 100, y: 80, w: 60, h: 60 } });
  const panned = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) panned[y * width + x] = still[y * width + Math.max(0, x - 8)];
  }
  const shift = globalShift(still, panned, width, height);
  assert.ok(shift.x >= 4 && shift.x <= 12, `shift x ${shift.x}`);
  assert.ok(shift.confidence > 0.25, `confidence ${shift.confidence}`);

  // A square moves; the frame does not.
  const moved = plane(width, height, { box: { x: 180, y: 80, w: 60, h: 60 } });
  const inside = globalShift(still, moved, width, height);
  assert.ok(inside.confidence <= 0.25, `a subject move is not a camera move (${inside.confidence})`);
});

test('coverage separates a local change from a frame-wide one', async () => {
  const { changeMap } = await import(flow);
  const width = 320;
  const height = 180;
  const base = plane(width, height, { box: { x: 40, y: 40, w: 30, h: 30 } });
  const local = plane(width, height, { box: { x: 60, y: 40, w: 30, h: 30 } });
  const global = plane(width, height, { box: null, background: 200 });

  const small = changeMap(base, local, width, height);
  const wide = changeMap(base, global, width, height);
  assert.ok(small.coverage < 0.5, `local coverage ${small.coverage}`);
  assert.ok(wide.coverage > 0.9, `global coverage ${wide.coverage}`);
  assert.ok(small.centroid.x > 0.2 && small.centroid.x < 0.55, `local centroid ${JSON.stringify(small.centroid)}`);
});

test('the speed curve says whether the motion eases or runs flat', async () => {
  const { speedCurve } = await import(flow);
  const eased = speedCurve([
    { t: 1, dt: 1, change: 9.7 },
    { t: 2, dt: 1, change: 9.9 },
    // Twice the time, twice the change: the speed is the same 9.8 a second.
    { t: 4, dt: 2, change: 19.8 },
  ]);
  assert.equal(eased.speeds.length, 3, 'one speed per interval, not per pair of pairs');
  assert.equal(eased.trend, 'even', 'a push that holds its speed is even, not decelerating');

  const slowing = speedCurve([
    { t: 1, dt: 1, change: 12 },
    { t: 2, dt: 1, change: 6 },
    { t: 3, dt: 1, change: 3 },
  ]);
  assert.equal(slowing.trend, 'decelerating');
  assert.ok(slowing.smoothness > 0.5);
});

test('motionOf names what the change looks like', async () => {
  const { motionOf } = await import(flow);
  const width = 240;
  const height = 135;
  const a = plane(width, height, { box: { x: 50, y: 40, w: 30, h: 30 } });
  const b = plane(width, height, { box: { x: 70, y: 40, w: 30, h: 30 } });
  const local = motionOf({ width, height, frames: [{ t: 0, gray: a }, { t: 1, gray: b }, { t: 2, gray: plane(width, height, { box: { x: 90, y: 40, w: 30, h: 30 } }) }] });
  assert.equal(local.kind, 'subject');
  assert.equal(local.pairs.length, 2);

  const c = plane(width, height, { box: null, background: 30 });
  const d = plane(width, height, { box: null, background: 210 });
  const fade = motionOf({ width, height, frames: [{ t: 0, gray: c }, { t: 1, gray: d }, { t: 2, gray: plane(width, height, { box: null, background: 120 }) }] });
  assert.equal(fade.kind, 'global', 'a whole-frame change with no shift is global');
});
