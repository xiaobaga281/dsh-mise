/**
 * Delivery records and loudness judgement.
 *
 *   node tests/deliver.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const mod = new URL('../film-deliver.mjs', import.meta.url).href;

const goodMedia = { width: 1920, height: 1080, fps: 30, duration: 12.5, video: 'h264', audio: 'aac', channels: 2 };
const goodLoudness = { integrated: -16.2, truePeak: -2.1, lra: 7 };

test('a delivery record carries measured facts, not hopes', async () => {
  const { deliveryManifest } = await import(mod);
  const record = deliveryManifest({
    filmPath: 'film.html',
    outputPath: 'film-graded.mp4',
    sourcePath: 'film.mp4',
    ladder: ['render', 'grade'],
    media: goodMedia,
    loudness: goodLoudness,
    gate: { ok: true },
    now: new Date('2026-10-26T00:00:00Z'),
  });
  assert.equal(record.ok, true);
  assert.equal(record.media.width, 1920);
  assert.equal(record.media.duration, 12.5);
  assert.deepEqual(record.ladder, ['render', 'grade']);
  assert.equal(record.gate.ok, true);
  assert.equal(record.at, '2026-10-26T00:00:00.000Z');
});

test('an unmeasured output is refused, not assumed', async () => {
  const { deliveryManifest } = await import(mod);
  const record = deliveryManifest({ filmPath: 'film.html', outputPath: 'x.mp4', media: {}, gate: { ok: true } });
  assert.equal(record.ok, false);
  assert.ok(record.problems.some((p) => /size was not measured/.test(p)));
  assert.ok(record.problems.some((p) => /duration was not measured/.test(p)));
  assert.ok(record.problems.some((p) => /audio stream was not measured/.test(p)));
});

test('a closed gate is recorded as a failed delivery', async () => {
  const { deliveryManifest } = await import(mod);
  const record = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: goodMedia, gate: { ok: false, blockers: ['8 pending'] } });
  assert.equal(record.ok, false);
  assert.match(record.problems.join(' '), /gate was closed/);
  assert.deepEqual(record.gate.blockers, ['8 pending']);
});

test('a forced delivery records the override instead of a failure', async () => {
  const { deliveryManifest } = await import(mod);
  const record = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: goodMedia, gate: { ok: false, blockers: ['8 pending'], overridden: true } });
  assert.equal(record.ok, true, 'the override is a decision, not a hidden failure');
  assert.deepEqual(record.problems, [], 'a forced delivery is clean, and the record still says the gate was closed');
  assert.equal(record.gate.ok, false);
  assert.deepEqual(record.gate.blockers, ['8 pending']);
});

test('the receipt names the next tool to run', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const record = deliveryManifest({
    filmPath: 'f.html',
    outputPath: 'x.mp4',
    media: goodMedia,
    gate: { ok: false, blockers: ['shot review incomplete: 2 pending (1/3 approved)', 'frames were never accepted: run mise_verify on the current cut'] },
  });
  const markdown = deliveryReceipt({ record });
  assert.match(markdown, /## 下一步/);
  assert.match(markdown, /mise_review action="status"/);
  assert.match(markdown, /mise_verify/);
});

test('a delivery is compared with the previous one', async () => {
  const { compareDelivery } = await import(mod);
  const before = { gate: { ok: false }, problems: ['x', 'y'], media: { fps: 30 }, loudness: { integrated: -19 } };
  const after = { gate: { ok: true }, problems: [], media: { fps: 60 }, loudness: { integrated: -16.1 } };
  const better = compareDelivery(before, after);
  assert.equal(better.verdict, '进步');
  assert.ok(better.changes.some((c) => /门禁：由未通过变为通过/.test(c)));
  assert.ok(better.changes.some((c) => /帧率：30 → 60/.test(c)));

  const worse = compareDelivery(after, before);
  assert.equal(worse.verdict, '退步');

  assert.equal(compareDelivery(null, after).verdict, '首次交付');
  const same = compareDelivery(after, after);
  assert.equal(same.verdict, '持平');
});

test('the receipt states the facts and the verdict', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const record = deliveryManifest({
    filmPath: 'film.html',
    sourcePath: 'film.mp4',
    outputPath: 'film-delivered.mp4',
    ladder: ['gate', 'grade', 'interpolate 60fps'],
    media: goodMedia,
    loudness: goodLoudness,
    gate: { ok: true },
    now: new Date('2026-10-26T00:00:00Z'),
  });
  const markdown = deliveryReceipt({
    record,
    plan: { genre: 'keynote', label: '发布会/产品主张' },
    review: { total: 6, approved: 6, pending: 0, changed: 0 },
    acceptance: { ok: true, fresh: true, checked: 4 },
  });
  assert.match(markdown, /交付回执 · film-delivered\.mp4/);
  assert.match(markdown, /1920×1080，30 fps，12\.5s/);
  assert.match(markdown, /-16\.2 LUFS/);
  assert.match(markdown, /逐镜审看：6\/6 已批准/);
  assert.match(markdown, /抽检 4 帧/);
  assert.match(markdown, /结论：机器通过，待人工签收/, 'a green machine alone is not a delivery');
});

test('a human sign-off decides the last word, and expires with the cut', async () => {
  const { deliveryManifest, deliveryReceipt, signoffVerdict } = await import(mod);
  const record = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: goodMedia, loudness: goodLoudness, gate: { ok: true } });

  assert.equal(signoffVerdict({ signoff: null }).status, 'missing');
  assert.equal(signoffVerdict({ signoff: { verdict: 'approved', filmMtimeMs: 100 }, filmMtimeMs: 100 }).status, 'approved');
  assert.equal(signoffVerdict({ signoff: { verdict: 'approved', filmMtimeMs: 100 }, filmMtimeMs: 200 }).status, 'stale');
  assert.equal(signoffVerdict({ signoff: { verdict: 'rejected', note: '太暗' } }).status, 'rejected');

  const approved = deliveryReceipt({ record, signoff: signoffVerdict({ signoff: { by: '导演', verdict: 'approved', filmMtimeMs: 100 }, filmMtimeMs: 100 }) });
  assert.match(approved, /已批准：导演/);
  assert.match(approved, /结论：可交付（已签收：导演）/);

  const rejected = deliveryReceipt({ record, signoff: signoffVerdict({ signoff: { by: '导演', verdict: 'rejected', note: '太暗' } }) });
  assert.match(rejected, /已否决：导演 — 太暗/);
  assert.match(rejected, /结论：不可交付（人工否决）/);

  const stale = deliveryReceipt({ record, signoff: signoffVerdict({ signoff: { by: '导演', verdict: 'approved', filmMtimeMs: 100 }, filmMtimeMs: 200 }) });
  assert.match(stale, /结论：不可交付（签收已过期，影片已修改）/);
});

test('a receipt with problems says it is not deliverable and lists them', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const record = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: { ...goodMedia, audio: null }, gate: { ok: true } });
  const markdown = deliveryReceipt({ record });
  assert.match(markdown, /无音轨/);
  assert.match(markdown, /结论：不可交付/);
  assert.match(markdown, /## 待办[\s\S]*- the delivered file has no audio track|## 待办[\s\S]*- /);
});

test('a closed gate cannot be reported as deliverable', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const closed = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: goodMedia, gate: { ok: false, blockers: ['3 pending'] } });
  const markdown = deliveryReceipt({ record: closed });
  assert.match(markdown, /导出闸门：未通过/);
  assert.match(markdown, /门禁：3 pending/, 'the blocker is work left to do');
  assert.match(markdown, /结论：不可交付/);

  const forced = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: goodMedia, gate: { ok: false, blockers: ['3 pending'], overridden: true } });
  const forcedMarkdown = deliveryReceipt({ record: forced });
  assert.match(forcedMarkdown, /已强制交付（门禁未通过，需人工确认）/);
  assert.ok(!/结论：可交付/.test(forcedMarkdown), 'an override is never a clean pass');
});

test('loudness is judged against streaming targets, with reasons', async () => {
  const { loudnessVerdict } = await import(mod);
  assert.equal(loudnessVerdict(goodLoudness).ok, true);
  assert.match(loudnessVerdict({ integrated: -28, truePeak: -3 }).problems.join(' '), /quiet/);
  assert.match(loudnessVerdict({ integrated: -7, truePeak: -1.2 }).problems.join(' '), /loud/);
  assert.match(loudnessVerdict({ integrated: -16, truePeak: -0.4 }).problems.join(' '), /clip/);
  assert.equal(loudnessVerdict({}).ok, false);
});

test('loudnorm output is parsed from ffmpeg stderr', async () => {
  const { parseLoudnorm } = await import(mod);
  const stderr = '{\n  "input_i" : "-16.23",\n  "input_tp" : "-2.10",\n  "input_lra" : "6.90"\n}';
  assert.deepEqual(parseLoudnorm(stderr), { integrated: -16.23, truePeak: -2.1, lra: 6.9 });
  assert.deepEqual(parseLoudnorm('no numbers here'), { integrated: null, truePeak: null, lra: null });
});


test('the receipt says how the picture was finished', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const record = deliveryManifest({
    filmPath: 'f.html',
    outputPath: 'x.mp4',
    media: { ...goodMedia },
    loudness: { ...goodLoudness },
    gate: { ok: true },
    grade: { preset: 'filmic', grain: 0.12, bloom: 0.16, vignette: 0.16, letterbox: 0.11 },
  });
  assert.equal(record.grade.preset, 'filmic');
  assert.equal(record.grade.vignette, 0.16);
  const markdown = deliveryReceipt({ record });
  assert.match(markdown, /调色：filmic/);
  assert.match(markdown, /颗粒 0\.12/);
  assert.match(markdown, /暗角 0\.16/);
  assert.match(markdown, /黑边 11\.0%/);

  // A film delivered without a grade says nothing about one, rather than "0".
  const bare = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: { ...goodMedia }, loudness: { ...goodLoudness }, gate: { ok: true } });
  assert.equal(bare.grade, undefined);
  assert.doesNotMatch(deliveryReceipt({ record: bare }), /调色：/);
});


test('the receipt says what the score was', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const record = deliveryManifest({
    filmPath: 'f.html', outputPath: 'x.mp4',
    media: { ...goodMedia }, loudness: { ...goodLoudness }, gate: { ok: true },
    score: { mood: 'tense', bpm: 84, groove: 'syncopated', grid: 0.357, voices: 7, synth: 'Karplus-Strong' },
  });
  assert.equal(record.score.groove, 'syncopated');
  const markdown = deliveryReceipt({ record });
  assert.match(markdown, /配乐：tense · 84bpm · syncopated · 网格 0\.357s · 7 个声部/);
  assert.match(markdown, /Karplus-Strong/);

  const bare = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: { ...goodMedia }, loudness: { ...goodLoudness }, gate: { ok: true } });
  assert.equal(bare.score, undefined);
  assert.doesNotMatch(deliveryReceipt({ record: bare }), /配乐：/);
});


test('the receipt describes what was designed', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const record = deliveryManifest({ filmPath: 'f.html', outputPath: 'x.mp4', media: { ...goodMedia }, loudness: { ...goodLoudness }, gate: { ok: true } });
  const markdown = deliveryReceipt({
    record,
    plan: { genre: 'title-sequence', label: '片头/标题序列', shots: 5, pacing: 'decelerate', transition: 'presentation', moves: ['push-in', 'still', 'drift-up', 'still', 'still'], claims: 1 },
  });
  assert.match(markdown, /- 设计：5 个镜头 · 渐慢 · 呈现式转场 · 运镜 push-in\/drift-up · 1 组主张-证据/);
});


test('a score that outlasts the picture is a delivery problem', async () => {
  const { mediaMismatch, deliveryManifest } = await import(mod);
  const late = mediaMismatch({ videoSeconds: 22.65, audioSeconds: 26.4 });
  assert.equal(late.ok, false);
  assert.match(late.problems[0], /runs 3\.75s past the picture/);
  assert.equal(mediaMismatch({ videoSeconds: 23.7, audioSeconds: 23.7 }).ok, true);

  const record = deliveryManifest({
    filmPath: 'f.html', outputPath: 'x.mp4',
    media: { ...goodMedia, duration: 22.65, audioDuration: 26.4 },
    loudness: { ...goodLoudness }, gate: { ok: true },
  });
  assert.ok(record.problems.some((p) => /past the picture/.test(p)));
  assert.equal(record.ok, false);
});

test('a re-delivery that changed nothing says so', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const base = {
    filmPath: 'f.html', outputPath: 'x.mp4',
    media: { ...goodMedia }, loudness: { ...goodLoudness }, gate: { ok: true },
  };

  // Cosmetic: no shot moved enough to matter.
  const quiet = deliveryManifest({ ...base, changes: [
    { at: 1.84, changedPercent: 0.1, brightnessBefore: 13.2, brightnessAfter: 13.5, centroidShift: 0.002 },
    { at: 10.7, changedPercent: 0, brightnessBefore: 15.3, brightnessAfter: 15.6, centroidShift: 0.004 },
  ] });
  assert.match(deliveryReceipt({ record: quiet }), /- 本版改动：逐镜对比无可见变化/);

  // A real edit: the receipt names the shots, heaviest first.
  const edited = deliveryManifest({ ...base, changes: [
    { at: 3.2, changedPercent: 12.5, brightnessBefore: 20, brightnessAfter: 28, centroidShift: 0.08 },
    { at: 9.9, changedPercent: 41.0, brightnessBefore: 30, brightnessAfter: 12, centroidShift: -0.11 },
  ] });
  const markdown = deliveryReceipt({ record: edited });
  assert.match(markdown, /- 本版改了哪些镜：9\.9s（41\.0% 画面变化） · 3\.2s（12\.5% 画面变化）/);
});

test('a change names the shot it happened in', async () => {
  const { deliveryManifest, deliveryReceipt } = await import(mod);
  const record = deliveryManifest({
    filmPath: 'f.html', outputPath: 'x.mp4',
    media: { ...goodMedia }, loudness: { ...goodLoudness }, gate: { ok: true },
    changes: [
      { shot: '第3镜 · 数字', at: 9.9, changedPercent: 41.0, brightnessBefore: 30, brightnessAfter: 12, centroidShift: -0.11 },
      { shot: '第5镜 · 主张', at: 14.3, changedPercent: 0, brightnessBefore: 8, brightnessAfter: 11, centroidShift: 0 },
    ],
  });
  const markdown = deliveryReceipt({ record });
  assert.match(markdown, /第3镜 · 数字 9\.9s（41\.0% 画面变化）/);
  assert.match(markdown, /第5镜 · 主张 14\.3s（亮度 8 → 11）/);
});
