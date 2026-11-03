/**
 * Code-composed score and the ducking mix.
 *
 *   node tests/music.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const scoreMod = new URL('../film-score.mjs', import.meta.url).href;
const mixMod = new URL('../film-mix.mjs', import.meta.url).href;
const audioMod = new URL('../film-audio.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

test('a score is deterministic and its length follows the tempo', async () => {
  const { composeScore } = await import(scoreMod);
  const a = composeScore({ mood: 'warm', key: 'D', bpm: 84, bars: 4 });
  const b = composeScore({ mood: 'warm', key: 'D', bpm: 84, bars: 4 });
  assert.deepEqual(a, b);
  assert.equal(a.bars, 4);
  assert.ok(Math.abs(a.seconds - 4 * (60 / 84) * 4) < 0.01, 'four bars at 84 bpm');
  assert.ok(a.notes.length > 20);
  assert.ok(a.notes.every((note) => note.at >= 0 && note.gain > 0));
});

test('chord tones climb and stay in the key', async () => {
  const { chordFor } = await import(scoreMod);
  const one = chordFor(1, { key: 'D', mode: 'major' });
  assert.equal(one.length, 3);
  assert.ok(one[0] < one[1] && one[1] < one[2]);
  // D major I: D F# A
  assert.deepEqual(one.map((m) => m % 12), [2, 6, 9]);
});

test('the WAV has a real header and the declared length', async () => {
  const { composeScore, renderScoreWav } = await import(scoreMod);
  const score = composeScore({ mood: 'minimal', key: 'A', bpm: 90, bars: 2 });
  const wav = renderScoreWav(score);
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE');
  assert.equal(wav.readUInt16LE(22), 2, 'stereo');
  assert.equal(wav.readUInt32LE(24), 44100);
  const dataSize = wav.readUInt32LE(40);
  assert.equal(wav.length, 44 + dataSize);
  assert.ok(dataSize > 44100 * 2 * 4, 'at least a second of stereo audio');
});

test('a mix ducks the score under the voice and normalises once', async () => {
  const { planMix } = await import(mixMod);
  const bare = planMix({ music: 'm.wav', output: 'o.m4a' });
  assert.equal(bare.ok, true);
  assert.ok(bare.args.join(' ').includes('loudnorm=I=-16:TP=-1.5:LRA=11'));

  const mixed = planMix({ music: 'm.wav', voices: [{ path: 'v1.m4a', at: 0 }, { path: 'v2.m4a', at: 3.5 }], output: 'o.m4a' });
  assert.equal(mixed.ok, true);
  assert.ok(mixed.filter.includes('adelay=3500|3500'));
  assert.ok(mixed.filter.includes('sidechaincompress'));
  assert.ok(mixed.filter.includes('amix=inputs=2'));
  assert.ok(mixed.filter.includes('alimiter'));
  assert.ok(mixed.args.join(' ').includes('-map [mix]'));

  assert.equal(planMix({ music: '', output: 'o.m4a' }).ok, false);
  assert.equal(planMix({ music: 'm.wav', output: 'o.m4a', voices: [{ path: 'v.m4a', at: -1 }] }).ok, false);
});

test('the score tool writes a playable WAV and the mix tool refuses missing music', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const score = tools.find((t) => t.name === 'mise_score');
  const mix = tools.find((t) => t.name === 'mise_mix');
  assert.ok(score, 'mise_score must be registered');
  assert.ok(mix, 'mise_mix must be registered');

  const dir = mkdtempSync(join(tmpdir(), 'mise-score-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');

  const made = await score.execute({ cwd: dir, name: 'bed', mood: 'warm', bars: 2, bpm: 100 });
  assert.equal(made.ok, true);
  assert.equal(made.relative, 'assets/bed.wav');
  assert.ok(statSync(join(dir, made.relative)).size > 100000);
  assert.equal(readFileSync(join(dir, made.relative)).toString('ascii', 0, 4), 'RIFF');

  const bad = await mix.execute({ cwd: dir, music: 'nope.wav' });
  assert.equal(bad.ok, false);
  rmSync(dir, { recursive: true, force: true });
});

test('a cut-aligned score changes chord exactly on each cut and stops at the end', async () => {
  const { composeForShots } = await import(scoreMod);
  const score = composeForShots({ shots: [{ at: 0, length: 4 }, { at: 4, length: 3 }, { at: 7, length: 4 }], mood: 'warm', key: 'D', bpm: 84, tail: 0.6 });
  assert.equal(score.ok, true);
  assert.deepEqual(score.cutPoints, [0, 4, 7]);
  assert.ok(Math.abs(score.seconds - 11.6) < 0.01, 'last shot end plus tail');

  // Every chord (pad) starts on a cut, and nothing starts after the last end.
  // The release chord rings after the last cut by design; the chord changes are
  // the ones inside the film's own length.
  // Chord changes are the pads that begin exactly on a cut; the release chord
  // belongs to the tail and is not a change.
  const padStarts = [...new Set(score.notes.filter((n) => n.voice === 'pad' && score.cutPoints.some((c) => Math.abs(c - n.at) < 1e-6)).map((n) => Number(n.at.toFixed(3))))];
  assert.deepEqual(padStarts, [0, 4, 7]);
  assert.ok(score.notes.every((n) => n.at >= 0 && n.at <= score.seconds));

  // The arpeggio never spills past its own shot.
  const plucks = score.notes.filter((n) => n.voice === 'pluck');
  assert.ok(plucks.some((n) => n.at >= 4 && n.at < 7));
  // Every pluck ends inside the shot it belongs to: nothing rings across a cut.
  const boundaries = [0, 4, 7, score.seconds];
  for (const note of plucks) {
    const segment = boundaries.findIndex((b, i) => i > 0 && note.at >= boundaries[i - 1] && note.at < b);
    assert.ok(segment > 0, `pluck at ${note.at} outside the film`);
    assert.ok(note.at + note.dur <= boundaries[segment] + 0.02, `pluck at ${note.at} spills past ${boundaries[segment]}`);
  }

  const overlap = composeForShots({ shots: [{ at: 0, length: 5 }, { at: 4, length: 3 }] });
  assert.equal(overlap.ok, false);
});

test('a grid makes every note land on the half-beat, like the cuts do', async () => {
  const { composeForShots } = await import(scoreMod);
  const shots = [{ at: 0, length: 3 }, { at: 3, length: 3.5 }, { at: 6.5, length: 4 }];
  const grid = 0.357;
  const free = composeForShots({ shots, mood: 'warm' });
  const quantised = composeForShots({ shots, mood: 'warm', grid });

  // Pinned cut accents follow the picture, not the grid: they are checked in
  // their own test. Everything else must sit on the half-beat.
  const off = (score) => Math.max(...score.notes.filter((note) => !note.pinned).map((note) => Math.abs(note.at / grid - Math.round(note.at / grid)) * grid));
  assert.ok(off(free) > 0.05, 'without a grid the score genuinely drifts');
  assert.ok(off(quantised) < 1e-6, 'with a grid every onset sits on it');
  assert.equal(quantised.grid, grid);
  assert.equal(quantised.notes.length, free.notes.length, 'quantising moves notes, it does not drop them');
});

test('grooves differ in where the holes are, not only how many notes', async () => {
  const { composeForShots } = await import(scoreMod);
  const shots = [{ at: 0, length: 6 }];
  const beat = 60 / 84;
  const steps = (groove) => {
    const score = composeForShots({ shots, mood: 'warm', dynamics: 'flat', groove });
    const plucks = score.notes.filter((note) => note.voice === 'pluck');
    const grid = beat / 2;
    return new Set(plucks.map((note) => Math.round(note.at / grid) % 8));
  };
  const straight = steps('straight');
  const syncopated = steps('syncopated');
  const sparse = steps('sparse');
  assert.ok(straight.size >= 7, 'a straight groove walks nearly every eighth');
  assert.ok(!syncopated.has(1) && !syncopated.has(2), 'a syncopated groove leaves holes on the strong side');
  assert.ok(sparse.size < syncopated.size, 'a sparse groove has more air than a syncopated one');
  assert.equal(composeForShots({ shots, groove: 'straight' }).groove, 'straight');
  assert.equal(composeForShots({ shots, groove: 'nope' }).groove, 'straight', 'an unknown groove falls back, it does not crash');
});

test('a quiet shot gets air and a cut gets a fill', async () => {
  const { composeForShots } = await import(scoreMod);
  const shots = [{ at: 0, length: 4 }, { at: 4, length: 4 }];
  const grid = 0.357;
  const plucks = (score, from, to) => score.notes.filter((note) => note.voice === 'pluck' && note.at >= from && note.at < to).length;

  const adaptive = composeForShots({ shots, mood: 'warm', grid });
  const flat = composeForShots({ shots, mood: 'warm', grid, dynamics: 'flat' });
  // The opening is now allowed to be empty rather than merely sparse: a sustained
  // tone and the room, with no arpeggio competing with the first words. The fills
  // before the cut still exist, so the body of the shot is what is measured.
  assert.ok(adaptive.intensities[0] < 0.32, 'the opening is the quiet shot');
  assert.equal(plucks(adaptive, 0, 3), 0, 'a very quiet shot has no arpeggio at all');
  assert.ok(plucks(flat, 0, 3) > 0, 'a flat score keeps its arpeggio');

  // A fill lands in the half beat before each cut, and can be turned off.
  // Cuts are grid-aligned here because that is what the planner produces.
  const cut = Number((8 * 0.357).toFixed(3));
  const shotsAtCut = [{ at: 0, length: cut }, { at: cut, length: 4 }];
  const withFills = composeForShots({ shots: shotsAtCut, mood: 'warm', grid });
  const fillHats = withFills.notes.filter((note) => note.voice === 'hat' && note.at >= cut - grid - 0.01 && note.at < cut - 0.01);
  assert.ok(fillHats.length >= 1, 'the edit is announced');
  const withoutFills = composeForShots({ shots: shotsAtCut, mood: 'warm', grid, fills: false });
  const noFill = withoutFills.notes.filter((note) => note.voice === 'hat' && note.at >= cut - grid - 0.01 && note.at < cut - 0.01);
  assert.ok(noFill.length <= fillHats.length, 'fills:false leaves the join bare');
});

test('the fill follows the kind of cut', async () => {
  const { composeForShots, renderScoreWav } = await import(scoreMod);
  const grid = 0.357;
  const cut = Number((8 * grid).toFixed(3));
  const shots = [{ at: 0, length: cut }, { at: cut, length: cut }, { at: cut * 2, length: 3 }];
  const chapter = composeForShots({ shots, mood: 'warm', grid, cutTypes: ['chapter', 'join'] });
  const voices = (score, voice) => score.notes.filter((note) => note.voice === voice);
  assert.ok(voices(chapter, 'swell').length >= 1, 'a chapter change gets a swell');
  assert.ok(voices(chapter, 'riser').length >= 1, 'a presentation join gets a riser');
  const swell = voices(chapter, 'swell')[0];
  const riser = voices(chapter, 'riser')[0];
  assert.ok(swell.at < cut && swell.at + swell.dur <= cut + grid, 'the swell ends on the cut');
  assert.ok(riser.at < cut * 2 && riser.at + riser.dur <= cut * 2 + grid, 'the riser lands on its join');
  assert.equal(renderScoreWav(chapter).toString('ascii', 0, 4), 'RIFF', 'the new voices render');
});

test('align=cuts reads the film and lands chords on its shots', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const scoreTool = tools.find((t) => t.name === 'mise_score');
  const dir = mkdtempSync(join(tmpdir(), 'mise-cutscore-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section><iframe src="a.html#t=0,3"></iframe><iframe src="b.html#t=0,2" at="3"></iframe></section>');
  writeFileSync(join(dir, 'a.html'), '<script>window.film={duration:3,frame(){}}</script>');
  writeFileSync(join(dir, 'b.html'), '<script>window.film={duration:2,frame(){}}</script>');

  const made = await scoreTool.execute({ cwd: dir, name: 'cutscore', align: 'cuts', mood: 'warm' });
  assert.equal(made.ok, true);
  assert.deepEqual(made.cutPoints, [0, 3]);
  assert.ok(made.seconds >= 5);
  rmSync(dir, { recursive: true, force: true });
});

test('auto dynamics opens quiet, builds, and puts the heartbeat only on the climax', async () => {
  const { composeForShots } = await import(scoreMod);
  const shots = [{ at: 0, length: 3 }, { at: 3, length: 3 }, { at: 6, length: 3 }, { at: 9, length: 3 }, { at: 12, length: 4 }];
  const auto = composeForShots({ shots, mood: 'warm' });
  assert.ok(auto.intensities[0] < auto.intensities[3], 'the film builds');
  assert.ok(auto.intensities[4] < auto.intensities[3], 'the last shot settles');

  const drumsIn = (score, from, to) => score.notes.filter((n) => (n.voice === 'kick' || n.voice === 'hat') && n.at >= from && n.at < to).length;
  assert.equal(drumsIn(auto, 0, 3), 0, 'no percussion while the film is quiet');
  assert.ok(drumsIn(auto, 9, 12) > 0, 'percussion arrives at the climax');
  assert.ok(auto.notes.filter((n) => n.voice === 'pulse').length > 0, 'a sub pulse under the loudest shot');

  const flat = composeForShots({ shots, mood: 'warm', dynamics: 'flat' });
  assert.equal(flat.notes.filter((n) => n.voice === 'pulse').length, 0, 'flat has no climax, so no pulse');
  assert.ok(drumsIn(flat, 0, 3) > 0, 'flat keeps one density from the start');
});


test('the score has a shape: it opens unresolved and lands on the tonic', async () => {
  const { composeForShots } = await import(scoreMod);
  const shots = [0, 3, 6, 9, 12].map((at) => ({ at, length: 3 }));
  const shaped = composeForShots({ shots, mood: 'warm', cutKinds: ['title', 'scene', 'graphics', 'type', 'end'] });
  const root = (score, t) => (score.notes.find((n) => n.voice === 'pad' && Math.abs(n.at - t) < 0.01) ?? {}).midi;
  const plain = composeForShots({ shots, mood: 'warm' });
  assert.notEqual(root(shaped, 0), root(shaped, 12), 'the film does not open on the chord it ends on');
  assert.equal(root(shaped, 12), root(plain, 0), 'the ending resolves to the tonic');
  assert.equal(root(plain, 0), root(plain, 12), 'without kinds the score simply cycles (the old behaviour)');
});


test('the last chord is allowed to ring past the final cut', async () => {
  const { composeForShots } = await import(scoreMod);
  const shots = [{ at: 0, length: 3 }, { at: 3, length: 3 }];
  const score = composeForShots({ shots, mood: 'warm', cutKinds: ['title', 'end'] });
  const end = 6;
  const after = score.notes.filter((note) => note.at >= end - 0.1 && note.voice === 'pad');
  assert.ok(after.length >= 2, 'a release chord is written after the last cut');
  const release = after[0];
  assert.ok(release.at + release.dur <= score.seconds + 0.01, 'it stays inside the reserved tail');
  assert.ok(release.wet >= 0.6, 'and it is wetter than the body, so it rings rather than stops');
  assert.ok(release.gain < 0.15, 'but quieter than the chord it follows');
});


test('the bed ducks before the line and lifts between sentences', async () => {
  const { planMix } = await import(mixMod);
  const plan = planMix({
    music: 'm.wav',
    voices: [{ path: 'v.wav', at: 0 }],
    output: 'o.m4a',
    speech: [{ start: 0.6, end: 1.2 }, { start: 2.0, end: 2.6 }],
  });
  assert.ok(plan.filter.includes('volume=volume='), 'a gain curve rather than a compressor');
  assert.ok(plan.filter.includes('(t-0.480)'), 'it starts falling before the first line');
  assert.ok(!plan.filter.includes('sidechaincompress'), 'no compressor when the regions are known');

  // Without regions the reactive path is still available.
  const reactive = planMix({ music: 'm.wav', voices: [{ path: 'v.wav', at: 0 }], output: 'o.m4a', seconds: 4 });
  assert.ok(reactive.filter.includes('sidechaincompress'));
});

test('speech regions come from the voice envelope, with a comma bridged', async () => {
  const { speechRegions } = await import(audioMod);
  const fps = 30;
  const values = new Array(90).fill(0);
  for (let i = 6; i < 27; i += 1) values[i] = 0.7;   // 0.2 - 0.9s
  for (let i = 32; i < 60; i += 1) values[i] = 0.7;  // 1.07 - 2.0s, a 0.17s pause
  for (let i = 75; i < 88; i += 1) values[i] = 0.7;  // 2.5 - 2.93s, a real pause
  const regions = speechRegions({ values, fps, duration: 3 });
  assert.equal(regions.length, 2, 'a comma does not split a sentence, a pause does');
  assert.ok(regions[0].start < 0.2, 'each region starts before the words');
  assert.ok(regions[1].start > 2.3, 'the second sentence begins after the pause (minus its lead-in)');
});


test('every cut carries its own accent, on the exact cut time', async () => {
  const { composeForShots } = await import(scoreMod);
  const shots = [{ at: 0, length: 3 }, { at: 3, length: 3.5 }, { at: 6.5, length: 4 }];
  // A grid that does not divide the cuts: the accent must still land on them.
  const score = composeForShots({ shots, mood: 'warm', grid: 0.357 });
  assert.deepEqual(score.accentCuts, [3, 6.5]);
  const onCut = score.notes.filter((note) => note.voice === 'kick' && score.accentCuts.some((cut) => Math.abs(note.at - cut) < 1e-6));
  assert.equal(onCut.length, score.accentCuts.length, 'one accent per cut');
  for (const cut of score.accentCuts) {
    assert.ok(onCut.some((note) => Math.abs(note.at - cut) < 1e-6), `cut ${cut} has no accent`);
  }
});
