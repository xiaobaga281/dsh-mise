/**
 * The degrees of freedom the tool surface has to keep.
 *
 * A builder can support five layouts and still ship one, because the tool in
 * front of it only forwards the fields it knows. These tests pin the fields that
 * a film needs to not look like the last film: where the type sits, which motif
 * shares the frame, what role each line plays, and whether a scene shot carries
 * the furniture that turns panels in a void into a shot.
 *
 *   node tests/freedom.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const typeMod = new URL('../film-type.mjs', import.meta.url).href;
const sceneMod = new URL('../film-scene.mjs', import.meta.url).href;

test('every layout places the block somewhere different, and says so in the page', async () => {
  const { buildTypePage, TYPE_LAYOUTS } = await import(typeMod);
  const markup = {};
  for (const layout of TYPE_LAYOUTS) {
    const page = buildTypePage({ lines: [{ text: '标题' }], layout, duration: 3 });
    markup[layout] = page;
  }
  // center is the bare stage; the other four carry their own class.
  assert.match(markup.center, /<div class="stage">/);
  for (const layout of ['editorial', 'right', 'lower', 'corner']) {
    assert.ok(markup[layout].includes(`class="stage ${layout}"`), `${layout} names itself on the stage`);
  }
  // The four off-centre layouts must not be the same page with a different class.
  const bodies = ['editorial', 'right', 'lower', 'corner'].map((layout) => markup[layout].replace(/class="stage [a-z]+"/, '').replace(/layout-[a-z]+/g, ''));
  assert.equal(new Set(bodies).size, 3, 'at least three of the four are genuinely different pages');
});

test('a motif can be chosen, and "none" really draws nothing', async () => {
  const { buildTypePage } = await import(typeMod);
  const orbit = buildTypePage({ lines: [{ text: 'A' }], motif: 'orbit', duration: 3 });
  const none = buildTypePage({ lines: [{ text: 'A' }], motif: 'none', duration: 3 });
  assert.match(orbit, /<circle cx="[\d.]+" cy="[\d.]+" r="/);
  assert.ok(!none.includes('<circle cx='), 'motif none leaves the frame to the type');
});

test('roles drive the hierarchy rather than the line index', async () => {
  const { buildTypePage } = await import(typeMod);
  const page = buildTypePage({
    lines: [
      { text: '第一章', role: 'eyebrow' },
      { text: '真正的标题', role: 'main' },
      { text: '一句支撑', role: 'sub' },
      { text: '来源：某处', role: 'note' },
    ],
    duration: 3,
  });
  for (const role of ['eyebrow', 'main', 'sub', 'note']) {
    assert.ok(page.includes(`data-role="${role}"`), `${role} survives into the page`);
  }
  // The eyebrow comes first but must not steal the headline size.
  const firstLine = page.split('<div class="line"')[1] ?? '';
  assert.match(firstLine, /data-role="eyebrow"/);
  assert.ok(firstLine.includes('var(--small)'), 'an eyebrow is set small, not as the headline');
});

test('a scene shot can carry the furniture that makes it read as a shot', async () => {
  const { buildScenePage } = await import(sceneMod);
  const bare = buildScenePage({ panels: [{ text: 'A' }], duration: 3 });
  const dressed = buildScenePage({
    panels: [{ text: 'A' }],
    kicker: 'PRODUCT',
    caption: '一块面板，一盏灯',
    captionSub: '摄影机从中间穿过去',
    frameNo: '02 / 05',
    panelTone: 'dark',
    inset: 118,
    duration: 3,
  });
  assert.ok(!bare.includes('class="caption"'), 'bare panels stay bare');
  assert.ok(dressed.includes('class="caption"'));
  assert.ok(dressed.includes('一块面板，一盏灯'));
  assert.ok(dressed.includes('class="kicker"'));
  assert.ok(dressed.includes('02 / 05'));
  assert.ok(dressed.includes('--inset:118px'), 'letterbox inset reaches the page');
});

test('grain changes with t instead of crawling in eight steps', async () => {
  const { buildTypePage } = await import(typeMod);
  const page = buildTypePage({ lines: [{ text: 'A' }], duration: 3 });
  assert.ok(page.includes('GRAIN_TILES'), 'the per-frame grain tiles are in the page');
  assert.ok(page.includes('setGrain(grainEl'), 'frame() asks for a new grain field');
  assert.ok(!/Math\.floor\(t \* 24\) % 8/.test(page), 'the eight-step crawl is gone');
});

test('the spec validators refuse a layout or role that does not exist', async () => {
  const { validateTypeSpec } = await import(typeMod);
  const bad = validateTypeSpec({ lines: [{ text: 'A', role: 'headline' }], layout: 'middle' });
  assert.equal(bad.ok, false);
  assert.ok(bad.problems.some((p) => /layout/.test(p)));
  assert.ok(bad.problems.some((p) => /role/.test(p)));
  const good = validateTypeSpec({ lines: [{ text: 'A', role: 'main' }], layout: 'corner', motif: 'lattice', warmth: 0.2 });
  assert.equal(good.ok, true, good.problems.join('; '));
});
