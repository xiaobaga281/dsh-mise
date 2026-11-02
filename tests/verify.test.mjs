/**
 * Frame acceptance: blank frames, tiny text, content outside the safe area.
 *
 *   node tests/verify.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const verify = new URL('../film-verify.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

function frame(width, height, painter) {
  const gray = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) gray[y * width + x] = painter(x, y);
  }
  return gray;
}

test('a blank frame is refused with the reason', async () => {
  const { analyzeGray } = await import(verify);
  const report = analyzeGray(frame(64, 36, () => 6), { width: 64, height: 36 });
  assert.equal(report.coverage, 0);
  assert.equal(report.bbox, null);
  assert.ok(report.problems.some((p) => /almost nothing/.test(p)));  assert.ok(report.problems.some((p) => /flat frame/.test(p)));
});

test('content inside the safe area passes with its margins', async () => {
  const { analyzeGray } = await import(verify);
  const gray = frame(200, 100, (x, y) => (x > 40 && x < 160 && y > 20 && y < 80 ? 220 : 8));
  const report = analyzeGray(gray, { width: 200, height: 100 }, { safe: 12 });
  assert.deepEqual(report.bbox, { left: 41, top: 21, right: 159, bottom: 79 });
  assert.deepEqual(report.margins, { left: 41, top: 21, right: 40, bottom: 20 });
  assert.equal(report.problems.length, 0);
  assert.ok(report.coverage > 30 && report.coverage < 50);
});

test('content crossing the safe area is reported per side', async () => {
  const { analyzeGray } = await import(verify);
  const gray = frame(200, 100, (x, y) => (x > 2 && x < 40 && y > 10 && y < 60 ? 220 : 8));
  const report = analyzeGray(gray, { width: 200, height: 100 }, { safe: 16 });
  const text = report.problems.join(' ');
  assert.match(text, /safe area on the left/);
});

test('a full-bleed photograph is only refused when bleed was not declared', async () => {
  const { analyzeGray } = await import(verify);
  // A photograph has no dominant background level: a photo-like gradient reads
  // as content everywhere, which is correct — it is meant to fill the frame.
  const photo = frame(160, 90, (x, y) => (x * 3 + y * 5) % 255);
  const strict = analyzeGray(photo, { width: 160, height: 90 }, { maxCoverage: 20 });
  assert.ok(strict.problems.some((p) => /nearly filled/.test(p)), 'without bleed, a filled frame is suspicious');

  const declared = analyzeGray(photo, { width: 160, height: 90 }, { maxCoverage: 20, bleed: true });
  assert.equal(declared.problems.length, 0, 'with bleed declared, filling the frame is fine');
});

test('a light background still measures its type as content', async () => {
  const { analyzeGray } = await import(verify);
  // Paper-coloured card with dark type: the old brightness rule saw "nothing".
  const card = frame(200, 100, (x, y) => (x > 30 && x < 170 && y > 30 && y < 70 ? 20 : 240));
  const report = analyzeGray(card, { width: 200, height: 100 }, { safe: 10 });
  assert.equal(report.background, 240);
  assert.ok(report.coverage > 20 && report.coverage < 45);
  assert.equal(report.problems.length, 0);
});

test('the summary collects one line per failing time', async () => {
  const { analyzeGray, summarizeFrames } = await import(verify);
  const blank = analyzeGray(frame(32, 18, () => 4), { width: 32, height: 18 });
  const good = analyzeGray(frame(32, 18, (x, y) => (x > 8 && x < 24 && y > 5 && y < 13 ? 200 : 10)), { width: 32, height: 18 }, { minCoverage: 2 });
  const summary = summarizeFrames([{ t: 0.5, report: blank }, { t: 1.5, report: good }]);
  assert.equal(summary.ok, false);
  assert.equal(summary.checked, 2);
  assert.ok(summary.problems[0].startsWith('0.5s:'));
});

test('a record is only proof while the film has not changed', async () => {
  const { verifyRecord, isFresh, acceptanceWarning } = await import(verify);
  const record = verifyRecord({ ok: true, checked: 2, frames: [{ t: 1, coverage: 3, contrast: 20, problems: [] }], problems: [] }, { filmMtimeMs: 5000, now: new Date('2026-10-26T00:00:00Z') });
  assert.equal(record.ok, true);
  assert.equal(record.filmMtimeMs, 5000);
  assert.equal(isFresh(record, 5000), true, 'same film, fresh');
  assert.equal(isFresh(record, 5001), false, 'edited film, stale');
  assert.equal(isFresh({ ...record, ok: false }, 5000), false, 'a failed run never counts');

  assert.equal(acceptanceWarning({ hasPlan: false, record, filmMtimeMs: 5000 }), null, 'unplanned films are not gated');
  assert.match(acceptanceWarning({ hasPlan: true, record: null, filmMtimeMs: 5000 }), /never accepted/);
  assert.match(acceptanceWarning({ hasPlan: true, record, filmMtimeMs: 9000 }), /changed since/);
  assert.match(acceptanceWarning({ hasPlan: true, record: { ...record, ok: false, problems: ['blank frame'] }, filmMtimeMs: 5000 }), /acceptance failed/);
  assert.equal(acceptanceWarning({ hasPlan: true, record, filmMtimeMs: 5000 }), null, 'a fresh pass says nothing');
});

test('the gate action opens only after a fresh acceptance record', async () => {
  const { mkdtempSync, mkdirSync, writeFileSync, statSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_verify');
  const dir = mkdtempSync(join(tmpdir(), 'openfilm-gate-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');
  mkdirSync(join(dir, '.film'), { recursive: true });
  writeFileSync(join(dir, '.film', 'plan.json'), JSON.stringify({ genre: 'keynote', beats: [] }));

  const closed = await tool.execute({ cwd: dir, action: 'gate' });
  assert.equal(closed.ok, false);
  assert.equal(closed.gate, true);
  assert.match(closed.blockers.join(' '), /never accepted/);

  const filmMtimeMs = statSync(join(dir, 'film.html')).mtimeMs;
  writeFileSync(join(dir, '.film', 'verify.json'), JSON.stringify({ version: 1, at: new Date().toISOString(), filmMtimeMs, ok: true, checked: 3, problems: [], frames: [] }));
  const open = await tool.execute({ cwd: dir, action: 'gate' });
  assert.equal(open.ok, true);
  assert.deepEqual(open.blockers, []);
  rmSync(dir, { recursive: true, force: true });
});

test('mise_verify is registered', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  assert.ok(tools.find((t) => t.name === 'mise_verify'), 'mise_verify must be registered');
});

test('composition is measured: where the weight sits and how much is air', async () => {
  const { analyzeGray } = await import(verify);
  const width = 120;
  const height = 60;
  // A block sitting on the left third, centred vertically.
  const report = analyzeGray(frame(width, height, (x, y) => (x >= 36 && x < 48 && y >= 24 && y < 36 ? 240 : 10)), { width, height }, { bleed: true });

  assert.ok(report.centroid, 'a frame with content has a centroid');
  assert.ok(Math.abs(report.centroid.x - 0.35) < 0.02, `centroid.x ${report.centroid.x} should sit on the left third`);
  assert.ok(Math.abs(report.centroid.y - 0.5) < 0.02, 'and be vertically centred');
  assert.ok(Math.abs(report.whitespace - (100 - report.coverage)) < 0.01, 'whitespace is the rest of the frame');

  const centred = analyzeGray(frame(width, height, (x, y) => (x >= 54 && x < 66 && y >= 24 && y < 36 ? 240 : 10)), { width, height }, { bleed: true });
  assert.ok(centred.centroid.x > 0.45 && centred.centroid.x < 0.55);
  assert.equal(centred.problems.length, 0, 'measuring does not judge by itself');
});

test('an opt-in composition rule fires only when it is asked for', async () => {
  const { analyzeGray } = await import(verify);
  const width = 120;
  const height = 60;
  const leftThird = frame(width, height, (x, y) => (x >= 36 && x < 48 && y >= 24 && y < 36 ? 240 : 10));

  const loose = analyzeGray(leftThird, { width, height }, { bleed: true });
  assert.equal(loose.problems.length, 0, 'no rule, no complaint');

  const wrong = analyzeGray(leftThird, { width, height }, { bleed: true, expectCentroidX: 0.5, expectCentroidY: 0.5, centroidTolerance: 0.1 });
  assert.ok(wrong.problems.some((p) => /subject sits at/.test(p)), 'a subject off its mark is reported');

  const right = analyzeGray(leftThird, { width, height }, { bleed: true, expectCentroidX: 0.35, expectCentroidY: 0.5, centroidTolerance: 0.1 });
  assert.equal(right.problems.length, 0, 'and a subject on its mark passes');
});

test('a picture-led film must look like one film across its cuts', async () => {
  const { continuityReport } = await import(verify);
  const steady = continuityReport([
    { t: 1, mean: 40, background: 12 },
    { t: 4, mean: 46, background: 14 },
    { t: 7, mean: 51, background: 16 },
  ]);
  assert.equal(steady.ok, true);
  assert.equal(steady.pairs.length, 2);

  const splice = continuityReport([
    { t: 1, mean: 40, background: 12 },
    { t: 4, mean: 92, background: 60 },
  ]);
  assert.equal(splice.ok, false);
  assert.ok(splice.problems.some((problem) => /brightness jumps/.test(problem)));
  assert.ok(splice.problems.some((problem) => /background level jumps/.test(problem)));

  const lenient = continuityReport([
    { t: 1, mean: 40, background: 12 },
    { t: 4, mean: 92, background: 60 },
  ], { meanTolerance: 80, backgroundTolerance: 80 });
  assert.equal(lenient.ok, true, 'the tolerance is the caller\'s to set');
});


test('adjacent shots that match are called out', async () => {
  const { varietyReport } = await import(verify);
  const varied = varietyReport([
    { t: 1, mean: 20, centroid: { x: 0.3, y: 0.5 } },
    { t: 4, mean: 40, centroid: { x: 0.65, y: 0.4 } },
    { t: 7, mean: 25, centroid: { x: 0.35, y: 0.8 } },
  ]);
  assert.equal(varied.ok, true);

  const repeated = varietyReport([
    { t: 1, mean: 20, centroid: { x: 0.5, y: 0.5 } },
    { t: 4, mean: 21, centroid: { x: 0.51, y: 0.5 } },
  ]);
  assert.equal(repeated.ok, false);
  assert.match(repeated.problems[0], /looks like the shot before it/);
});
