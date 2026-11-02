/**
 * The motion catalogue: a shot picks a known pattern and says why, instead of
 * defaulting to a centred caption. These tests pin the search behaviour and the
 * tool's shape.
 *
 *   node tests/motion.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const catalog = new URL('../film-motion-catalog.mjs', import.meta.url).href;
const plugin = new URL('../index.js', import.meta.url).href;

test('a Chinese brief finds the pattern that expresses it', async () => {
  const { searchMotion } = await import(catalog);
  assert.equal(searchMotion({ query: '三个要点列表' })[0].id, 'STEPS-LIST');
  assert.equal(searchMotion({ query: '两个工具价格对比' })[0].id, 'COMPARE-SPLIT');
  assert.equal(searchMotion({ query: '终端命令演示' })[0].id, 'TERMINAL-TYPE');
  assert.equal(searchMotion({ use: 'compare' })[0].id, 'COMPARE-SPLIT');
});

test('every pattern carries when, snippet and how it fails', async () => {
  const { listMotion, getMotion } = await import(catalog);
  const all = listMotion();
  assert.ok(all.length >= 10);
  for (const entry of all) {
    const full = getMotion(entry.id);
    assert.ok(full.when, `${entry.id} has no when`);
    assert.ok(full.snippet, `${entry.id} has no snippet`);
    assert.ok(full.avoid, `${entry.id} has no avoid`);
  }
  assert.equal(getMotion('broll-kenburns').id, 'BROLL-KENBURNS');
  assert.equal(getMotion('nope'), null);
});

test('an unmatched brief still offers candidates, never silence', async () => {
  const { searchMotion } = await import(catalog);
  const results = searchMotion({ query: '完全不相关的描述 xyz' });
  assert.ok(results.length > 0);
  assert.equal(results[0].score, 0);
});

test('the tool is registered and answers by id and by query', async () => {
  const mod = await import(plugin);
  const tools = [];
  mod.apply({
    tools: { register: (tool) => { tools.push(tool); return () => {}; } },
    skills: { register: () => () => {} },
    effect: (fn) => { try { fn(); } catch {} return () => {}; },
    logger: { warn: () => {} },
    get: () => undefined,
  });
  const tool = tools.find((t) => t.name === 'mise_motion');
  assert.ok(tool, 'mise_motion must be registered');

  const byQuery = await tool.execute({ query: '三个要点列表' });
  assert.equal(byQuery.ok, true);
  assert.equal(byQuery.patterns[0].id, 'STEPS-LIST');
  assert.ok(byQuery.patterns[0].snippet.length > 20);

  const byId = await tool.execute({ id: 'compare-split' });
  assert.equal(byId.patterns.length, 1);
  assert.equal(byId.patterns[0].id, 'COMPARE-SPLIT');

  const missing = await tool.execute({ id: 'NOT-A-PATTERN' });
  assert.equal(missing.ok, false);
  assert.ok(missing.note.includes('STEPS-LIST'));
});
