/**
 * The meter, checked against signals whose answer is known.
 *
 * A loudness meter that is a decibel off is worse than no meter, because it
 * makes a delivery look compliant when it is not. These tests build sines of
 * known amplitude and frequency and hold the module to the numbers ffmpeg's
 * ebur128 reports on the same file (verified by hand: −9.0 LUFS for the half
 * scale 997 Hz tone below).
 *
 *   node tests/audio.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const audio = new URL('../film-audio.mjs', import.meta.url).href;

/** A mono 16-bit WAV of `seconds` of a sine. */
function tone({ hz = 997, amplitude = 0.5, seconds = 5, sampleRate = 44100, channels = 1 } = {}) {
  const frames = Math.floor(sampleRate * seconds);
  const buffer = Buffer.alloc(44 + frames * channels * 2);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * channels * 2, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * 2, 28);
  buffer.writeUInt16LE(channels * 2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * channels * 2, 40);
  for (let i = 0; i < frames; i += 1) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * i) / sampleRate) * amplitude * 32767);
    for (let c = 0; c < channels; c += 1) buffer.writeInt16LE(value, 44 + (i * channels + c) * 2);
  }
  return buffer;
}

test('loudness matches the reference meter on a known tone', async () => {
  const { auditAudio } = await import(audio);
  // ffmpeg -af ebur128 reads -9.0 LUFS for this file.
  const report = auditAudio(tone({ hz: 997, amplitude: 0.5 }));
  assert.ok(Math.abs(report.loudness - -9.0) <= 0.4, `read ${report.loudness} LUFS, reference -9.0`);
  assert.ok(Math.abs(report.peak - -5.7) <= 0.5, `peak ${report.peak} dBTP`);
});

test('a quieter tone reads quieter, by the decibels taken away', async () => {
  const { integratedLoudness, samplesOf } = await import(audio);
  const loud = samplesOf(tone({ amplitude: 0.5 }));
  const quiet = samplesOf(tone({ amplitude: 0.25 }));
  const a = integratedLoudness(loud.channels, loud.sampleRate).lufs;
  const b = integratedLoudness(quiet.channels, quiet.sampleRate).lufs;
  assert.ok(Math.abs((a - b) - 6) <= 0.5, `halving the amplitude should be 6 LU, measured ${(a - b).toFixed(2)}`);
});

test('stereo is summed by power, not averaged into mono', async () => {
  const { integratedLoudness, samplesOf } = await import(audio);
  const mono = samplesOf(tone({ amplitude: 0.4, channels: 1 }));
  const stereo = samplesOf(tone({ amplitude: 0.4, channels: 2 }));
  const a = integratedLoudness(mono.channels, mono.sampleRate).lufs;
  const b = integratedLoudness(stereo.channels, stereo.sampleRate).lufs;
  // The same signal out of two speakers is about 3 LU louder than one.
  assert.ok(Math.abs((b - a) - 3) <= 0.6, `stereo read ${(b - a).toFixed(2)} LU above mono`);
});

test('the spectrum puts a tone in the band it belongs to', async () => {
  const { spectrum, samplesOf } = await import(audio);
  const low = spectrum(samplesOf(tone({ hz: 100 })).samples, 44100);
  const presence = spectrum(samplesOf(tone({ hz: 3000 })).samples, 44100);
  assert.ok(low.shares.low > 0.8, `100 Hz sits in low (${JSON.stringify(low.shares)})`);
  assert.ok(presence.shares.presence > 0.8, `3 kHz sits in presence (${JSON.stringify(presence.shares)})`);
});

test('a file over the ceiling is a problem, and a quiet one is a note', async () => {
  const { auditAudio } = await import(audio);
  const hot = auditAudio(tone({ amplitude: 0.99 }));
  assert.equal(hot.ok, false);
  assert.ok(hot.problems.some((problem) => /true peak/.test(problem)));
  const quiet = auditAudio(tone({ amplitude: 0.05 }), { targetLufs: -14 });
  assert.equal(quiet.ok, true);
  assert.ok(quiet.notes.some((note) => /under the -14 LUFS target/.test(note)));
});
