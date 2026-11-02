/**
 * Structure from the material.
 *
 * A promo's skeleton has always been chosen from a list (open-source, pricing,
 * performance, product), and the shots then filled that skeleton. That is fine
 * when the material is unremarkable, but the material itself carries the order:
 * a calm plate opens, a busy one lands the argument, and the densest plate is
 * the one that has to sit right before the claim.
 *
 * So this module measures the plates — decoding each one and counting ink the
 * same way the composer does — and returns a shot order and per-shot lengths
 * derived from those numbers. Nothing here is invented: every number is read off
 * a file that is about to be shown.
 *
 * @module mise-structure
 */

import { readFileSync } from 'node:fs';
import { decodePng, inkGrid, inferIntent } from './film-compose.mjs';

/**
 * Measure one plate.
 * @param {string} file
 */
function measurePlate(file, projectPath) {
  const path = /^([a-z]+:)?[\\/]/i.test(file) ? file : `${projectPath.replace(/[\\/]$/, '')}/${file}`;
  try {
    const image = decodePng(readFileSync(path));
    if (!image.ok) return { file, ok: false, problems: image.problems };
    const grid = inkGrid(image);
    return { file, ok: true, ink: grid.totalInk, luma: grid.meanLuma, aspect: image.height / image.width };
  } catch (error) {
    return { file, ok: false, problems: [String(error?.message ?? error)] };
  }
}

/**
 * Order the material and give each shot its length.
 *
 * @param {{
 *   screens: Array<{ file: string, kicker?: string, title?: string[], note?: string }>,
 *   projectPath: string,
 *   seconds?: number,
 *   claim?: string,
 *   facts?: Array<{ value?: number, unit?: string, label?: string }>,
 *   title?: string[],
 *   url?: string,
 *   brand?: string,
 * }} brief
 */
export function structureFromMaterial(brief = {}) {
  const projectPath = String(brief.projectPath ?? '.');
  const screens = Array.isArray(brief.screens) ? brief.screens : [];
  const problems = [];
  if (!screens.length) problems.push('auto structure needs at least one screen');

  const measured = screens.map((screen) => ({ screen, ...measurePlate(String(screen?.file ?? ''), projectPath) }));
  const usable = measured.filter((entry) => entry.ok);
  for (const entry of measured) if (!entry.ok) problems.push(`${entry.file}: ${(entry.problems ?? []).join('; ')}`);

  // Calm first, busy last: the order the eye is led through, not the order the
  // files happen to be listed in.
  const ordered = [...usable].sort((a, b) => a.ink - b.ink);
  const total = Math.max(4, Math.min(600, Number(brief.seconds ?? 18)));
  const hasClaim = typeof brief.claim === 'string' && brief.claim.trim().length > 0;
  const hasFacts = Array.isArray(brief.facts) && brief.facts.length > 0;

  // Beats: title, the plates, an optional number, the claim, an end card. The
  // plates keep the measured order; the number sits before the claim because it
  // is the evidence the claim rests on.
  const beats = [];
  beats.push({ kind: 'type', title: brief.title ?? [brief.brand ?? 'Mise'], duration: 2.6 });
  ordered.forEach((entry) => beats.push({ kind: 'plate', entry }));
  if (hasFacts) beats.push({ kind: 'number', duration: 3.2, entry: ordered[ordered.length - 1] });
  if (hasClaim) beats.push({ kind: 'claim', duration: 0, claim: brief.claim });
  beats.push({ kind: 'end', duration: 2.4, url: brief.url ?? '' });

  // Lengths are a budget, not a share: every beat has a floor it may not go
  // under (a plate needs long enough to read), and whatever is left over goes to
  // the claim and to the plates, weighted by how much air each plate has.
  const claimBeat = beats.find((beat) => beat.kind === 'claim');
  const plateBeats = beats.filter((beat) => beat.kind === 'plate');
  const FLOOR = { type: 2.2, plate: 1.9, number: 2.8, claim: 3.8, end: 2.0 };
  const floors = beats.map((beat) => Math.min(beat.duration || Infinity, FLOOR[beat.kind] ?? 1.8));
  const floorTotal = floors.reduce((a, b) => a + b, 0);
  // A film shorter than its own floors is scaled, not overrun.
  const scale = floorTotal > total ? total / floorTotal : 1;
  beats.forEach((beat, index) => { beat.duration = floors[index] * scale; });

  const surplus = Math.max(0, total - floorTotal * scale);

  // Plates earn time by air: a calm frame holds, a dense one has to move.
  const weights = plateBeats.map((beat) => Math.max(0.7, Math.min(1.35, 1.25 - Number(beat.entry?.ink ?? 0) / 120)));
  const weightTotal = weights.reduce((a, b) => a + b, 0) || 1;
  let claimExtra = 0;
  if (claimBeat) {
    const wanted = surplus * 0.45;
    const ceiling = 6.4 - claimBeat.duration;
    claimExtra = Math.max(0, Math.min(wanted, ceiling));
    claimBeat.duration += claimExtra;
  }
  const plateSurplus = surplus - claimExtra;
  plateBeats.forEach((beat, index) => {
    beat.duration += (plateSurplus * weights[index]) / weightTotal;
  });

  beats.forEach((beat) => { beat.duration = Number(Math.max(0.8, Math.min(12, beat.duration)).toFixed(2)); });

  // Intents come from the same reading the composer would do on its own.
  for (const beat of plateBeats) {
    const grid = { totalInk: Number(beat.entry?.ink ?? 0), meanLuma: Number(beat.entry?.luma ?? 30) };
    beat.intent = inferIntent({ index: beats.indexOf(beat), screen: {}, grid }).intent;
  }

  return {
    ok: problems.length === 0,
    problems,
    beats: beats.map((beat) => ({
      kind: beat.kind,
      duration: beat.duration,
      ...(beat.entry ? { image: beat.entry.screen.file, ink: beat.entry.ink, luma: beat.entry.luma } : {}),
      ...(beat.intent ? { intent: beat.intent } : {}),
      ...(beat.claim ? { claim: beat.claim } : {}),
      ...(beat.url ? { url: beat.url } : {}),
      ...(beat.entry?.screen?.kicker ? { kicker: beat.entry.screen.kicker } : {}),
      ...(Array.isArray(beat.entry?.screen?.title) ? { title: beat.entry.screen.title } : {}),
    })),
    order: ordered.map((entry) => ({ file: entry.file, ink: entry.ink, luma: entry.luma })),
    seconds: Number(beats.reduce((sum, beat) => sum + beat.duration, 0).toFixed(2)),
  };
}
