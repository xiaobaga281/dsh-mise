/**
 * The measuring side of the look: can it describe a frame it has never seen?
 *
 * These tests use synthetic pictures with known answers — a half-and-half
 * frame, a gradient, a warm card and a cold one — because the point of the
 * module is that it does not know what a "film" looks like. If it can put the
 * right numbers on a test pattern, it can put honest numbers on a shot.
 *
 *   node tests/vision.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const vision = new URL('../film-vision.mjs', import.meta.url).href;

/** Build an rgb + grey pair from a per-pixel function. */
function picture(width, height, paint) {
  const rgb = new Uint8Array(width * height * 3);
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const [r, g, b] = paint(x, y);
      const at = (y * width + x) * 3;
      rgb[at] = r; rgb[at + 1] = g; rgb[at + 2] = b;
      gray[y * width + x] = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
    }
  }
  return { rgb, gray, width, height };
}

test('the palette is the colours that cover the frame, largest first', async () => {
  const { paletteOf } = await import(vision);
  const frame = picture(100, 100, (x) => (x < 50 ? [10, 20, 30] : [240, 235, 220]));
  const palette = paletteOf(frame.rgb, { step: 1 });
  assert.equal(palette.length, 2, 'two flat halves are two colours');
  assert.ok(Math.abs(palette[0].share - 0.5) < 0.02);
  assert.equal(palette[0].hex, '#0a141e');
  assert.equal(palette[1].hex, '#f0ebdc');
});

test('tone reads a gradient as a range, not an average', async () => {
  const { toneOf } = await import(vision);
  const frame = picture(256, 20, (x) => [x, x, x]);
  const tone = toneOf(frame.gray);
  assert.ok(tone.p5 >= 8 && tone.p5 <= 18, `p5 ${tone.p5}`);
  assert.ok(tone.p95 >= 238, `p95 ${tone.p95}`);
  assert.ok(tone.contrast > 200);
  assert.equal(tone.median >= 120 && tone.median <= 136, true, `median ${tone.median}`);
});

test('warmth and chroma separate a warm card from a cold one', async () => {
  const { colorOf } = await import(vision);
  const warm = picture(60, 60, () => [232, 196, 150]).rgb;
  const cold = picture(60, 60, () => [150, 190, 232]).rgb;
  const flat = picture(60, 60, () => [128, 128, 128]).rgb;
  assert.ok(colorOf(warm).warmth > 0.2, 'a warm card is warm');
  assert.ok(colorOf(cold).warmth < -0.2, 'a cold card is cold');
  assert.equal(colorOf(flat).chroma, 0, 'grey has no chroma');
});

test('composition says where the weight sits and finds a horizon', async () => {
  const { compositionOf } = await import(vision);
  const frame = picture(200, 100, (x, y) => {
    if (y < 50) return [10, 10, 10];
    if (y < 52) return [220, 220, 220];
    return [30, 30, 30];
  });
  const composition = compositionOf(frame.gray, frame.width, frame.height);
  assert.ok(composition.horizon.row > 0.45 && composition.horizon.row < 0.6, `horizon ${composition.horizon.row}`);
  assert.ok(composition.horizon.strength > 0.01, 'the bright band is an edge');
});

test('two frames of the same picture are zero apart; two worlds are not', async () => {
  const { describeFrame, compareFrames } = await import(vision);
  const night = picture(80, 45, () => [8, 16, 26]);
  const dawn = picture(80, 45, () => [226, 180, 132]);
  const nightVision = describeFrame(night);
  const dawnVision = describeFrame(dawn);
  const same = compareFrames(nightVision, describeFrame(night));
  assert.equal(same.palette, 0);
  assert.equal(same.medianLuma, 0);
  const apart = compareFrames(nightVision, dawnVision);
  assert.ok(apart.palette > 20, `palette distance ${apart.palette}`);
  assert.ok(apart.warmth > 0.4, `warmth distance ${apart.warmth}`);
});

test('a film is measured against itself, and the odd shot is named', async () => {
  const { describeFrame, profileFrames } = await import(vision);
  const cold = describeFrame(picture(80, 45, () => [10, 18, 28]));
  const cold2 = describeFrame(picture(80, 45, () => [14, 22, 32]));
  const warm = describeFrame(picture(80, 45, () => [230, 170, 110]));
  const profile = profileFrames([
    { t: 1, vision: cold },
    { t: 3, vision: cold2 },
    { t: 5, vision: warm },
  ]);
  assert.equal(profile.shots.length, 3);
  assert.ok(profile.outliers.includes(5), 'the warm shot is the one away from the film');
  assert.equal(profile.outliers.includes(1), false, 'the two that agree are not called out');
  assert.ok(profile.spread.palette > 20, 'the spread says the film changes world');
});
