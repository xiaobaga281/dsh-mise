/**
 * Per-shot review: a film is not rendered until each shot's keyframe has been
 * looked at and approved.
 *
 * FredTalk's staged review (MIT) is the model: real content first, motion later,
 * with a recorded verdict per shot. A film here is pages, so "the shot"
 * is one picture clip on the footage track, and its keyframe is a moment inside
 * it that `look` can draw. This module owns the record; drawing the keyframe is
 * the caller's job (it needs the browser), and it is stored beside the film so
 * the decision survives a restart.
 *
 * @module mise-film-review
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const REVIEW_FILE = join('.film', 'review.json');
const KEYFRAME_DIR = join('.film', 'review');

/**
 * The shots a review walks, in film order.
 *
 * Only the deepest picture track is reviewed: captions and title overlays sit
 * above the footage and would otherwise be listed as shots.
 * @param {object} facts checkFilm() facts
 * @returns {Array<{ id: string, src: string, at: number, length: number, keyframeAt: number, kind: string }>}
 */
export function shotsFromFacts(facts) {
  const clips = Array.isArray(facts?.picture) ? facts.picture : [];
  const usable = clips.filter((c) => Number.isFinite(c.at) && Number.isFinite(c.length) && c.length > 0);
  if (usable.length === 0) return [];
  const deepest = Math.max(...usable.map((c) => Number(c.track) || 0));
  const shots = usable.filter((c) => (Number(c.track) || 0) === deepest);
  const seen = new Set();
  return shots
    .filter((c) => {
      const key = String(c.id ?? c.src);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.at - b.at)
    .map((c) => ({
      id: String(c.id ?? c.src),
      src: String(c.src ?? ''),
      kind: String(c.kind ?? ''),
      at: Number(c.at),
      length: Number(c.length),
      // A moment past the first beat but well before the end: the frame the
      // person would judge, not the fade-in.
      keyframeAt: Number((c.at + Math.min(1.2, Math.max(0.3, c.length * 0.35))).toFixed(3)),
    }));
}

/** The record as stored, tolerant of a missing or broken file. */
export function readReview(projectPath) {
  try {
    const parsed = JSON.parse(readFileSync(join(projectPath, REVIEW_FILE), 'utf8'));
    return {
      version: 1,
      shots: parsed?.shots && typeof parsed.shots === 'object' ? parsed.shots : {},
    };
  } catch {
    return { version: 1, shots: {} };
  }
}

function writeReview(projectPath, record) {
  mkdirSync(join(projectPath, '.film'), { recursive: true });
  writeFileSync(join(projectPath, REVIEW_FILE), `${JSON.stringify(record, null, 2)}\n`);
}

/** Where a shot's keyframe picture is kept, relative to the film. */
export function keyframePath(shotId) {
  const safe = String(shotId).replace(/[^A-Za-z0-9._-]+/g, '-').slice(0, 60) || 'shot';
  return join(KEYFRAME_DIR, `${safe}.png`).split('\\').join('/');
}

/**
 * The review state of every shot, merged with the film's current shots.
 *
 * A shot the film no longer has is not listed; a new shot appears as pending,
 * so an edit that adds or moves a shot cannot slip past the gate.
 * @param {string} projectPath
 * @param {object} facts checkFilm() facts
 */
export function reviewStatus(projectPath, facts) {
  const plan = shotsFromFacts(facts);
  const record = readReview(projectPath);
  const shots = plan.map((shot) => {
    const entry = record.shots[shot.id] ?? {};
    // A tool schema takes one type per field, so "no keyframe yet" is an empty
    // string, not null; the renderer tests it as falsy.
    const keyframe = typeof entry.keyframe === 'string' && existsSync(join(projectPath, entry.keyframe)) ? entry.keyframe : '';
    return {
      ...shot,
      state: entry.state === 'approved' ? 'approved' : entry.state === 'changed' ? 'changed' : 'pending',
      note: typeof entry.note === 'string' ? entry.note : '',
      keyframe,
    };
  });
  const approved = shots.filter((s) => s.state === 'approved').length;
  return {
    shots,
    counts: {
      total: shots.length,
      approved,
      pending: shots.filter((s) => s.state === 'pending').length,
      changed: shots.filter((s) => s.state === 'changed').length,
    },
    readyToRender: shots.length > 0 && approved === shots.length,
  };
}

/**
 * Record a verdict for one shot.
 * @param {string} projectPath
 * @param {string} shotId
 * @param {{ state: 'approved'|'changed'|'pending', note?: string, keyframe?: string, at?: number }} patch
 */
export function setShotReview(projectPath, shotId, patch) {
  if (!shotId) throw new Error('shot id is required');
  if (!['approved', 'changed', 'pending'].includes(patch?.state)) throw new Error('state must be approved, changed or pending');
  if (patch.state === 'changed' && !String(patch.note ?? '').trim()) {
    throw new Error('a shot marked changed needs a note saying what to change');
  }
  const record = readReview(projectPath);
  const previous = record.shots[shotId] ?? {};
  record.shots[shotId] = {
    ...previous,
    state: patch.state,
    ...(patch.note !== undefined ? { note: String(patch.note).slice(0, 600) } : {}),
    ...(patch.keyframe ? { keyframe: String(patch.keyframe) } : {}),
    ...(Number.isFinite(patch.at) ? { at: Number(patch.at) } : {}),
    updatedAt: new Date().toISOString(),
  };
  writeReview(projectPath, record);
  return record.shots[shotId];
}

export { REVIEW_FILE, KEYFRAME_DIR };
