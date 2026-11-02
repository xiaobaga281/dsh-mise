/**
 * The doctor: what this machine can do, and the exact fix when it cannot.
 *
 *   node tests/doctor.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const doctorMod = new URL('../film-doctor.mjs', import.meta.url).href;

test('no ffmpeg means nothing can be exported, and the fix is printable', async () => {
  const { assessEnvironment } = await import(doctorMod);
  const report = assessEnvironment({
    platform: 'linux',
    node: '24.0.0',
    ffmpeg: { ok: false },
    ffprobe: { ok: false },
    chromium: { ok: true },
  });
  assert.equal(report.ok, false);
  assert.equal(report.tier, 'unsupported');
  const ffmpegStep = report.nextSteps.find((step) => step.id === 'ffmpeg');
  assert.ok(ffmpegStep, 'the missing ffmpeg is named');
  assert.match(ffmpegStep.fix, /apt install ffmpeg/);
});

test('an ffmpeg without libx264 is caught before a render, not after', async () => {
  const { assessEnvironment } = await import(doctorMod);
  const bare = assessEnvironment({
    platform: 'win32',
    ffmpeg: { ok: true, filters: ['vignette'], encoders: ['aac'] },
    ffprobe: { ok: true },
    chromium: { ok: true },
  });
  assert.equal(bare.ok, false, 'no x264 means no deliverable');
  const encoderCheck = bare.checks.find((check) => check.id === 'encoders');
  assert.equal(encoderCheck.ok, false);
  assert.match(encoderCheck.detail, /libx264/);
  assert.match(encoderCheck.fix, /winget install/);

  // An ffmpeg whose encoder list could not be read is not failed over it.
  const unreadable = assessEnvironment({
    ffmpeg: { ok: true, filters: [], encoders: [] },
    ffprobe: { ok: true },
    chromium: { ok: true },
  });
  assert.equal(unreadable.ok, true, 'unknown is not the same as missing');
  assert.equal(unreadable.tier, 'cinematic');
});

test('the tier ladder names what each step needs', async () => {
  const { assessEnvironment, describeTier } = await import(doctorMod);
  const base = {
    platform: 'linux',
    ffmpeg: { ok: true, filters: ['vignette'], encoders: ['libx264', 'aac'] },
    ffprobe: { ok: true },
    chromium: { ok: true },
    fonts: { cjk: true },
    packs: { installed: [], available: [] },
  };
  const cinematic = assessEnvironment(base);
  assert.equal(cinematic.tier, 'cinematic');
  assert.deepEqual(cinematic.matrix.cinematic, ['node', 'ffmpeg', 'encoders', 'chromium']);

  const animated = assessEnvironment({ ...base, ffmpeg: { ...base.ffmpeg, filters: ['minterpolate'] } });
  assert.equal(animated.tier, 'animated');
  assert.ok(animated.matrix.animated.includes('filter minterpolate'));
  assert.match(describeTier(animated), /interpolated/);

  const layered = assessEnvironment({ ...base, ffmpeg: { ...base.ffmpeg, filters: ['minterpolate'] }, packs: { installed: ['depth'], available: ['depth'] } });
  assert.equal(layered.tier, 'layered');
  assert.equal(layered.nextSteps.length, 0, 'a complete machine has nothing to do');
});

test('a missing font is a warning with a fix, not a blocker', async () => {
  const { assessEnvironment } = await import(doctorMod);
  const report = assessEnvironment({
    platform: 'linux',
    ffmpeg: { ok: true, filters: [], encoders: ['libx264', 'aac'] },
    ffprobe: { ok: true },
    chromium: { ok: true },
    fonts: { cjk: false },
  });
  assert.equal(report.ok, true, 'a latin-only machine can still render');
  const font = report.checks.find((check) => check.id === 'cjk-fonts');
  assert.equal(font.ok, false);
  assert.match(font.fix, /fonts-noto-cjk/);
});

test('a new machine is told what it can do and the one command to prove it', async () => {
  const { assessEnvironment, startGuide } = await import(doctorMod);
  const healthy = assessEnvironment({
    platform: 'linux',
    ffmpeg: { ok: true, filters: ['minterpolate'], encoders: ['libx264', 'aac'] },
    ffprobe: { ok: true },
    chromium: { ok: true },
    fonts: { cjk: true },
    packs: { installed: [], available: [] },
  });
  const guide = startGuide(healthy);
  assert.equal(guide.ok, true);
  assert.ok(guide.canDo.length >= 3, 'it says what already works');
  assert.match(guide.firstStep, /mise_demo/, 'and the first step is a command that makes a film');

  const broken = startGuide(assessEnvironment({ platform: 'linux', ffmpeg: { ok: false }, ffprobe: { ok: false }, chromium: { ok: false } }));
  assert.equal(broken.ok, false);
  assert.equal(broken.canDo.length, 0, 'nothing is promised before it can render');
  assert.match(broken.reason, /ffmpeg/, 'the first blocker is named');
  assert.match(broken.firstStep, /install ffmpeg/, 'with a command, not advice');
});
