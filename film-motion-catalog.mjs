/**
 * The motion catalogue: the patterns a shot page can draw, searchable.
 *
 * OpenFilm pages animate by writing `frame(t)`, which means every film tends to
 * invent its own motion from scratch — and invents the same three moves, or the
 * wrong one, each time. FredTalk's idea (MIT) is the fix: a film picks a motion
 * from a known set and can say why, instead of defaulting to a big caption.
 *
 * This module is the search side of that: patterns by use, by words in the
 * brief, or by id. The catalog itself is plain JSON beside the templates, so it
 * can grow without touching code.
 *
 * @module openfilm-motion-catalog
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PLUGIN_ROOT = dirname(fileURLToPath(import.meta.url));
const CATALOG_FILE = join(PLUGIN_ROOT, 'vendor', 'motion', 'catalog.json');

function load() {
  try {
    const parsed = JSON.parse(readFileSync(CATALOG_FILE, 'utf8'));
    return Array.isArray(parsed?.patterns) ? parsed.patterns : [];
  } catch {
    return [];
  }
}

const PATTERNS = load();

/** Every pattern id, for an error that names the real choices. */
const IDS = PATTERNS.map((p) => p.id);

/** Two-character overlaps: what makes a Chinese query match a Chinese tag. */
function bigrams(text) {
  const clean = String(text ?? '').replace(/[\s，,、。.;；:：!！?？"'“”()（）]/g, '');
  const out = new Set();
  for (let i = 0; i < clean.length - 1; i += 1) out.add(clean.slice(i, i + 2));
  return out;
}

function score(pattern, query, use) {
  let value = 0;
  const words = String(query ?? '').toLowerCase().trim();
  const wants = String(use ?? '').toLowerCase().trim();
  const haystack = [pattern.id, pattern.name, ...(pattern.use ?? []), pattern.when ?? '', pattern.avoid ?? '']
    .join(' ')
    .toLowerCase();

  if (wants) {
    const exact = (pattern.use ?? []).some((tag) => String(tag).toLowerCase() === wants);
    value += exact ? 8 : haystack.includes(wants) ? 3 : 0;
  }
  if (words) {
    if (haystack.includes(words)) value += 6;
    const mine = bigrams(words);
    const theirs = bigrams(haystack);
    let hits = 0;
    for (const g of mine) if (theirs.has(g)) hits += 1;
    value += hits;
  }
  return value;
}

/**
 * Search the catalogue.
 * @param {{ query?: string, use?: string, limit?: number }} request
 * @returns {Array<object>} patterns, best first
 */
export function searchMotion({ query = '', use = '', limit = 3 } = {}) {
  const size = Math.max(1, Math.min(10, Number(limit) || 3));
  const ranked = PATTERNS
    .map((pattern) => ({ pattern, value: score(pattern, query, use) }))
    .filter((entry) => entry.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, size)
    .map((entry) => ({ ...entry.pattern, score: entry.value }));
  // Nothing matched: offer the whole set rather than silence, so the agent can
  // choose deliberately instead of inventing something.
  return ranked.length > 0 ? ranked : PATTERNS.slice(0, size).map((p) => ({ ...p, score: 0 }));
}

/** One pattern by id, or null. */
export function getMotion(id) {
  const found = PATTERNS.find((p) => p.id === String(id ?? '').trim().toUpperCase());
  return found ? { ...found, score: null } : null;
}

/** The whole catalogue, compact. */
export function listMotion() {
  return PATTERNS.map((p) => ({ id: p.id, name: p.name, use: p.use }));
}

export { IDS as MOTION_IDS, CATALOG_FILE };
