/**
 * Cross-genre smoke: every recipe must actually build and pass frame checks.
 *
 * Slow by design — it draws four frames per genre — so it is not part of the
 * unit suite. Run it when a recipe or a primitive changes:
 *
 *   node tests/genre-smoke.mjs
 *
 * It reports one row per genre and exits non-zero if any recipe cannot render a
 * clean frame. A recipe that only exists in the planner is worse than no recipe.
 */

import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const plugin = new URL('../index.js', import.meta.url).href;
const genreMod = new URL('../film-genres.mjs', import.meta.url).href;

function mount(tools) {
  return import(plugin).then((mod) => {
    mod.apply({
      tools: { register: (tool) => { tools.push(tool); return () => {}; } },
      skills: { register: () => () => {} },
      effect: (fn) => { try { fn(); } catch {} return () => {}; },
      logger: { warn: () => {} },
      get: () => undefined,
    });
    return tools;
  });
}

const { GENRES } = await import(genreMod);
const tools = await mount([]);
const demo = tools.find((tool) => tool.name === 'mise_demo');
const verify = tools.find((tool) => tool.name === 'mise_verify');
if (!demo || !verify) {
  console.error('mise_demo / mise_verify are not registered');
  process.exit(2);
}

const rows = [];
for (const genre of Object.keys(GENRES)) {
  const base = mkdtempSync(join(tmpdir(), `mise-smoke-${genre}-`));
  try {
    const built = await demo.execute({ cwd: base, name: 'smoke', genre, seconds: 12, render: false, finish: false });
    if (!built.ok) {
      rows.push({ genre, ok: false, detail: (built.problems ?? ['build failed'])[0] });
      continue;
    }
    // Sample the middle of each shot, not arbitrary times: a shot is checked
    // when it is fully on screen, which is what "this recipe works" means.
    const plan = JSON.parse(readFileSync(join(base, 'smoke', '.film', 'plan.json'), 'utf8'));
    const times = plan.beats.slice(0, 4).map((beat) => Number((beat.at + beat.length / 2).toFixed(2)));
    const checked = await verify.execute({ cwd: join(base, 'smoke'), times });
    rows.push({
      genre,
      ok: checked.ok === true,
      detail: checked.ok ? `${checked.checked} frames` : (checked.problems?.[0] ?? 'frame check failed'),
      continuity: checked.continuity ? (checked.continuity.ok ? 'one film' : `${checked.continuity.problems.length} jump(s)`) : '',
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

for (const row of rows) {
  const mark = row.ok ? 'ok  ' : 'FAIL';
  console.log(`${mark} ${row.genre.padEnd(16)} ${row.detail}${row.continuity ? `  · ${row.continuity}` : ''}`);
}
const failed = rows.filter((row) => !row.ok);
console.log(`\n${rows.length - failed.length}/${rows.length} genres pass`);
process.exit(failed.length ? 1 : 0);
