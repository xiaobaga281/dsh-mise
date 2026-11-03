/**
 * A score, composed and synthesised by code.
 *
 * A film needs music, and asking a music model for it is one more external
 * dependency and one more licence to check. A short film's bed does not need
 * one: a key, a tempo, a four-chord progression, a pad, an arpeggio, a bass and
 * two percussion voices, mixed under the voice, is enough to carry the picture.
 *
 * Everything here is deterministic: the same seed, mood and tempo produce the
 * same samples, so a re-render sounds identical.
 *
 * @module openfilm-film-score
 */

import { writeFileSync } from 'node:fs';
import { integratedLoudness } from './film-audio.mjs';

const SAMPLE_RATE = 44100;

/** Keys and progressions, as scale degrees (1-based) on the chosen mode. */
export const SCORE_MOODS = {
  warm: { mode: 'major', degrees: [1, 5, 6, 4], velocity: 0.5, drums: true, tint: 'amber' },
  hopeful: { mode: 'major', degrees: [1, 4, 5, 6], velocity: 0.55, drums: true, tint: 'paper' },
  tense: { mode: 'minor', degrees: [1, 6, 3, 7], velocity: 0.45, drums: true, tint: 'teal' },
  minimal: { mode: 'major', degrees: [1, 6], velocity: 0.38, drums: false, tint: 'mono' },
};

export const SCORE_KEYS = ['C', 'D', 'E', 'F', 'G', 'A', 'B'];

const SCALES = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

const KEY_OFFSET = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/**
 * Grooves, as an eight-step pattern of half-beats in one bar.
 *
 * `straight` hits every half beat and is what a test tone does. `syncopated`
 * leaves holes on the strong beats and answers off the beat — the difference
 * between a drum machine and a groove. `sparse` is mostly air, for a quiet
 * story beat where the room is part of the sound.
 */
export const SCORE_GROOVES = {
  straight: [1, 1, 1, 1, 1, 1, 1, 1],
  syncopated: [1, 0, 0, 1, 1, 0, 1, 0],
  sparse: [1, 0, 0, 0, 1, 0, 0, 0],
};

/**
 * Harmony by section, not by shot index.
 *
 * A film's music has a shape: it opens unresolved, states its material while the
 * scenes run, tightens under the proof, and lands on the tonic at the end. A
 * single progression cycled by index has none of that — every bar is equally
 * important, which is the musical version of a slideshow.
 *
 * Degrees index into the mood's own progression, so a "tense" film and a "warm"
 * film keep their colour while the shape stays the same.
 */
export const SECTION_DEGREES = {
  intro: [5, 5, 4, 5],
  verse: [0, 5, 3, 4],
  bridge: [3, 4, 2, 5],
  pulse: [0, 0, 3, 3],
  outro: [4, 0],
};

/** Which section a shot kind belongs to. Unknown kinds fall back to the verse. */
export function sectionForKind(kind) {
  if (kind === 'title') return 'intro';
  if (kind === 'end') return 'outro';
  if (kind === 'graphics' || kind === 'particles' || kind === 'pulse') return 'pulse';
  if (kind === 'type') return 'bridge';
  return 'verse';
}

