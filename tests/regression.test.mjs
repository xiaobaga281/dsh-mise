/**
 * Regression tests for the harness additions: what a check calls a defect, how
 * narration is placed, what a subtitle timestamp may be, which generation
 * combinations are refused, and that a queued job is a file, not a memory.
 *
 * No network, no paid service, no ffmpeg: every fixture is a temporary folder
 * and every request is checked before anything leaves the process.
 *
 *   node --test openfilm-plugin/tests
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
/** A sibling module as a file: URL — a bare Windows path is not importable. */
const plugin = (name) => new URL(`../${name}`, import.meta.url).href;

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-test-'));
  for (const [name, body] of Object.entries(files)) {
    const target = join(dir, name);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, body);
  }
  return dir;
}

const STAGE = '<meta name="viewport" content="width=1080, height=1920">';
const PAGE = '<script>window.film={duration:2,frame(t){}}</script>';

test('a missing file is a blocking problem, not a clean film', async () => {
  const { checkFilm } = await import(plugin('film-check.mjs'));
  const dir = project({ 'film.html': `${STAGE}<section><video src="assets/missing.mp4#t=0,2"></video></section>` });
  const result = checkFilm(dir);
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.rule === 'missing-file'));
  assert.equal(result.facts.durationKnown, false);
  rmSync(dir, { recursive: true, force: true });
});

test('an overlap inside a longer clip is found', async () => {
  const { checkFilm } = await import(plugin('film-check.mjs'));
  const dir = project({
    'film.html': `${STAGE}<section><iframe src="a.html#t=0,10"></iframe><iframe src="b.html#t=1,2" at="1"></iframe><iframe src="c.html#t=2.5,3" at="2.5"></iframe></section>`,
    'a.html': PAGE, 'b.html': PAGE, 'c.html': PAGE,
  });
  const result = checkFilm(dir);
  assert.equal(result.ok, false);
  assert.equal(result.problems.filter((p) => p.rule === 'overlap').length, 2);
  rmSync(dir, { recursive: true, force: true });
});

test('a page asset resolves beside the page, and a dynamic size is deferred', async () => {
  const { checkFilm } = await import(plugin('film-check.mjs'));
  const dir = project({
    'film.html': `${STAGE}<section><iframe src="shots/a.html#t=0,2"></iframe></section>`,
    'shots/a.html': `<img src="../assets/logo.png">${PAGE}`,
    'assets/logo.png': 'not really a png',
    'shots/dynamic.html': '<script>const w=1080;window.film={width:w,height:1920,duration:2,frame(t){}}</script>',
  });
  const besidePages = checkFilm(dir);
  assert.ok(!besidePages.problems.some((p) => p.rule === 'missing-file'), JSON.stringify(besidePages.problems));
  writeFileSync(join(dir, 'film.html'), `${STAGE}<section><iframe src="shots/dynamic.html#t=0,2"></iframe></section>`);
  const dynamic = checkFilm(dir);
  assert.equal(dynamic.ok, true);
  assert.ok(dynamic.deferred.some((d) => d.rule === 'dynamic-contract'));
  rmSync(dir, { recursive: true, force: true });
});

test('narration in one shot is spoken in order; bad ids and leads are refused', async () => {
  const { placeLines } = await import(plugin('film-timeline.mjs'));
  const shots = [{ id: 'a', at: 0, len: 8 }];
  const two = placeLines({ shots, lines: [
    { src: 'a.mp3', seconds: 3, shotId: 'a' },
    { src: 'b.mp3', seconds: 3, shotId: 'a' },
  ] });
  assert.equal(two.ok, true);
  assert.deepEqual(two.placements.map((p) => p.at), [0.35, 3.35]);

  const typo = placeLines({ shots, lines: [{ src: 'a.mp3', seconds: 3, shotId: 'typo' }] });
  assert.equal(typo.ok, false);
  assert.equal(typo.audioBlock, '');

  const negative = placeLines({ shots, lines: [{ src: 'a.mp3', seconds: 3, shotId: 'a', lead: -1 }] });
  assert.equal(negative.ok, false);

  const overrun = placeLines({ shots, lines: [{ src: 'a.mp3', seconds: 9, shotId: 'a' }] });
  assert.equal(overrun.ok, false);
  assert.ok(overrun.overruns[0].needsShotLength > 8);
});

