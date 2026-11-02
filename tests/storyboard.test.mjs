/**
 * Editing the film's shots from the panel: retime and reorder, without a Studio.
 *
 *   node tests/storyboard.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const mod = new URL('../film-storyboard.mjs', import.meta.url).href;

const FILM = `<!doctype html><html><body>
<section><audio src="assets/score.wav" at="0" volume="0.85"></audio></section>
<section>
  <iframe src="01-title.html#t=0,3"></iframe>
  <iframe src="02-scene.html#t=0,2.5" at="3"></iframe>
  <iframe src="03-end.html#t=0,4.5" at="5.5"></iframe>
</section>
</body></html>`;

test('the shot track is read in order, with its own lengths', async () => {
  const { describeShots } = await import(mod);
  const shots = describeShots(FILM);
  assert.equal(shots.length, 3);
  assert.deepEqual(shots.map((shot) => shot.length), [3, 2.5, 4.5]);
  assert.deepEqual(shots.map((shot) => shot.at), [0, 3, 5.5]);
  assert.equal(shots[1].page, '02-scene.html');
});

test('changing one length pushes the following shots along', async () => {
  const { setShotLength, describeShots } = await import(mod);
  const result = setShotLength(FILM, 2, 4);
  assert.equal(result.ok, true);
  const shots = describeShots(result.html);
  assert.deepEqual(shots.map((shot) => shot.length), [3, 4, 4.5]);
  assert.deepEqual(shots.map((shot) => shot.at), [0, 3, 7], 'the shots after it move by the same amount');
  assert.ok(result.html.includes('02-scene.html#t=0,4'), 'the clip carries its new out point');

  const clamped = setShotLength(FILM, 1, 0.05);
  assert.equal(describeShots(clamped.html)[0].length, 0.4, 'a shot is never shorter than the floor');
  assert.equal(setShotLength(FILM, 9, 2).ok, false);
});

test('a shot can move in the track, and the timings follow it', async () => {
  const { moveShot, describeShots } = await import(mod);
  const result = moveShot(FILM, 3, -1);
  assert.equal(result.ok, true);
  const shots = describeShots(result.html);
  assert.deepEqual(shots.map((shot) => shot.page), ['01-title.html', '03-end.html', '02-scene.html']);
  assert.deepEqual(shots.map((shot) => shot.at), [0, 3, 7.5]);
  assert.deepEqual(shots.map((shot) => shot.index), [1, 2, 3]);
  assert.equal(moveShot(FILM, 1, -1).ok, false, 'the first shot cannot move earlier');
});

test('the audio track is never treated as a shot', async () => {
  const { readShots } = await import(mod);
  const shots = readShots(FILM);
  assert.ok(shots.every((shot) => shot.page.endsWith('.html')), 'only pages become shots');
  assert.ok(!shots.some((shot) => shot.page.includes('.wav')));
});

test('writing back keeps the film parseable', async () => {
  const { setShotLength } = await import(mod);
  const html = setShotLength(FILM, 1, 5).html;
  assert.ok(html.startsWith('<!doctype html>'), 'the document is intact');
  assert.equal((html.match(/<section/g) ?? []).length, 2, 'both tracks survive');
  assert.ok(html.includes('assets/score.wav'), 'the score is still there');
  assert.ok(html.trim().endsWith('</html>'));
});