/** Deterministic [0,1) from an integer — the only "randomness" in the score. */
function hash(n) {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** The chord tones for one scale degree (1-based), as MIDI numbers. */
export function chordFor(degree, { key = 'D', mode = 'major' } = {}) {
  const scale = SCALES[mode] ?? SCALES.major;
  const root = 60 + (KEY_OFFSET[key] ?? 2); // middle C region
  const base = scale[(degree - 1) % 7];
  const third = scale[(degree + 1) % 7] + (degree + 1 > 7 ? 12 : 0);
  const fifth = scale[(degree + 3) % 7] + (degree + 3 > 7 ? 12 : 0);
  return [root + base, root + (third > base ? third : third + 12), root + (fifth > base ? fifth : fifth + 12)];
}

/**
 * Validate a score request before any samples are made.
 * @param {{ mood?: string, key?: string, bpm?: number, bars?: number, seconds?: number }} spec
 */
export function validateScoreSpec(spec = {}) {
  const problems = [];
  if (spec.mood !== undefined && !SCORE_MOODS[spec.mood]) problems.push(`unknown mood ${JSON.stringify(spec.mood)}; there is ${Object.keys(SCORE_MOODS).join(', ')}`);
  if (spec.key !== undefined && !SCORE_KEYS.includes(spec.key)) problems.push(`key must be one of ${SCORE_KEYS.join(', ')}`);
  const bpm = Number(spec.bpm ?? 84);
  if (!Number.isFinite(bpm) || bpm < 40 || bpm > 200) problems.push('bpm must be 40..200');
  const bars = spec.bars === undefined ? undefined : Number(spec.bars);
  if (bars !== undefined && (!Number.isFinite(bars) || bars < 1 || bars > 128)) problems.push('bars must be 1..128');
  const seconds = spec.seconds === undefined ? undefined : Number(spec.seconds);
  if (seconds !== undefined && (!Number.isFinite(seconds) || seconds < 2 || seconds > 900)) problems.push('seconds must be 2..900');
  return { ok: problems.length === 0, problems };
}

/**
 * The composition, as data: what plays, when, at what pitch and gain.
 * @param {{ mood?: string, key?: string, bpm?: number, bars?: number, seconds?: number, seed?: number }} spec
 */
export function composeScore(spec = {}) {
  const moodName = spec.mood ?? 'warm';
  const mood = SCORE_MOODS[moodName];
  const key = spec.key ?? 'D';
  const bpm = Number(spec.bpm ?? 84);
  const beat = 60 / bpm;
  const bars = spec.bars !== undefined
    ? Number(spec.bars)
    : Math.max(1, Math.ceil(Number(spec.seconds ?? 20) / (beat * 4)));
  const seconds = Number((bars * beat * 4).toFixed(3));
  const seed = Number(spec.seed ?? 7);
  const notes = [];

  for (let bar = 0; bar < bars; bar += 1) {
    const degree = mood.degrees[bar % mood.degrees.length];
    const chord = chordFor(degree, { key, mode: mood.mode });
    const barStart = bar * beat * 4;

    // Pad: the chord held for the bar, low and slow, so the ear has a floor.
    for (const midi of chord) {
      notes.push({ voice: 'pad', at: barStart, dur: beat * 4, midi, gain: 0.16 * mood.velocity });
    }
    // Bass: root an octave down on beats 1 and 3.
    notes.push({ voice: 'bass', at: barStart, dur: beat * 1.7, midi: chord[0] - 12, gain: 0.3 * mood.velocity });
    notes.push({ voice: 'bass', at: barStart + beat * 2, dur: beat * 1.7, midi: chord[0] - 12, gain: 0.26 * mood.velocity });

    // Arpeggio: eighth notes up the chord, softened by a seeded velocity jitter.
    for (let step = 0; step < 8; step += 1) {
      const midi = chord[step % chord.length] + (step >= 4 ? 12 : 0);
      const velocity = 0.55 + 0.45 * hash(seed + bar * 97 + step * 13);
      notes.push({ voice: 'pluck', at: barStart + step * (beat / 2), dur: beat * 0.55, midi, gain: 0.11 * mood.velocity * velocity });
    }

    if (mood.drums) {
      notes.push({ voice: 'kick', at: barStart, midi: 0, dur: 0.14, gain: 0.32 });
      notes.push({ voice: 'kick', at: barStart + beat * 2, midi: 0, dur: 0.14, gain: 0.26 });
      for (let step = 1; step < 8; step += 2) {
        notes.push({ voice: 'hat', at: barStart + step * (beat / 2), midi: 0, dur: 0.04, gain: 0.07 + 0.03 * hash(seed + step) });
      }
    }
  }

  return { mood: moodName, key, mode: mood.mode, bpm, bars, seconds, sampleRate: SAMPLE_RATE, notes };
}

/**
 * Compose against the picture: one chord per shot, its change landing exactly on
 * the cut, so the score is cut to the film instead of the film to the score.
 *
 * @param {{ shots: Array<{ at: number, length: number }>, mood?: string, key?: string, bpm?: number, seed?: number, tail?: number }} spec
 */
export function composeForShots(spec = {}) {
  const shots = (Array.isArray(spec.shots) ? spec.shots : [])
    .filter((shot) => Number.isFinite(shot?.at) && Number.isFinite(shot?.length) && shot.length > 0)
    .sort((a, b) => a.at - b.at);
  const problems = [];
  if (shots.length === 0) problems.push('at least one shot is required');
  for (let i = 1; i < shots.length; i += 1) {
    if (shots[i].at < shots[i - 1].at + shots[i - 1].length - 1e-6) problems.push(`shots overlap at ${shots[i].at}s`);
  }
  if (problems.length) return { ok: false, problems };

  const moodName = spec.mood ?? 'warm';
  const mood = SCORE_MOODS[moodName];
  const key = spec.key ?? 'D';
  const bpm = Number(spec.bpm ?? 84);
  const beat = 60 / bpm;
  const seed = Number(spec.seed ?? 7);
  const tail = Number(spec.tail ?? 0.6);
  const end = shots[shots.length - 1].at + shots[shots.length - 1].length + tail;
  const notes = [];
  const dynamics = spec.dynamics === 'flat' ? 'flat' : 'auto';
  const grooveName = spec.groove in SCORE_GROOVES ? spec.groove : 'straight';
  const groove = SCORE_GROOVES[grooveName];
  // The talk-back grid: cuts are snapped to it by the planner, so fills and
  // quantisation below place notes on the same subdivisions.
  const grid = Number(spec.grid ?? 0);

  /**
   * How loud a shot should be. A film builds to about four fifths of its length
   * and lets the last shot settle, which is also where the voice usually lands.
   */
  const intensityOf = (index) => {
    if (dynamics === 'flat') return 1;
    if (shots.length === 1) return 0.6;
    const progress = index / (shots.length - 1);
    if (progress <= 0.8) return 0.3 + 0.7 * Math.pow(progress / 0.8, 1.2);
    return 0.85 - 0.35 * ((progress - 0.8) / 0.2);
  };
  // The climax is the loudest shot whatever the film's length, so a three-shot
  // film still gets a heartbeat where a nine-shot one would.
  const peakIntensity = Math.max(...shots.map((_, index) => intensityOf(index)));

  const shotChords = [];
  const kinds = Array.isArray(spec.cutKinds) ? spec.cutKinds : [];
  // One counter per section, so a section that returns later continues its line
  // instead of restarting it.
  const sectionCursor = {};
  shots.forEach((shot, index) => {
    let degree = mood.degrees[index % mood.degrees.length];
    const kind = kinds[index];
    if (kind) {
      const section = sectionForKind(kind);
      const line = SECTION_DEGREES[section];
      const cursor = sectionCursor[section] ?? 0;
      sectionCursor[section] = cursor + 1;
      degree = mood.degrees[line[Math.min(line.length - 1, cursor)] % mood.degrees.length];
    }
    const chord = chordFor(degree, { key, mode: mood.mode });
    shotChords.push(chord);
    const start = shot.at;
    const length = shot.length;
    const intensity = intensityOf(index);
    // The rhythm follows the shot: a quiet shot gets air, the climax gets the
    // off-beats, everything between keeps the film's own groove. Only when the
    // film actually has dynamics — a flat score has no climax to follow, and an
    // explicit groove request must not be silently overridden.
    // Sound follows the picture: a shot composed right sits a little right, and
    // the room opens up as the shot gets louder. Both are stored on the note so
    // the renderer stays a pure function of the score.
    const shotPan = Array.isArray(spec.panByShot) && Number.isFinite(spec.panByShot[index])
      ? Math.max(-0.4, Math.min(0.4, Number(spec.panByShot[index])))
      : ((index % 2 === 0) ? -0.06 : 0.06);
    const shotWet = 0.2 + 0.5 * intensity;
    const adaptiveGroove = spec.grooveAdaptive !== false && dynamics === 'auto';
    const shotGroove = adaptiveGroove
      ? (intensity > 0.8 ? SCORE_GROOVES.syncopated : intensity < 0.45 ? SCORE_GROOVES.sparse : groove)
      : groove;

    // A very quiet shot is allowed to be *empty*: one long tone and the room,
    // no bass line, no arpeggio, no drums. Quiet-but-busy is what makes a mix
    // feel uniformly loud; an actual hole is what makes the next shot land.
    // A claim shot drops the rhythm on purpose: the film stops to say one thing,
    // so only the harmony holds under it.
    const isClaim = kinds[index] === 'claim';
    const bare = isClaim || (dynamics === 'auto' && intensity < 0.32);
    if (bare) {
      notes.push({ voice: 'pad', at: start, dur: Math.max(0.6, length * 0.92), midi: chord[0], gain: 0.12 * mood.velocity, intensity, pan: shotPan, wet: 0.85, pinned: true });
      notes.push({ voice: 'pad', at: start, dur: Math.max(0.6, length * 0.92), midi: chord[0] + 7, gain: 0.07 * mood.velocity, intensity, pan: shotPan, wet: 0.85, pinned: true });
      return;
    }
    for (const midi of chord) {
      notes.push({ voice: 'pad', at: start, dur: length, midi, gain: 0.16 * mood.velocity * (0.55 + 0.45 * intensity), intensity, pan: shotPan, wet: shotWet, pinned: true });
    }
    notes.push({ voice: 'bass', at: start, dur: Math.min(beat * 1.7, length * 0.5), midi: chord[0] - 12, gain: 0.3 * mood.velocity * (0.5 + 0.5 * intensity), intensity, pan: shotPan * 0.5, wet: shotWet * 0.6, pinned: true });
    if (length > beat * 2) {
      notes.push({ voice: 'bass', at: start + beat * 2, dur: Math.min(beat * 1.7, length * 0.5), midi: chord[0] - 12, gain: 0.26 * mood.velocity * (0.5 + 0.5 * intensity), intensity , pan: shotPan * 0.5, wet: shotWet * 0.6 });
    }

    // Keep the pulse, stop at the cut: the arpeggio never spills over the next
    // shot. The groove decides which half-beats actually get a note — a
    // syncopated bar has holes where the strong beats are, which is what makes
    // it read as rhythm instead of a metronome.
    // Syncopation only exists if the off-beats are walked at all: with a stride
    // of two the odd steps never happen, so the pattern's holes land on the beat
    // and nothing is off it.
    const stride = shotGroove === SCORE_GROOVES.straight && intensity <= 0.55 ? 2 : 1;
    for (let step = 0; ; step += stride) {
      const at = start + step * (beat / 2);
      if (at >= start + length - 0.02) break;
      const inBar = step % shotGroove.length;
      if (shotGroove[inBar] === 0) continue;
      const midi = chord[step % chord.length] + (step >= 4 ? 12 : 0);
      const velocity = 0.55 + 0.45 * hash(seed + index * 97 + step * 13);
      const accent = inBar === 0 || inBar === 4 ? 1.15 : 0.9;
      notes.push({ voice: 'pluck', at, dur: Math.min(beat * 0.55, start + length - at), midi, gain: 0.11 * mood.velocity * velocity * accent * (0.6 + 0.4 * intensity), intensity , pan: shotPan, wet: shotWet });
    }

    // Percussion enters only when the film has something to drive, so the quiet
    // opening and the settling end are not fighting the same beat.
    if (mood.drums && length > beat && intensity > 0.45) {
      notes.push({ voice: 'kick', at: start, midi: 0, dur: 0.14, gain: 0.32 * intensity , pan: shotPan * 0.3, wet: shotWet * 0.3 });
      if (length > beat * 2) notes.push({ voice: 'kick', at: start + beat * 2, midi: 0, dur: 0.14, gain: 0.26 * intensity , pan: shotPan * 0.3, wet: shotWet * 0.3 });
      for (let step = 1; ; step += 2) {
        const at = start + step * (beat / 2);
        if (at >= start + length - 0.04) break;
        notes.push({ voice: 'hat', at, midi: 0, dur: 0.04, gain: (0.07 + 0.03 * hash(seed + step)) * intensity , pan: shotPan * 0.7, wet: shotWet * 0.4 });
      }
    }

    // The climax gets a low pulse: a heartbeat under the loudest shot only.
    // With dynamics=flat there is no climax, so there is no pulse either.
    if (dynamics === 'auto' && intensity >= peakIntensity - 1e-9 && intensity > 0.55 && length > beat * 2) {
      for (let step = 0; ; step += 1) {
        const at = start + step * (beat / 2);
        if (at >= start + length - 0.05) break;
        if (step % 2 === 0) continue;
        notes.push({ voice: 'pulse', at, midi: chord[0] - 24, dur: 0.18, gain: 0.16 + 0.3 * (intensity - 0.55), intensity , pan: 0, wet: shotWet * 0.2 });
      }
    }
  });

  // Cadence: the last chord is allowed to ring on past the final cut. A film that
  // stops on the frame it ends reads as a loop that was cut off; a release says
  // the piece is over. It is a quieter repeat of the last chord, held into the
  // tail the score already reserves, with a long low root underneath.
  const lastShot = shots[shots.length - 1];
  const lastChord = shotChords[shotChords.length - 1] ?? chordFor(0, { key, mode: mood.mode });
  // The release must fit inside the tail the score reserves, or the file ends
  // while the chord is still sounding.
  const release = Math.max(0.4, Math.min(tail, 1.2));
  for (const midi of lastChord) {
    // Quieter than the shot it follows: a release that starts louder than the
    // ending reads as one more event instead of the music settling.
    notes.push({ voice: 'pad', at: lastShot.at + lastShot.length - 0.05, dur: release, midi, gain: 0.085 * mood.velocity, intensity: 0.3, pan: 0, wet: 0.8 });
  }
  notes.push({ voice: 'bass', at: lastShot.at + lastShot.length - 0.05, dur: release, midi: (lastChord[0] ?? 50) - 12, gain: 0.12 * mood.velocity, intensity: 0.3, pan: 0, wet: 0.75 });

  // Fills: the half beat before a cut gets a short roll, so the edit is
  // announced instead of arriving unheralded. Kept out of the first shot (there
  // is nothing to announce yet) and off when the recipe asks for air.
  //
  // The kind of fill follows the kind of cut: a hard cut gets a dry snare-ish
  // hit, a chapter change gets a cymbal swell, and a presentation join gets a
  // low riser that lands exactly where the two shots meet.
  if (spec.fills !== false) {
    const cutTypes = Array.isArray(spec.cutTypes) ? spec.cutTypes : [];
    for (let index = 1; index < shots.length; index += 1) {
      const previous = shots[index - 1];
      const cut = shots[index].at;
      const anchor = Number((cut - grid).toFixed(4));
      if (anchor <= previous.at + 0.05) continue;
      const type = cutTypes[index - 1] ?? 'cut';
      if (type === 'chapter') {
        notes.push({ voice: 'swell', at: Number((cut - grid * 2).toFixed(4)), midi: 0, dur: grid * 2, gain: 0.14 });
      } else if (type === 'join') {
        notes.push({ voice: 'riser', at: Number((cut - grid * 3).toFixed(4)), midi: 0, dur: grid * 3, gain: 0.10 });
      } else {
        notes.push({ voice: 'hat', at: Number((anchor - grid / 2).toFixed(4)), midi: 0, dur: 0.03, gain: 0.10 });
        notes.push({ voice: 'hat', at: anchor, midi: 0, dur: 0.03, gain: 0.15 });
        notes.push({ voice: 'pluck', at: anchor, dur: grid, midi: shotChords[index][0] + 12, gain: 0.09 });
      }
    }
  }

  // Downbeat on every cut. Fills announce a cut from before it; this puts the
  // weight of the bar exactly on the frame where the picture changes. Without
  // it the edit can land on an off-beat and the whole film feels slightly out of
  // step — the single most common note on a rough cut is "the music is late".
  const accentCuts = [];
  for (let index = 1; index < shots.length; index += 1) {
    const cut = shots[index].at;
    const intensity = intensityOf(index);
    const accentGain = 0.16 + 0.2 * intensity;
    notes.push({ voice: 'kick', at: cut, midi: 0, dur: 0.16, gain: accentGain, intensity, pan: 0, wet: 0.2, pinned: true });
    notes.push({ voice: 'pluck', at: cut, dur: grid, midi: (shotChords[index]?.[0] ?? 50) + 12, gain: accentGain * 0.55, intensity, pan: 0, wet: 0.45, pinned: true });
    accentCuts.push(Number(cut.toFixed(4)));
  }

  notes.sort((a, b) => a.at - b.at);

  // Grid-quantise: the picture's cuts snap to the half-beat, so the score has to
  // speak the same grid or the two drift apart by a few tens of milliseconds —
  // audible as "the hit is slightly late" even when nobody can name it.
  const quantised = grid > 0
    ? notes.map((note) => {
      // A pinned note is the cut's own accent: quantising it would move the hit
      // off the frame it exists for.
      if (note.pinned) return { ...note, at: Number(note.at.toFixed(4)), dur: Math.max(grid, Number(note.dur.toFixed(4))) };
      const at = Math.max(0, Math.round(note.at / grid) * grid);
      return {
        ...note,
        at: Number(at.toFixed(4)),
        dur: Math.max(grid, Number(note.dur.toFixed(4))),
      };
    })
    : notes;

  return {
    ok: true,
    problems: [],
    mood: moodName,
    key,
    mode: mood.mode,
    bpm,
    bars: null,
    seconds: Number(end.toFixed(3)),
    sampleRate: SAMPLE_RATE,
    dynamics,
    groove: grooveName,
    grid: grid > 0 ? Number(grid.toFixed(4)) : 0,
    cutPoints: shots.map((shot) => shot.at),
    accentCuts,
    intensities: shots.map((_, index) => Number(intensityOf(index).toFixed(2))),
    notes: quantised,
  };
}

/**
 * Render the composition to 16-bit stereo WAV bytes.
 * @param {ReturnType<typeof composeScore>} score
 * @returns {Buffer}
 */
export function renderScoreWav(score, options = {}) {
  const sr = score.sampleRate ?? SAMPLE_RATE;
  const frames = Math.ceil(score.seconds * sr) + Math.ceil(sr * 0.4);
  const left = new Float32Array(frames);
  const right = new Float32Array(frames);
  // A wet bus: the room the score plays in. Built from the dry signal with a
  // Schroeder reverb, so no samples and no download are needed to get space.
  const wetL = new Float32Array(frames);
  const wetR = new Float32Array(frames);

  const addAt = (index, value, pan) => {
    if (index < 0 || index >= frames) return;
    left[index] += value * (1 - Math.max(0, pan));
    right[index] += value * (1 + Math.min(0, pan));
  };
  const addWet = (index, value) => {
    if (index < 0 || index >= frames) return;
    wetL[index] += value;
    wetR[index] += value;
  };

  /**
   * Karplus-Strong: a burst of noise recirculated through a short delay line,
   * averaged and damped each pass. This is a plucked string, not a sine with an
   * envelope — the harmonics die at different rates the way a real string does.
   */
  const pluckBuffer = (hz, dur, seed) => {
    const length = Math.max(1, Math.floor(dur * sr));
    const period = Math.max(2, Math.round(sr / Math.max(20, hz)));
    const line = new Float32Array(period);
    for (let i = 0; i < period; i += 1) line[i] = hash(seed * 131 + i * 17) * 2 - 1;
    const out = new Float32Array(length);
    let index = 0;
    for (let i = 0; i < length; i += 1) {
      const current = line[index];
      const next = line[(index + 1) % period];
      out[i] = current;
      // 0.996 keeps the string ringing; the average is the string's damping.
      line[index] = 0.996 * 0.5 * (current + next);
      index = (index + 1) % period;
    }
    return out;
  };

  let pluckSeed = 11;
  for (const note of score.notes) {
    const start = Math.floor(note.at * sr);
    const length = Math.max(1, Math.floor(note.dur * sr));
    const hz = midiToHz(note.midi);
    const basePan = note.voice === 'pad' ? 0.15 : note.voice === 'bass' ? 0 : 0.05;
    const pan = Math.max(-0.5, Math.min(0.5, basePan + Number(note.pan ?? 0)));
    const wet = Number.isFinite(Number(note.wet)) ? Number(note.wet) : 0.35;
    // One-pole lowpass state for the pad and bass: a saw through a filter is a
    // warm pad; a bare saw is a buzz.
    let lp = 0;
    if (note.voice === 'pluck') {
      const string = pluckBuffer(hz, note.dur, pluckSeed += 7);
      for (let i = 0; i < length; i += 1) {
        const value = (string[i] ?? 0) * 0.7;
        addAt(start + i, value * note.gain, pan);
        addWet(start + i, value * note.gain * wet);
      }
      continue;
    }
    if (note.voice === 'swell' || note.voice === 'riser' || note.voice === 'hat' || note.voice === 'kick' || note.voice === 'pulse') {
      addWet(start, 0); // percussive voices stay dry; the room is for the tonal ones
    }
    for (let i = 0; i < length; i += 1) {
      const t = i / sr;
      let value = 0;
      if (note.voice === 'pad') {
        // Three detuned partials through a lowpass: slow attack, warm body.
        const env = Math.min(1, t / 0.5) * Math.min(1, (note.dur - t) / 0.9);
        const raw = Math.sin(2 * Math.PI * hz * t) * 0.5
          + Math.sin(2 * Math.PI * hz * 1.004 * t) * 0.3
          + Math.sin(2 * Math.PI * hz * 2.002 * t) * 0.12;
        lp += (raw - lp) * 0.22;
        value = lp * env;
      } else if (note.voice === 'bass') {
        const env = Math.min(1, t / 0.02) * Math.exp(-t * 2.2);
        const raw = Math.sin(2 * Math.PI * hz * t) + 0.28 * Math.sin(2 * Math.PI * hz * 2 * t);
        lp += (raw - lp) * 0.3;
        value = lp * env;
      } else if (note.voice === 'kick') {
        const env = Math.exp(-t * 22);
        const sweep = 120 * Math.exp(-t * 18) + 42;
        // A short click on the attack: without it a kick is a soft thump.
        const click = Math.exp(-t * 220) * 0.5;
        value = Math.sin(2 * Math.PI * sweep * t) * env + (hash(start + i) * 2 - 1) * click;
      } else if (note.voice === 'pulse') {
        const env = Math.min(1, t / 0.015) * Math.exp(-t * 5.5);
        value = Math.sin(2 * Math.PI * hz * t) * env;
      } else if (note.voice === 'hat') {
        const env = Math.exp(-t * 60);
        // High-passed noise: a hat has almost no body, only air.
        value = (hash(start + i) * 2 - 1) * env;
      } else if (note.voice === 'swell') {
        const env = Math.min(1, t / 0.08) * Math.exp(-t * 2.6);
        value = (hash(start * 3 + i) * 2 - 1) * env;
      } else if (note.voice === 'riser') {
        const progress = Math.min(1, t / note.dur);
        const sweep = 80 + 260 * progress * progress;
        const env = Math.min(1, t / 0.06) * (1 - progress) * 0.9 + 0.1;
        value = Math.sin(2 * Math.PI * sweep * t) * env;
      }
      addAt(start + i, value * note.gain, pan);
      addWet(start + i, value * note.gain * wet);
    }
  }

  // Schroeder reverb on the wet bus: four combs, then two allpasses.
  const reverb = (input) => {
    const output = new Float32Array(frames);
    for (const delayMs of [29.7, 37.1, 41.1, 43.7]) {
      const d = Math.max(1, Math.floor((delayMs / 1000) * sr));
      const buffer = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < frames; i += 1) {
        const delayed = buffer[idx];
        output[i] += delayed * 0.25;
        buffer[idx] = input[i] + delayed * 0.78;
        idx = (idx + 1) % d;
      }
    }
    for (const delayMs of [5.0, 1.7]) {
      const d = Math.max(1, Math.floor((delayMs / 1000) * sr));
      const buffer = new Float32Array(d);
      let idx = 0;
      for (let i = 0; i < frames; i += 1) {
        const delayed = buffer[idx];
        const out = -output[i] + delayed;
        buffer[idx] = output[i] + delayed * 0.5;
        output[i] = out;
        idx = (idx + 1) % d;
      }
    }
    return output;
  };
  const roomL = reverb(wetL);
  const roomR = reverb(wetR);
  for (let i = 0; i < frames; i += 1) {
    left[i] += roomL[i] * 0.35;
    right[i] += roomR[i] * 0.35;
  }

  // ── the mix bus ──────────────────────────────────────────────────────────
  //
  // Peak-normalising a bed leaves it quiet in loudness terms, because a sparse
  // arrangement has a high peak and a low average: this score measured −25.9
  // LUFS, fourteen units under the streaming target, and a platform would turn
  // it up on playback. So the bus does what a mastering chain does — remove the
  // sub-30 Hz that phones cannot reproduce, set the level by integrated
  // loudness (ITU-R BS.1770), and only then fit the peaks under −1 dBTP, the
  // ceiling EBU R 128 and every streaming platform share.
  const highpass = (() => {
    const w0 = (2 * Math.PI * 30) / sr;
    const alpha = Math.sin(w0) / (2 * 0.7071);
    const cos = Math.cos(w0);
    const a0 = 1 + alpha;
    return {
      b0: ((1 + cos) / 2) / a0,
      b1: (-(1 + cos)) / a0,
      b2: ((1 + cos) / 2) / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    };
  })();
  for (const channel of [left, right]) {
    let x1 = 0; let x2 = 0; let y1 = 0; let y2 = 0;
    for (let i = 0; i < frames; i += 1) {
      const x0 = channel[i];
      const y0 = highpass.b0 * x0 + highpass.b1 * x1 + highpass.b2 * x2 - highpass.a1 * y1 - highpass.a2 * y2;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
      channel[i] = y0;
    }
  }

  // A sparse arrangement has a high crest factor, so a linear gain big enough to
  // reach the target would put the peaks through the ceiling and the peak-fit
  // would undo the gain. A stem is mastered with a limiter instead: gain up,
  // soft-clip what overshoots, measure again. Two passes land within half a unit
  // without the pumping a fast compressor would add.
  const targetLufs = Number(options.targetLufs ?? score.loudnessTarget ?? -18);
  const ceiling = 0.891; // −1 dBTP
  const originalLeft = Float32Array.from(left);
  const originalRight = Float32Array.from(right);
  let gain = 1;
  let measured = integratedLoudness([left, right], sr);
  for (let pass = 0; pass < 3; pass += 1) {
    const current = measured && Number.isFinite(measured.lufs) ? measured.lufs : targetLufs;
    const step = Math.pow(10, (targetLufs - current) / 20);
    gain = Math.max(0.2, Math.min(12, gain * step));
    for (let i = 0; i < frames; i += 1) {
      left[i] = Math.tanh((originalLeft[i] * gain) / ceiling) * ceiling;
      right[i] = Math.tanh((originalRight[i] * gain) / ceiling) * ceiling;
    }
    measured = integratedLoudness([left, right], sr);
    if (measured && Math.abs(measured.lufs - targetLufs) < 0.5) break;
  }
  let peak = 0;
  for (let i = 0; i < frames; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const scale = peak > ceiling ? ceiling / peak : 1;

  const buffer = Buffer.alloc(44 + frames * 4);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + frames * 4, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(2, 22);
  buffer.writeUInt32LE(sr, 24);
  buffer.writeUInt32LE(sr * 4, 28);
  buffer.writeUInt16LE(4, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(frames * 4, 40);
  for (let i = 0; i < frames; i += 1) {
    const l = Math.max(-1, Math.min(1, left[i] * scale));
    const r = Math.max(-1, Math.min(1, right[i] * scale));
    buffer.writeInt16LE(Math.round(l * 32767), 44 + i * 4);
    buffer.writeInt16LE(Math.round(r * 32767), 46 + i * 4);
  }
  return buffer;
}

/**
 * What a composer would check before calling the cue finished.
 *
 * Three things, all measurable and none of them a matter of taste:
 *  - do the cuts land on the score's own grid? A cut 180 ms off the beat reads
 *    as a mistake, and the planner already claims to snap them;
 *  - is the tempo related to how long the shots are? One beat every 1.5 s under
 *    six-second shots is three beats a shot, which is a heartbeat, not an edit;
 *  - is the harmony actually moving, or is it one chord with a pulse?
 *
 * @param {{ bpm: number, shots?: Array<{ at: number, length: number }>, notes?: Array<object>, chords?: string[] }} score
 */
export function auditScore(score) {
  const bpm = Number(score?.bpm ?? 0);
  const beat = bpm > 0 ? 60 / bpm : 0;
  const shots = Array.isArray(score?.shots) ? score.shots : [];
  const cuts = shots.slice(1).map((shot) => Number(shot.at)).filter((value) => Number.isFinite(value));
  const notes = [];
  let alignment = null;
  if (beat > 0 && cuts.length) {
    const offsets = cuts.map((cut) => {
      // Snap to the nearest eighth of a beat: that is the finest grid the
      // planner uses, so anything further off than half of it is audible.
      const step = beat / 2;
      const nearest = Math.round(cut / step) * step;
      return Math.abs(cut - nearest) * 1000;
    });
    alignment = {
      meanMs: Number((offsets.reduce((a, b) => a + b, 0) / offsets.length).toFixed(0)),
      worstMs: Number(Math.max(...offsets).toFixed(0)),
    };
    if (alignment.worstMs > 60) notes.push(`${alignment.worstMs} ms is the worst cut off the half-beat grid; the ear hears that as a late cut`);
  }
  const asl = shots.length ? shots.reduce((sum, shot) => sum + Number(shot.length ?? 0), 0) / shots.length : null;
  const beatsPerShot = asl && beat > 0 ? asl / beat : null;
  if (beatsPerShot !== null && (beatsPerShot < 2 || beatsPerShot > 16)) {
    notes.push(`${beatsPerShot.toFixed(1)} beats per shot at ${bpm} bpm — a bed that sparse (or that busy) stops relating to the cutting`);
  }
  const chordNotes = (score?.notes ?? []).filter((note) => note.voice === 'pad');
  const chords = [];
  for (const note of chordNotes) {
    const at = Number(note.at);
    const key = at.toFixed(2);
    const existing = chords.find((chord) => chord.key === key);
    if (existing) existing.notes.push(note.midi);
    else chords.push({ key, notes: [note.midi] });
  }
  const signature = chords.map((chord) => chord.notes.sort((a, b) => a - b).join(','));
  const variety = signature.length ? new Set(signature).size / signature.length : 0;
  if (variety < 0.5 && signature.length >= 4) notes.push(`only ${(variety * 100).toFixed(0)}% of the bars change chord — a loop, not a progression`);
  return {
    bpm,
    beat: Number(beat.toFixed(3)),
    beatsPerShot: beatsPerShot === null ? null : Number(beatsPerShot.toFixed(1)),
    alignment,
    chords: signature.length,
    chordVariety: Number(variety.toFixed(2)),
    notes,
  };
}

/** Write a score to a WAV file and return what was written. */
export function writeScore(file, spec = {}) {
  const score = composeScore(spec);
  const bytes = renderScoreWav(score);
  writeFileSync(file, bytes);
  return { file, bytes: bytes.length, seconds: score.seconds, score };
}
