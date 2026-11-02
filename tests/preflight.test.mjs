/**
 * The export gate joins the review gate and the acceptance gate.
 *
 *   node tests/preflight.test.mjs
 */

import test from 'node:test';
import assert from 'node:assert/strict';

const mod = new URL('../film-preflight.mjs', import.meta.url).href;

const approved = { total: 6, approved: 6, pending: 0, changed: 0, readyToRender: true };
const fresh = { ok: true, fresh: true, checked: 4 };

test('both gates closed means export is allowed', async () => {
  const { preflight } = await import(mod);
  const verdict = preflight({ review: approved, acceptance: fresh, hasPlan: true });
  assert.equal(verdict.ok, true);
  assert.deepEqual(verdict.blockers, []);
  assert.deepEqual(verdict.checks.map((check) => check.id), ['review', 'acceptance']);
});

test('an unapproved shot blocks the export and says which', async () => {
  const { preflight } = await import(mod);
  const verdict = preflight({ review: { total: 6, approved: 4, pending: 1, changed: 1, readyToRender: false }, acceptance: fresh, hasPlan: true });
  assert.equal(verdict.ok, false);
  assert.match(verdict.blockers.join(' '), /shot review incomplete/);
  assert.match(verdict.blockers.join(' '), /1 pending/);
  assert.match(verdict.blockers.join(' '), /1 marked changed/);
});

test('pixels that were never checked block even when every shot is approved', async () => {
  const { preflight } = await import(mod);
  const missing = preflight({ review: approved, acceptance: null, hasPlan: true });
  assert.equal(missing.ok, false);
  assert.match(missing.blockers.join(' '), /never accepted/);

  const stale = preflight({ review: approved, acceptance: { ok: true, fresh: false }, hasPlan: true });
  assert.match(stale.blockers.join(' '), /stale/);

  const failed = preflight({ review: approved, acceptance: { ok: false, fresh: true, problems: ['2.0s: blank'] }, hasPlan: true });
  assert.match(failed.blockers.join(' '), /acceptance failed/);
  assert.match(failed.blockers.join(' '), /2.0s: blank/);
});

test('no review and no plan are both warnings, acceptance alone decides', async () => {
  const { preflight } = await import(mod);
  const verdict = preflight({ review: null, acceptance: fresh, hasPlan: false });
  assert.equal(verdict.ok, true);
  assert.ok(verdict.warnings.some((w) => /no shot review/.test(w)));
  assert.ok(verdict.warnings.some((w) => /no production plan/.test(w)));
});

test('the flat reviewStatus shape is read as a review, not as absent', async () => {
  const { preflight } = await import(mod);
  // reviewStatus() returns { counts, readyToRender }; reading review.total
  // directly used to report "no review recorded" for a film with eight shots.
  const verdict = preflight({
    review: { counts: { total: 8, approved: 0, pending: 8, changed: 0 }, readyToRender: false },
    acceptance: fresh,
    hasPlan: true,
  });
  assert.equal(verdict.ok, false);
  assert.match(verdict.blockers.join(' '), /8 pending/);
  assert.match(verdict.blockers.join(' '), /0\/8 approved/);
  assert.ok(!verdict.warnings.some((w) => /no shot review/.test(w)), 'it must not claim the review is missing');
});
