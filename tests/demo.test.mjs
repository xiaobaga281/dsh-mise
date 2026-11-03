/**
 * The demo builder: a new installation can prove the chain without a picture
 * or a model.
 *
 *   node tests/demo.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

test('the demo builds a page per beat, a score and a film that references them', async () => {
  const tools = await mount();
  const demo = tools.find((tool) => tool.name === 'mise_demo');
  assert.ok(demo, 'mise_demo must be registered');

  const base = mkdtempSync(join(tmpdir(), 'mise-demo-'));
  const result = await demo.execute({ cwd: base, render: false, seconds: 16 });
  assert.equal(result.ok, true);
  assert.ok(result.pages.length >= 4);
  assert.ok(result.seconds > 10);

  const dir = join(base, 'mise-demo');
  const film = readFileSync(join(dir, 'film.html'), 'utf8');
  const iframes = (film.match(/<iframe/g) ?? []).length;
  assert.equal(iframes, result.pages.length, 'every beat is cut into the film — no silent gaps');

  for (const page of result.pages) {
    assert.ok(existsSync(join(dir, page)), `${page} exists`);
    assert.ok(readFileSync(join(dir, page), 'utf8').includes('window.film'), `${page} is a film page`);
  }
  assert.ok(existsSync(join(dir, 'assets', 'score.wav')), 'the film carries a code-composed score');
  assert.ok(existsSync(join(dir, '.film', 'plan.json')), 'the plan is written beside it');
  const plan = JSON.parse(readFileSync(join(dir, '.film', 'plan.json'), 'utf8'));
  // A presentation join adds one extra page (the duo) on top of the beats.
  assert.ok(result.pages.length >= plan.beats.length, 'every beat has a page');
  assert.equal(iframes, result.pages.length, 'every page is cut into the film');
  assert.match(film, /<audio src="assets\/score.wav"/);
  rmSync(base, { recursive: true, force: true });
});

test('a populated sample folder is not overwritten without force', async () => {
  const tools = await mount();
  const demo = tools.find((tool) => tool.name === 'mise_demo');
  const base = mkdtempSync(join(tmpdir(), 'mise-demo2-'));
  const first = await demo.execute({ cwd: base, render: false, seconds: 10 });
  assert.equal(first.ok, true);
  const second = await demo.execute({ cwd: base, render: false, seconds: 10 });
  assert.equal(second.ok, false);
  assert.match(second.problems.join(' '), /already exists/);
  const forced = await demo.execute({ cwd: base, render: false, seconds: 10, force: true });
  assert.equal(forced.ok, true);
  assert.ok(readdirSync(join(base, 'mise-demo')).some((name) => name.endsWith('.html')));
  rmSync(base, { recursive: true, force: true });
});
