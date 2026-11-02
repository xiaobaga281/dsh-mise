/**
 * Presentation transitions: two pages on screen, one leaving while the other
 * arrives — not an overlay covering the cut.
 *
 *   node tests/duo.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const mod = new URL('../film-duo.mjs', import.meta.url).href;

test('a duo page needs two real, different source pages', async () => {
  const { validateDuoSpec } = await import(mod);
  assert.equal(validateDuoSpec({}).ok, false);
  assert.equal(validateDuoSpec({ from: 'a.html' }).ok, false);
  assert.equal(validateDuoSpec({ from: 'a.html', to: 'a.html' }).ok, false);
  const missing = validateDuoSpec({ from: 'a.html', to: 'b.html' }, { exists: () => false });
  assert.equal(missing.ok, false);
  assert.match(missing.problems.join(' '), /not found/);
  assert.equal(validateDuoSpec({ from: 'a.html', to: 'b.html' }, { exists: () => true }).ok, true);
});

test('the page hosts both sources and drives their clocks itself', async () => {
  const { buildDuoPage } = await import(mod);
  const html = buildDuoPage({ from: 'a.html', to: 'b.html', kind: 'slide', duration: 1 });
  assert.ok(html.includes('src="a.html"'));
  assert.ok(html.includes('src="b.html"'));
  assert.ok(html.includes('contentWindow'), 'the parent must drive the child clocks');
  assert.ok(html.includes('window.film'));
  assert.equal(html, buildDuoPage({ from: 'a.html', to: 'b.html', kind: 'slide', duration: 1 }), 'deterministic');
});

test('every kind moves both layers, not one', async () => {
  const { buildDuoPage } = await import(mod);
  for (const kind of ['slide', 'fade', 'wipe', 'push-up', 'depth']) {
    const html = buildDuoPage({ from: 'a.html', to: 'b.html', kind, duration: 1.2 });
    assert.ok(html.includes('fromLayer'), `${kind} touches the outgoing layer`);
    assert.ok(html.includes('toLayer'), `${kind} touches the incoming layer`);
    assert.ok(!/Math\.random/.test(html), `${kind} must be deterministic`);
  }
});

test('a bad duration or kind is refused with the list', async () => {
  const { validateDuoSpec } = await import(mod);
  assert.equal(validateDuoSpec({ from: 'a.html', to: 'b.html', duration: 0.05 }).ok, false);
  assert.match(validateDuoSpec({ from: 'a.html', to: 'b.html', kind: 'explode' }).problems.join(' '), /slide/);
  // A hand-over shorter than the minimum reads as a stutter, not movement.
  const short = validateDuoSpec({ from: 'a.html', to: 'b.html', duration: 0.5 });
  assert.equal(short.ok, false);
  assert.match(short.problems.join(' '), /stutter/);
  assert.equal(validateDuoSpec({ from: 'a.html', to: 'b.html', duration: 0.8 }).ok, true);
});
