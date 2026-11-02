/**
 * Code-native primitives with no picture: typography and procedural graphics.
 *
 *   node tests/primitives.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const typeMod = new URL('../film-type.mjs', import.meta.url).href;
const gfxMod = new URL('../film-graphics.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

function mount() {
  const tools = [];
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

test('type specs name their motions and refuse empty lines', async () => {
  const { validateTypeSpec } = await import(typeMod);
  assert.equal(validateTypeSpec({ lines: [] }).ok, false);
  assert.match(validateTypeSpec({ lines: [{ text: 'hi' }], motion: 'slide' }).problems.join(' '), /unknown motion/);
  assert.equal(validateTypeSpec({ lines: [{ text: 'hi' }], motion: 'mask-rise' }).ok, true);
  assert.equal(validateTypeSpec({ lines: [{ text: 'a' }, { text: 'b' }, { text: 'c' }, { text: 'd' }, { text: 'e' }] }).ok, false);
});

test('the type page is deterministic and animates per unit', async () => {
  const { buildTypePage } = await import(typeMod);
  const spec = { lines: [{ text: '一只狐狸', kicker: 'opening' }, { text: '把信送到了灯塔' }], motion: 'mask-rise', duration: 3 };
  const a = buildTypePage(spec);
  const b = buildTypePage(spec);
  assert.equal(a, b);
  assert.ok(a.includes('window.film'));
  assert.ok(a.includes('class="u char"'));
  assert.ok(a.includes('kicker'));
  // A var() token must not get a unit appended: `--size:var(--display)px` is
  // invalid CSS, and the font silently falls back to 16px.
  assert.ok(a.includes('--size:var(--display)'), 'the headline takes its size from the scale');
  assert.ok(!a.includes('var(--display)px'), 'never append px to a var() token');
  // The motion runtime is inlined from the tested module, so a page cannot
  // drift away from the spring the tests describe.
  assert.ok(a.includes('const spring ='));
});

test('graphics modes validate their own inputs', async () => {
  const { validateGraphicsSpec } = await import(gfxMod);
  assert.equal(validateGraphicsSpec({ mode: 'chart', items: [{ label: 'a', value: 1 }] }).ok, false);
  assert.equal(validateGraphicsSpec({ mode: 'chart', items: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] }).ok, true);
  assert.equal(validateGraphicsSpec({ mode: 'particles' }).ok, false);
  assert.equal(validateGraphicsSpec({ mode: 'particles', text: 'OPENFILM' }).ok, true);
  assert.equal(validateGraphicsSpec({ mode: 'particles', text: 'x'.repeat(30) }).ok, false);
});

test('the graphics page draws seeded particles and no random stream', async () => {
  const { buildGraphicsPage } = await import(gfxMod);
  const a = buildGraphicsPage({ mode: 'particles', text: '光', dots: 800, duration: 4 });
  assert.equal(a, buildGraphicsPage({ mode: 'particles', text: '光', dots: 800, duration: 4 }));
  assert.ok(a.includes('hash('));
  assert.ok(!a.includes('Math.random'));
  const chart = buildGraphicsPage({ mode: 'chart', title: '每周观看', items: [{ label: '一', value: 10 }, { label: '二', value: 24 }] });
  assert.ok(chart.includes('drawChart'));
});

test('both tools write pages and refuse to clobber', async () => {
  const tools = await mount();
  const type = tools.find((t) => t.name === 'mise_type');
  const gfx = tools.find((t) => t.name === 'mise_graphics');
  assert.ok(type, 'mise_type must be registered');
  assert.ok(gfx, 'mise_graphics must be registered');

  const dir = mkdtempSync(join(tmpdir(), 'openfilm-prim-'));
  writeFileSync(join(dir, 'film.html'), '<meta name="viewport" content="width=1920, height=1080"><section></section>');

  const madeType = await type.execute({ cwd: dir, name: 'title', lines: [{ text: '光落在信上' }], duration: 3 });
  assert.equal(madeType.ok, true);
  assert.ok(readFileSync(join(dir, 'title.html'), 'utf8').includes('class="u char"'));

  const madeChart = await gfx.execute({ cwd: dir, name: 'chart', mode: 'chart', title: '观看', items: [{ label: '一', value: 3 }, { label: '二', value: 8 }] });
  assert.equal(madeChart.ok, true);
  assert.ok(madeChart.snippet.includes('chart.html#t=0,5'));

  const again = await type.execute({ cwd: dir, name: 'title', lines: [{ text: 'x' }] });
  assert.equal(again.ok, false);

  const badChart = await gfx.execute({ cwd: dir, name: 'bad', mode: 'chart', items: [{ label: 'a', value: 1 }] });
  assert.equal(badChart.ok, false);
  rmSync(dir, { recursive: true, force: true });
});
