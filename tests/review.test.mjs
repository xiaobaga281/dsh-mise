/**
 * The review gate: a film is not rendered until every shot's keyframe has been
 * looked at and approved. These tests pin the record and the tool's decisions,
 * offline — drawing a keyframe needs a browser and is the one part not covered.
 *
 *   node tests/review.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const reviewMod = new URL('../film-review.mjs', import.meta.url).href;
const pluginMod = new URL('../index.js', import.meta.url).href;

const FACTS = {
  picture: [
    { id: 'captions', src: 'captions.html', track: 0, at: 0, length: 10, kind: 'page' },
    { id: 'title', src: 'titles.html', track: 1, at: 0, length: 10, kind: 'page' },
    { id: 's1', src: 's1.html', track: 2, at: 0, length: 4, kind: 'page' },
    { id: 's2', src: 's2.html', track: 2, at: 4, length: 6, kind: 'page' },
  ],
};

function project() {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-review-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section><iframe src="s1.html#t=0,4"></iframe></section>');
  writeFileSync(join(dir, 's1.html'), '<script>window.film={duration:4,frame(t){}}</script>');
  return dir;
}

test('only the footage track is reviewed, with a sensible keyframe time', async () => {
  const { shotsFromFacts } = await import(reviewMod);
  const shots = shotsFromFacts(FACTS);
  assert.deepEqual(shots.map((s) => s.id), ['s1', 's2']);
  for (const shot of shots) {
    assert.ok(shot.keyframeAt > shot.at, 'keyframe must be inside the shot');
    assert.ok(shot.keyframeAt < shot.at + shot.length, 'keyframe must be before the end');
  }
});

test('a new shot starts pending, and approval is recorded per shot', async () => {
  const { reviewStatus, setShotReview } = await import(reviewMod);
  const dir = project();
  let status = reviewStatus(dir, FACTS);
  assert.equal(status.counts.total, 2);
  assert.equal(status.counts.pending, 2);
  assert.equal(status.readyToRender, false);

  setShotReview(dir, 's1', { state: 'approved' });
  status = reviewStatus(dir, FACTS);
  assert.equal(status.counts.approved, 1);
  assert.equal(status.readyToRender, false);

  setShotReview(dir, 's2', { state: 'approved' });
  assert.equal(reviewStatus(dir, FACTS).readyToRender, true);

  // A shot the plan no longer has drops off; a new one appears pending.
  const edited = { picture: [...FACTS.picture, { id: 's3', src: 's3.html', track: 2, at: 10, length: 3, kind: 'page' }] };
  const after = reviewStatus(dir, edited);
  assert.deepEqual(after.shots.map((s) => s.id), ['s1', 's2', 's3']);
  assert.equal(after.counts.pending, 1);
  assert.equal(after.readyToRender, false);
  rmSync(dir, { recursive: true, force: true });
});

test('marking a shot changed needs a note, and keeps the reason', async () => {
  const { reviewStatus, setShotReview } = await import(reviewMod);
  const dir = project();
  assert.throws(() => setShotReview(dir, 's1', { state: 'changed' }), /needs a note/);
  setShotReview(dir, 's1', { state: 'changed', note: 'the fox is facing away; turn it toward the letter' });
  const status = reviewStatus(dir, FACTS);
  assert.equal(status.shots[0].state, 'changed');
  assert.match(status.shots[0].note, /facing away/);
  rmSync(dir, { recursive: true, force: true });
});

test('the tool refuses to approve without a shot and reports readiness', async () => {
  const mod = await import(pluginMod);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_review');
  assert.ok(tool, 'mise_review must be registered');

  const dir = project();
  const status = await tool.execute({ action: 'status', cwd: dir });
  assert.equal(status.ok, true);
  assert.equal(status.counts.total, 1);
  assert.equal(status.readyToRender, false);
  assert.equal(status.shots[0].state, 'pending');

  await assert.rejects(() => tool.execute({ action: 'approve', cwd: dir }), /shot.*required/i);

  const approved = await tool.execute({ action: 'approve', cwd: dir, shot: status.shots[0].id });
  assert.equal(approved.counts.approved, 1);
  assert.equal(approved.readyToRender, true);

  const rejected = await tool.execute({ action: 'reject', cwd: dir, shot: status.shots[0].id, note: 'too dark' });
  assert.equal(rejected.shots[0].state, 'changed');
  assert.equal(rejected.readyToRender, false);
  rmSync(dir, { recursive: true, force: true });
});