test('subtitle times are legal at minute and hour boundaries', async () => {
  const { cueFile } = await import(plugin('voice-assets.mjs'));
  const stampOf = (seconds) => cueFile({ audioRelative: 'assets/a.mp3', text: 'x', seconds }).body.split('\n')[2];
  assert.equal(stampOf(59.9999), '00:00:00.000 --> 00:01:00.000');
  assert.equal(stampOf(3599.9999), '00:00:00.000 --> 01:00:00.000');
  const words = [
    { token: '第一句', start: 0, end: 0.5 }, { token: '。', start: 0.5, end: 0.55 },
    { token: '第二句', start: 0.55, end: 1 },
  ];
  const cues = cueFile({ audioRelative: 'assets/a.mp3', text: '第一句。第二句', seconds: 1.1, words }).body;
  assert.equal((cues.match(/-->/g) ?? []).length, 2);
  assert.ok(cues.includes('第一句。'));
});

test('a truncated mp3 has no trusted length', async () => {
  const { mp3Duration } = await import(plugin('voice-assets.mjs'));
  assert.equal(mp3Duration(Buffer.from([0xff, 0xfb, 0x90, 0x00])), 0);
  assert.equal(mp3Duration(Buffer.alloc(0)), 0);
});

test('impossible generation combinations are refused before any request', async () => {
  const { validateRequest } = await import(plugin('media-service.mjs'));
  const base = { kind: 'video', projectPath: '.', prompt: 'x' };
  assert.throws(() => validateRequest({ ...base, provider: 'agnes', firstFrame: 'a.png' }), /no first frame/);
  assert.throws(() => validateRequest({ ...base, provider: 'google', seconds: 5 }), /4, 6, 8/);
  assert.throws(() => validateRequest({ ...base, provider: 'fal', model: 'kling-3.0-pro', references: ['a.png'] }), /reference pictures/);
  assert.throws(() => validateRequest({ ...base, provider: 'google', lastFrame: 'b.png' }), /needs a first frame/);
  const veo = validateRequest({ ...base, provider: 'google' });
  assert.equal(veo.seconds, 4);
  assert.equal(veo.aspectRatio, '16:9');
});

test('a queued job is written to the project and listed after a restart', async () => {
  const queue = await import(plugin('asset-queue.mjs'));
  const dir = project({ 'film.html': `${STAGE}<section></section>` });
  // An invalid request is refused and leaves no job behind.
  assert.throws(() => queue.enqueueMediaJob({
    projectPath: dir,
    request: { provider: 'agnes', prompt: 'x', seconds: 5, firstFrame: 'a.png' },
    resolveKey: async () => 'k',
  }));
  assert.equal(queue.listJobs(dir).length, 0);

  // A job written by another process is read back from disk.
  const jobsDir = join(dir, '.film', 'media-jobs');
  mkdirSync(jobsDir, { recursive: true });
  writeFileSync(join(jobsDir, 'abc123.json'), JSON.stringify({
    id: 'abc123', kind: 'video', projectPath: dir, provider: 'google', model: 'veo-3.1-fast-generate-preview',
    prompt: 'a shot', state: 'done', phase: 'done', attempts: 1, result: { relative: 'assets/video/x.mp4' },
    createdAt: new Date().toISOString(), task: { assetId: 'asset-abc' },
  }));
  const jobs = queue.listJobs(dir);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].id, 'abc123');
  assert.equal(queue.getJob(dir, 'abc123')?.state, 'done');
  assert.ok(existsSync(join(jobsDir, 'abc123.json')));
  rmSync(dir, { recursive: true, force: true });
});
